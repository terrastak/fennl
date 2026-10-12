import { and, eq, isNull, lt, or } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { isDeviceId } from "../../shared/devices";
import {
  SYNC_RULES,
  checkChange,
  checkPushEnvelope,
  parseCursors,
  schemaVersionProblem,
  type ChangeResult,
  type PullResponse,
  type PushResponse,
  type SyncChange,
  type SyncError,
} from "../../shared/sync";
import type { Database } from "../db/client";
import { device } from "../db/schema";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { markImportsSaved } from "../import/jobs";
import { householdPhotos, householdUsage, usageWithLimits } from "../limits/usage";
import { serverTimes, type DeviceClock } from "./clock";
import { pullChanges } from "./pull";
import { applyChanges } from "./push";

// Sending and fetching recipe changes (phase C3). Both need a signed-in person (requireHousehold)
// on a registered, active device (phase B6). An admin acting as someone (phase C12) has no
// device: their changes go straight to the server.

type SyncEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const syncRoutes = new Hono<SyncEnv>();

syncRoutes.use("/api/sync/*", requireHousehold);

const STATUS: Record<SyncError, 400 | 403 | 409 | 413> = {
  invalid_request: 400,
  device_not_registered: 403,
  device_revoked: 403,
  offline_not_allowed: 403,
  upgrade_required: 409,
  server_behind: 409,
  too_many_changes: 413,
  too_large: 413,
};

function refuse(c: Context<SyncEnv>, error: SyncError, extra: Record<string, unknown> = {}) {
  return c.json({ error, ...extra }, STATUS[error]);
}

/**
 * Whether this browser may sync for the caller (registered, and not signed out or replaced), and
 * its latest synced change (see worker/sync/clock.ts).
 */
async function checkDevice(
  db: Database,
  signedIn: SignedIn,
  deviceId: unknown,
): Promise<{ problem: SyncError } | { problem: null; clock: DeviceClock | null }> {
  if (signedIn.impersonating) return { problem: null, clock: null };
  if (!isDeviceId(deviceId)) return { problem: "invalid_request" };
  const row = await db
    .select({
      revokedAt: device.revokedAt,
      lastChangeAt: device.lastChangeAt,
      lastChangeTime: device.lastChangeTime,
    })
    .from(device)
    .where(and(eq(device.userId, signedIn.userId), eq(device.id, deviceId)))
    .get();
  if (!row) return { problem: "device_not_registered" };
  if (row.revokedAt) return { problem: "device_revoked" };
  const clock =
    row.lastChangeAt === null || row.lastChangeTime === null
      ? null
      : { changedAt: row.lastChangeAt, time: row.lastChangeTime };
  return { problem: null, clock };
}

