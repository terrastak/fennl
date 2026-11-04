import { Hono } from "hono";
import { isRefusedWhat, type RefusedLimit, type RefusedWhat } from "../../shared/accountEvents";
import { addBlockedBy, usageLevel, type Usage } from "../../shared/limits";
import type { Entitlements } from "../../shared/entitlements";
import { inBackground, recordLimitRefusals } from "../account/events";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { householdPhotos, householdUsage, usageWithLimits } from "./usage";

// POST /api/limits/refused {limit, what} (U15): the app stopped something before sending it,
// because the household is at a limit (the app checks the same rules the server does, so most
// refusals never reach the server). Kept for the admin console's account page, so "it says I'm
// over a limit" can be seen there. The server never takes the app's word for it: it works out
// the household's usage itself and keeps the refusal only if its own check gives the same limit.
// Always answers 204 for a well-formed request, kept or not; nothing is kept while acting.

export const limitRoutes = new Hono<{ Bindings: Env; Variables: { signedIn: SignedIn } }>();

limitRoutes.use("/api/limits/*", requireHousehold);

/** The limits the app checks itself, so may report. */
const REPORTABLE: readonly RefusedLimit[] = [
  "max_recipes",
  "max_text_bytes",
  "image_quota_bytes",
  "image_quota_count",
  "images_enabled",
  "import_structured_enabled",
  "import_ai_enabled",
];

const isReportable = (value: unknown): value is RefusedLimit =>
  typeof value === "string" && (REPORTABLE as readonly string[]).includes(value);

const atOrOver = (used: number, max: number | null) => {
  const level = usageLevel(used, max);
  return level === "full" || level === "over";
};

/** The numbers behind the refusal, when the server's own check agrees; otherwise null. */
export function confirmedRefusal(
  limit: RefusedLimit,
  what: RefusedWhat,
  plan: Entitlements,
  usage: Usage,
): { used?: number; max?: number | null } | null {
  switch (limit) {
    case "max_recipes":
    case "max_text_bytes":
      if (addBlockedBy(usage, what === "restore") !== limit) return null;
      return limit === "max_recipes"
        ? { used: usage.recipes, max: usage.maxRecipes }
        : { used: usage.textBytes, max: usage.maxTextBytes };
    case "image_quota_bytes":
      if (!usage.photos?.enabled || !atOrOver(usage.photos.bytes, usage.photos.maxBytes)) {
        return null;
      }
      return { used: usage.photos.bytes, max: usage.photos.maxBytes };
    case "image_quota_count":
      if (!usage.photos?.enabled || !atOrOver(usage.photos.count, usage.photos.maxCount)) {
        return null;
      }
      return { used: usage.photos.count, max: usage.photos.maxCount };
    case "images_enabled":
      return plan.images_enabled ? null : {};
    case "import_structured_enabled":
      return plan.import_structured_enabled ? null : {};
    case "import_ai_enabled":
      return plan.import_ai_enabled ? null : {};
    default:
      return null;
  }
}

limitRoutes.post("/api/limits/refused", async (c) => {
  const signedIn = c.var.signedIn;
  const body = (await c.req.json().catch(() => null)) as { limit?: unknown; what?: unknown } | null;
  const limit = body?.limit;
  const what = body?.what;
  if (!isReportable(limit) || !isRefusedWhat(what))
    return c.json({ error: "invalid_request" }, 400);
  if (signedIn.impersonating) return c.body(null, 204);
  const householdId = signedIn.household.householdId;
  await inBackground(
    c,
    (async () => {
      const [plan, counts, photos] = await Promise.all([
        householdEntitlements(signedIn.db, householdId),
        householdUsage(signedIn.db, householdId),
        householdPhotos(signedIn.db, householdId),
      ]);
      const confirmed = confirmedRefusal(limit, what, plan, usageWithLimits(counts, plan, photos));
      if (!confirmed) return;
      await recordLimitRefusals(signedIn.db, signedIn.userId, [
        { limit, what, ...confirmed, origin: "app" },
      ]);
    })(),
  );
  return c.body(null, 204);
});
