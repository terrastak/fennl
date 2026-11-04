import { eq, sql } from "drizzle-orm";
import { TIERS, isLimitKey, type Entitlements } from "../../shared/entitlements";
import { activeGrant, activeGrants } from "../codes/codes";
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
  const [limits, overrides, grant] = await Promise.all([
    loadPlanLimits(db, now.getTime()),
    loadOverrides(db, householdId),
    activeGrant(db, householdId, now),
  ]);
  return computeEntitlements({
    now,
    // Stripe subscriptions arrive in Stage I.
    subscription: null,
    // Free Premium from a beta invite or promo code (worker/codes).
    grant,
    planLimits: limits,
    overrides,
  });
}

/**
 * What a household would have on Free (U15: the admin console's "after Premium ends"): the same
 * overrides, no code or admin grant.
 */
export async function freeEntitlements(
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
    subscription: null,
    grant: null,
    planLimits: limits,
    overrides,
  });
}

/**
 * householdEntitlements and freeEntitlements for many households at once, in a few queries
 * whatever their number (the admin console's Needs attention, U15).
 */
export async function manyHouseholdsEntitlements(
  db: Database,
  householdIds: string[],
  now = new Date(),
): Promise<Map<string, { plan: Entitlements; free: Entitlements }>> {
  const answer = new Map<string, { plan: Entitlements; free: Entitlements }>();
  if (householdIds.length === 0) return answer;
  const ids = JSON.stringify([...new Set(householdIds)]);
  const [limits, overrideRows, grants] = await Promise.all([
    loadPlanLimits(db, now.getTime()),
    db
      .select({
        householdId: limitOverride.householdId,
        key: limitOverride.key,
        value: limitOverride.value,
        expiresAt: limitOverride.expiresAt,
      })
      .from(limitOverride)
      .where(sql`${limitOverride.householdId} in (select value from json_each(${ids}))`)
      .all(),
    activeGrants(db, householdIds, now),
  ]);
  for (const householdId of householdIds) {
    const overrides: LimitOverride[] = overrideRows.flatMap((row) =>
      row.householdId === householdId && isLimitKey(row.key)
        ? [{ key: row.key, value: row.value, expiresAt: row.expiresAt }]
        : [],
    );
    const input = { now, subscription: null, planLimits: limits, overrides };
    answer.set(householdId, {
      plan: computeEntitlements({ ...input, grant: grants.get(householdId) ?? null }),
      free: computeEntitlements({ ...input, grant: null }),
    });
  }
  return answer;
}