syncRoutes.post("/api/sync/push", async (c) => {
  const signedIn = c.var.signedIn;
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > SYNC_RULES.pushBytes) return refuse(c, "too_large", { max: SYNC_RULES.pushBytes });
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > SYNC_RULES.pushBytes) {
    return refuse(c, "too_large", { max: SYNC_RULES.pushBytes });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(c, "invalid_request");
  }
  const envelope = checkPushEnvelope(body);
  if (!envelope.ok) return refuse(c, "invalid_request");
  const push = envelope.value;

  const version = schemaVersionProblem(push.schemaVersion);
  if (version) return refuse(c, version);
  const checked = await checkDevice(signedIn.db, signedIn, push.deviceId);
  if (checked.problem) return refuse(c, checked.problem);
  if (push.changes.length > SYNC_RULES.changesPerPush) {
    return refuse(c, "too_many_changes", { max: SYNC_RULES.changesPerPush });
  }

  const results: (ChangeResult | null)[] = [];
  const accepted: { index: number; change: SyncChange }[] = [];
  push.changes.forEach((raw, index) => {
    const change = checkChange(raw);
    if (!change.ok) {
      results[index] = { status: "rejected", reason: "invalid", issues: change.issues };
      return;
    }
    results[index] = null;
    accepted.push({ index, change: change.value });
  });
  // Each change on the server's clock: the device's clock may be off, but by the same amount
  // when it made the change as when it sent the push. Never later than now, except to keep
  // after this device's previous change (worker/sync/clock.ts).
  const now = Date.now();
  const clock = serverTimes(
    accepted.map((a) => a.change.changedAt),
    push.sentAt,
    now,
    checked.clock,
  );
  const valid = accepted.map((a, i) => ({ ...a, time: clock.times[i] as number }));

  // Free saves go to the server as they happen; a push of old changes is an offline queue,
  // which needs offline editing (CLAUDE.md, "Write paths"). An admin acting as someone always
  // saves straight to the server (phase C12).
  const plan = await householdEntitlements(signedIn.db, signedIn.household.householdId);
  const queueAllowed = plan.offline_enabled && !signedIn.impersonating;
  if (!queueAllowed && valid.some((v) => now - v.time > SYNC_RULES.freeChangeAgeMs)) {
    return refuse(c, "offline_not_allowed");
  }

  const householdId = signedIn.household.householdId;
  const applied = await applyChanges(
    signedIn.db,
    { userId: signedIn.userId, householdId },
    valid.map((v) => v.change),
    valid.map((v) => v.time),
    now,
    {
      maxRecipes: plan.max_recipes,
      maxTextBytes: plan.max_text_bytes,
      maxRecipeBytes: plan.max_recipe_bytes,
      maxPhotosPerRecipe: plan.max_photos_per_recipe,
    },
  );
  valid.forEach((v, i) => {
    results[v.index] = applied[i] ?? { status: "rejected", reason: "failed" };
  });
  // A recipe made from an import draft (phase E4): the draft is now saved.
  await markImportsSaved(
    signedIn.db,
    signedIn.userId,
    valid.flatMap((v, i) =>
      v.change.kind === "recipe" &&
      v.change.create?.import?.importJobId &&
      applied[i]?.status === "applied"
        ? [{ importJobId: v.change.create.import.importJobId, recipeId: v.change.id }]
        : [],
    ),
  );
  if (clock.latest && !signedIn.impersonating) {
    // Only ever moves forward, even if two pushes from this device cross.
    await signedIn.db
      .update(device)
      .set({ lastChangeAt: clock.latest.changedAt, lastChangeTime: clock.latest.time })
      .where(
        and(
          eq(device.userId, signedIn.userId),
          eq(device.id, push.deviceId),
          or(isNull(device.lastChangeAt), lt(device.lastChangeAt, clock.latest.changedAt)),
        ),
      )
      .run();
  }
  const [counts, photos] = await Promise.all([
    householdUsage(signedIn.db, householdId),
    householdPhotos(signedIn.db, householdId),
  ]);
  const response: PushResponse = {
    results: results as ChangeResult[],
    usage: usageWithLimits(counts, plan, photos),
  };
  return c.json(response);
});

syncRoutes.get("/api/sync/pull", async (c) => {
  const signedIn = c.var.signedIn;
  const schemaVersion = Number(c.req.query("schemaVersion"));
  if (!Number.isSafeInteger(schemaVersion)) return refuse(c, "invalid_request");
  const version = schemaVersionProblem(schemaVersion);
  if (version) return refuse(c, version);
  const checked = await checkDevice(signedIn.db, signedIn, c.req.query("deviceId"));
  if (checked.problem) return refuse(c, checked.problem);
  const since = parseCursors(c.req.query("since"));
  if (!since) return refuse(c, "invalid_request");
  const householdId = signedIn.household.householdId;
  const [page, plan, counts, photos] = await Promise.all([
    pullChanges(signedIn.db, householdId, signedIn.userId, since),
    householdEntitlements(signedIn.db, householdId),
    householdUsage(signedIn.db, householdId),
    householdPhotos(signedIn.db, householdId),
  ]);
  const response: PullResponse = { ...page, usage: usageWithLimits(counts, plan, photos) };
  return c.json(response);
});
