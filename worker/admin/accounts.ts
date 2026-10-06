import { and, desc, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import type {
  AccountDetail,
  AccountGrant,
  AccountMatch,
  AccountOverride,
  PlanLimitRow,
} from "../../shared/adminAccounts";
import { TIERS, isLimitKey, type LimitKey } from "../../shared/entitlements";
import type { Database } from "../db/client";
import {
  account,
  device,
  limitOverride,
  member,
  organization,
  planLimits,
  premiumGrant,
  promoCode,
  session,
  user,
} from "../db/schema";
import { activeDevices } from "../devices/devices";
import { forgetCachedPlanLimits, householdEntitlements } from "../entitlements/entitlements";

// The admin console's account tools (phase B7): finding an account, what its page shows, and
// the limit changes. The routes in worker/admin/accountRoutes.ts check the admin, record each
// action in the audit log first, and ask for the passkey again where CLAUDE.md requires it.

const PERSONAL_PREFIX = "personal-";

/** "%" and "_" mean something in LIKE; a search for them should find them literally. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Accounts whose email or name contains the query (at least 2 characters), newest first. */
export async function searchAccounts(db: Database, query: string): Promise<AccountMatch[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const pattern = likePattern(q);
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
    .from(user)
    .where(
      or(
        sql`lower(${user.email}) like ${pattern} escape '\\'`,
        sql`lower(${user.name}) like ${pattern} escape '\\'`,
      ),
    )
    .orderBy(desc(user.createdAt))
    .limit(25)
    .all();
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** The household an account works in, without creating one (unlike activeHouseholdFor). */
export async function accountHousehold(db: Database, userId: string) {
  const rows = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .all();
  return rows.find((r) => !r.slug.startsWith(PERSONAL_PREFIX)) ?? rows[0] ?? null;
}

export async function findAccount(db: Database, userId: string) {
  return db.select().from(user).where(eq(user.id, userId)).get();
}

export async function accountDetail(db: Database, userId: string): Promise<AccountDetail | null> {
  const person = await findAccount(db, userId);
  if (!person) return null;
  const household = await accountHousehold(db, userId);

  const [methods, sessionSeen, deviceSeen, grants, members] = await Promise.all([
    db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, userId))
      .all(),
    db
      .select({ at: max(session.updatedAt) })
      .from(session)
      .where(eq(session.userId, userId))
      .get(),
    db
      .select({ at: max(device.lastSeenAt) })
      .from(device)
      .where(eq(device.userId, userId))
      .get(),
    db
      .select({
        code: promoCode.code,
        label: promoCode.label,
        tier: premiumGrant.tier,
        usedAt: premiumGrant.createdAt,
        endsAt: premiumGrant.endsAt,
        accessUntil: promoCode.accessUntil,
        revokedAt: premiumGrant.revokedAt,
      })
      .from(premiumGrant)
      .innerJoin(promoCode, eq(premiumGrant.promoCodeId, promoCode.id))
      .where(eq(premiumGrant.userId, userId))
      .orderBy(desc(premiumGrant.createdAt))
      .all(),
    household
      ? db
          .select({ name: user.name, email: user.email })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(eq(member.organizationId, household.id))
          .all()
      : Promise.resolve([]),
  ]);

  const seen = [sessionSeen?.at, deviceSeen?.at]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    id: person.id,
    name: person.name,
    email: person.email,
    emailVerified: person.emailVerified,
    role: person.role ?? null,
    createdAt: person.createdAt.toISOString(),
    lastSeenAt: seen?.toISOString() ?? null,
    signInMethods: [...new Set(methods.map((m) => m.providerId))],
    mustChangePassword: person.mustChangePassword ?? false,
    household: household ? { id: household.id, name: household.name, members } : null,
    plan: household ? await householdEntitlements(db, household.id) : null,
    grants: grants.map((g): AccountGrant => ({
      code: g.code,
      label: g.label,
      tier: g.tier,
      usedAt: g.usedAt.toISOString(),
      endsAt: (g.revokedAt ?? g.endsAt ?? g.accessUntil)?.toISOString() ?? null,
      ended: g.revokedAt !== null,
    })),
    devices: household
      ? await activeDevices(db, { userId, householdId: household.id, sessionId: "" }, "")
      : [],
    overrides: household ? await householdOverrides(db, household.id) : [],
    usage: null,
  };
}

