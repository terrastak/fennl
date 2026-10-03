import { eq } from "drizzle-orm";
import { TIERS, isLimitKey, type Entitlements } from "../../shared/entitlements";
import type { Database } from "../db/client";
import { limitOverride, planLimits } from "../db/schema";
import { computeEntitlements, type LimitOverride, type PlanLimits } from "./compute";

/**
 * Tier limits change rarely (from the admin console), so each Worker instance keeps them for a
 * minute. Per-household overrides are read fresh every time.
 */
export const PLAN_LIMITS_CACHE_MS = 60_000;

let cached: { loadedAt: number; limits: PlanLimits } | undefined;

export function forgetCachedPlanLimits(): void {
  cached = undefined;
}

export async function loadPlanLimits(db: Database, now = Date.now()): Promise<PlanLimits> {
  if (cached && now - cached.loadedAt < PLAN_LIMITS_CACHE_MS) return cached.limits;
  const rows = await db.select().from(planLimits).all();
  const limits: PlanLimits = {};
  for (const row of rows) {
    const tier = row.tier;
    if (!isLimitKey(row.key)) continue;
    if (tier !== "trial" && !(TIERS as readonly string[]).includes(tier)) continue;
    const forTier = (limits[tier as keyof PlanLimits] ??= {});
    forTier[row.key] = row.value;
  }
  cached = { loadedAt: now, limits };
  return limits;
}

export async function loadOverrides(db: Database, householdId: string): Promise<LimitOverride[]> {
  const rows = await db
    .select({
      key: limitOverride.key,
      value: limitOverride.value,
      expiresAt: limitOverride.expiresAt,
    })
    .from(limitOverride)
    .where(eq(limitOverride.householdId, householdId))
    .all();
  return rows.flatMap((row) =>
    isLimitKey(row.key) ? [{ key: row.key, value: row.value, expiresAt: row.expiresAt }] : [],
  );
}

/**
 * What a household is allowed to do right now. Every endpoint that needs to know asks this,
 * after requireHousehold has established which household the caller is in.
 */
export async function householdEntitlements(
  db: Database,
  householdId: string,
  now = new Date(),
): Promise<Entitlements> {
  const [limits, overrides] = await Promise.all([
    loadPlanLimits(db, now.getTime()),
    loadOverrides(db, householdId),
  ]);
  return computeEntitlements({
    now,
    // Stripe subscriptions arrive in Stage I.
    subscription: null,
    // Beta grants from invite codes arrive in phase B5.
    grant: null,
    planLimits: limits,
    overrides,
  });
}
