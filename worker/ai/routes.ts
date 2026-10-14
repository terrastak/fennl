import { Hono } from "hono";
import type { AiImportUsage } from "../../shared/limits";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { householdMonth } from "./usage";

// The household's own view of its AI imports (Account › Usage and limits): how many it has used
// this month against its plan's number. The hidden cost backstop stays hidden (decided
// 2026-10-12).

export const aiRoutes = new Hono<{ Bindings: Env; Variables: { signedIn: SignedIn } }>();

aiRoutes.get("/api/ai/usage", requireHousehold, async (c) => {
  const { db, household } = c.var.signedIn;
  const now = new Date();
  const [plan, month] = await Promise.all([
    householdEntitlements(db, household.householdId),
    householdMonth(db, household.householdId, now),
  ]);
  const usage: AiImportUsage = {
    enabled: plan.import_ai_enabled,
    used: month.imports,
    max: plan.ai_imports_per_month,
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
  return c.json(usage);
});