export async function householdOverrides(
  db: Database,
  householdId: string,
): Promise<AccountOverride[]> {
  const rows = await db
    .select()
    .from(limitOverride)
    .where(eq(limitOverride.householdId, householdId))
    .all();
  return rows.flatMap((row) =>
    isLimitKey(row.key)
      ? [
          {
            key: row.key,
            value: row.value,
            expiresAt: row.expiresAt?.toISOString() ?? null,
            note: row.note,
            createdAt: row.createdAt.toISOString(),
          },
        ]
      : [],
  );
}

/** Sets (or replaces) one override for a household. */
export async function setOverride(
  db: Database,
  householdId: string,
  input: { key: LimitKey; value: number | null; expiresAt: Date | null; note: string | null },
  adminId: string,
  now = new Date(),
): Promise<void> {
  const row = {
    id: crypto.randomUUID(),
    householdId,
    key: input.key,
    value: input.value,
    expiresAt: input.expiresAt,
    note: input.note,
    createdBy: adminId,
    createdAt: now,
  };
  await db
    .insert(limitOverride)
    .values(row)
    .onConflictDoUpdate({
      target: [limitOverride.householdId, limitOverride.key],
      set: {
        value: row.value,
        expiresAt: row.expiresAt,
        note: row.note,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      },
    });
}

export async function removeOverride(db: Database, householdId: string, key: LimitKey) {
  const removed = await db
    .delete(limitOverride)
    .where(and(eq(limitOverride.householdId, householdId), eq(limitOverride.key, key)))
    .returning({ id: limitOverride.id })
    .all();
  return removed.length > 0;
}

/** Signs an account out of every browser: its sessions end and its devices are let go. */
export async function signOutEverywhere(db: Database, userId: string, now = new Date()) {
  const ended = await db
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id })
    .all();
  await db
    .update(device)
    .set({ revokedAt: now, revokedReason: "signed_out" })
    .where(and(eq(device.userId, userId), isNull(device.revokedAt)));
  return ended.length;
}

export async function setMustChangePassword(db: Database, userId: string, value: boolean) {
  await db.update(user).set({ mustChangePassword: value }).where(eq(user.id, userId));
}

/** The tiers plan_limits holds: the real ones, and "trial" (lower image quotas). */
export const LIMIT_TIERS = [...TIERS, "trial"] as const;

export function isLimitTier(value: unknown): value is (typeof LIMIT_TIERS)[number] {
  return typeof value === "string" && (LIMIT_TIERS as readonly string[]).includes(value);
}

export async function listPlanLimits(db: Database): Promise<PlanLimitRow[]> {
  const rows = await db.select().from(planLimits).all();
  return rows.flatMap((row) =>
    isLimitKey(row.key)
      ? [{ tier: row.tier, key: row.key, value: row.value, updatedAt: row.updatedAt.toISOString() }]
      : [],
  );
}

export async function planLimit(db: Database, tier: string, key: LimitKey) {
  return db
    .select()
    .from(planLimits)
    .where(and(eq(planLimits.tier, tier), eq(planLimits.key, key)))
    .get();
}

/** Changes one tier limit. Other Worker instances pick it up within a minute (their cache). */
export async function setPlanLimit(
  db: Database,
  tier: string,
  key: LimitKey,
  value: number | null,
  adminId: string,
  now = new Date(),
): Promise<void> {
  const row = { tier, key, value, updatedAt: now, updatedBy: adminId };
  await db
    .insert(planLimits)
    .values(row)
    .onConflictDoUpdate({ target: [planLimits.tier, planLimits.key], set: row });
  forgetCachedPlanLimits();
}

/** A limit's value from the console: a whole number of at least 0, or null for "no limit". */
export function parseLimitValue(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1e15) {
    return { ok: true, value };
  }
  return { ok: false };
}

/** Accounts by ID, for the activity log's names. */
export async function accountNames(db: Database, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.id, ids))
    .all();
  return new Map(rows.map((r) => [r.id, r.email]));
}
