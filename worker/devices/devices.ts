import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DeviceSummary, RegisterResult } from "../../shared/devices";
import type { Database } from "../db/client";
import { device, session } from "../db/schema";

// The device registry (phase B6, CLAUDE.md "Tables"). A household may have max_devices active
// devices at once: one on Free, more on Premium. A new browser beyond the limit gets a takeover
// screen; taking over is instant and signs the other device out. Losing the browser's storage
// (eviction) looks like a new device, and is recognised by its sign-in session.

/** Where the device stands, for the routes in worker/devices/routes.ts. */
export interface DeviceCaller {
  userId: string;
  householdId: string;
  sessionId: string;
}

type RevokeReason = "taken_over" | "signed_out" | "replaced";

/** No limit (max_devices is null): a cap no household reaches. */
const NO_LIMIT = 1_000_000;

function summary(row: typeof device.$inferSelect, currentId: string, userId: string) {
  return {
    id: row.id,
    label: row.label,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    current: row.id === currentId && row.userId === userId,
  } satisfies DeviceSummary;
}

/** The household's active devices, most recently used first. */
export async function activeDevices(
  db: Database,
  caller: DeviceCaller,
  currentId: string,
): Promise<DeviceSummary[]> {
  const rows = await db
    .select()
    .from(device)
    .where(and(eq(device.householdId, caller.householdId), isNull(device.revokedAt)))
    .orderBy(desc(device.lastSeenAt))
    .all();
  return rows.map((row) => summary(row, currentId, caller.userId));
}

/**
 * Marks devices revoked and ends their sign-in sessions, except the caller's own session (a
 * browser never signs itself out by taking over from its own old ID).
 */
async function revoke(
  db: Database,
  caller: DeviceCaller,
  rows: { id: string; sessionId: string | null }[],
  reason: RevokeReason,
  now: Date,
): Promise<void> {
  if (rows.length === 0) return;
  const sessions = rows
    .map((row) => row.sessionId)
    .filter((id): id is string => id !== null && id !== caller.sessionId);
  await db.batch([
    db
      .update(device)
      .set({ revokedAt: now, revokedReason: reason })
      .where(
        and(
          eq(device.userId, caller.userId),
          inArray(
            device.id,
            rows.map((row) => row.id),
          ),
          isNull(device.revokedAt),
        ),
      ),
    ...(sessions.length > 0 ? [db.delete(session).where(inArray(session.id, sessions))] : []),
  ]);
}

/**
 * The browser says hello (on every app start). Already active: just noted. Otherwise it's added
 * if the household has room, in one conditional statement so two browsers can't both take the
 * last place. Over the limit, the answer lists the devices in use for the takeover screen.
 */
export async function registerDevice(
  db: Database,
  caller: DeviceCaller,
  deviceId: string,
  label: string,
  maxDevices: number | null,
  now = new Date(),
): Promise<RegisterResult> {
  // The same browser under a new ID (its storage was cleared or evicted, but the sign-in
  // cookie survived): the old ID is retired quietly, not counted against the new one.
  const sameBrowser = await db
    .select({ id: device.id, sessionId: device.sessionId })
    .from(device)
    .where(
      and(
        eq(device.userId, caller.userId),
        eq(device.sessionId, caller.sessionId),
        ne(device.id, deviceId),
        isNull(device.revokedAt),
      ),
    )
    .all();
  await revoke(db, caller, sameBrowser, "replaced", now);

  const max = maxDevices ?? NO_LIMIT;
  const at = now.getTime();
  // Insert, or bring back a revoked row, only while the household is under its limit; an
  // already-active row is always just updated. One statement, so it can't race.
  const added = await db.get<{ id: string }>(sql`
    insert into device (id, user_id, household_id, label, session_id, first_seen_at, last_seen_at)
    select ${deviceId}, ${caller.userId}, ${caller.householdId}, ${label}, ${caller.sessionId}, ${at}, ${at}
    where (
        select count(*) from device
        where household_id = ${caller.householdId} and revoked_at is null
          and not (user_id = ${caller.userId} and id = ${deviceId})
      ) < ${max}
      or exists (
        select 1 from device
        where user_id = ${caller.userId} and id = ${deviceId} and revoked_at is null
      )
    on conflict (user_id, id) do update set
      household_id = excluded.household_id,
      label = excluded.label,
      session_id = excluded.session_id,
      last_seen_at = excluded.last_seen_at,
      revoked_at = null,
      revoked_reason = null
    returning id`);
  if (added) return { status: "ok" };

  return {
    status: "over_limit",
    max,
    devices: await activeDevices(db, caller, deviceId),
  };
}

/**
 * "Use Fennl on this device": signs out the caller's chosen devices (by default all their other
 * devices, which is what Free's one-device rule needs), then registers this one. Only the
 * caller's own devices can be signed out this way.
 */
export async function takeOver(
  db: Database,
  caller: DeviceCaller,
  deviceId: string,
  label: string,
  maxDevices: number | null,
  chosen: string[] | null,
  now = new Date(),
): Promise<RegisterResult> {
  const others = await db
    .select({ id: device.id, sessionId: device.sessionId })
    .from(device)
    .where(
      and(
        eq(device.userId, caller.userId),
        ne(device.id, deviceId),
        isNull(device.revokedAt),
        ...(chosen ? [inArray(device.id, chosen.length > 0 ? chosen : [""])] : []),
      ),
    )
    .all();
  await revoke(db, caller, others, "taken_over", now);
  return registerDevice(db, caller, deviceId, label, maxDevices, now);
}

/** "Sign out" next to a device in Settings. Not the device asking (that's ordinary sign-out). */
export async function signOutDevice(
  db: Database,
  caller: DeviceCaller,
  deviceId: string,
  currentId: string,
  now = new Date(),
): Promise<boolean> {
  if (deviceId === currentId) return false;
  const row = await db
    .select({ id: device.id, sessionId: device.sessionId })
    .from(device)
    .where(and(eq(device.userId, caller.userId), eq(device.id, deviceId), isNull(device.revokedAt)))
    .get();
  if (!row) return false;
  await revoke(db, caller, [row], "signed_out", now);
  return true;
}
