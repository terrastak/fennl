import { and, eq } from "drizzle-orm";
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
import { householdUsage, usageWithLimits } from "../limits/usage";
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

/** Whether this browser may sync for the caller: registered, and not signed out or replaced. */
async function deviceProblem(
  db: Database,
  signedIn: SignedIn,
  deviceId: unknown,
): Promise<SyncError | null> {
  if (signedIn.impersonating) return null;
  if (!isDeviceId(deviceId)) return "invalid_request";
  const row = await db
    .select({ revokedAt: device.revokedAt })
    .from(device)
    .where(and(eq(device.userId, signedIn.userId), eq(device.id, deviceId)))
    .get();
  if (!row) return "device_not_registered";
  return row.revokedAt ? "device_revoked" : null;
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
  const problem = await deviceProblem(signedIn.db, signedIn, push.deviceId);
  if (problem) return refuse(c, problem);
  if (push.changes.length > SYNC_RULES.changesPerPush) {
    return refuse(c, "too_many_changes", { max: SYNC_RULES.changesPerPush });
  }

  // Each change on the server's clock: the device's clock may be off, but by the same amount
  // when it made the change as when it sent the push. Never later than now.
  const now = Date.now();
  const offset = now - push.sentAt;
  const results: (ChangeResult | null)[] = [];
  const valid: { index: number; change: SyncChange; time: number }[] = [];
  push.changes.forEach((raw, index) => {
    const checked = checkChange(raw);
    if (!checked.ok) {
      results[index] = { status: "rejected", reason: "invalid", issues: checked.issues };
      return;
    }
    results[index] = null;
    const time = Math.max(1, Math.min(now, checked.value.changedAt + offset));
    valid.push({ index, change: checked.value, time });
  });

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
  const response: PushResponse = {
    results: results as ChangeResult[],
    usage: usageWithLimits(await householdUsage(signedIn.db, householdId), plan),
  };
  return c.json(response);
});

syncRoutes.get("/api/sync/pull", async (c) => {
  const signedIn = c.var.signedIn;
  const schemaVersion = Number(c.req.query("schemaVersion"));
  if (!Number.isSafeInteger(schemaVersion)) return refuse(c, "invalid_request");
  const version = schemaVersionProblem(schemaVersion);
  if (version) return refuse(c, version);
  const problem = await deviceProblem(signedIn.db, signedIn, c.req.query("deviceId"));
  if (problem) return refuse(c, problem);
  const since = parseCursors(c.req.query("since"));
  if (!since) return refuse(c, "invalid_request");
  const householdId = signedIn.household.householdId;
  const [page, plan, counts] = await Promise.all([
    pullChanges(signedIn.db, householdId, signedIn.userId, since),
    householdEntitlements(signedIn.db, householdId),
    householdUsage(signedIn.db, householdId),
  ]);
  const response: PullResponse = { ...page, usage: usageWithLimits(counts, plan) };
  return c.json(response);
});
