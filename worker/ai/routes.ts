import { Hono } from "hono";
import type { AiImportUsage } from "../../shared/limits";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { aiSettings } from "./config";
import { fennlMonthCost, householdMonth } from "./usage";

// The household's own view of its AI imports (Account › Usage and limits): how many it has used
// this month against its plan's number, and whether they're used up or paused. The hidden cost
// backstop stays hidden (decided 2026-10-12): reaching it reads as "used up", never as an amount
// (decided 2026-10-14).

export const aiRoutes = new Hono<{ Bindings: Env; Variables: { signedIn: SignedIn } }>();

aiRoutes.get("/api/ai/usage", requireHousehold, async (c) => {
  const { db, household } = c.var.signedIn;
  const now = new Date();
  const [plan, month] = await Promise.all([
    householdEntitlements(db, household.householdId),
    householdMonth(db, household.householdId, now),
  ]);
  const max = plan.ai_imports_per_month;
  const backstop = plan.ai_cost_cents_per_month;
  const enabled = plan.import_ai_enabled;
  const paused =
    enabled &&
    (await fennlMonthCost(db, now)) >= (await aiSettings(db, () => true)).pauseCents * 10_000;
  const usage: AiImportUsage = {
    enabled,
    used: month.imports,
    max,
    usedUp:
      enabled &&
      ((max !== null && month.imports >= max) ||
        (backstop !== null && month.costMicroUsd >= backstop * 10_000)),
    paused,
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
  return c.json(usage);
});
