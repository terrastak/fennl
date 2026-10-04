import { and, desc, eq, isNull } from "drizzle-orm";
import type { AdminCode, AdminCodeUse, CodeChanges, NewCode } from "../../shared/codes";
import type { Database } from "../db/client";
import { premiumGrant, promoCode, user } from "../db/schema";
import { codeProblem, generateCode, isPaidTier, normalizeCode, type PromoCode } from "./codes";

// The admin console's side of codes: reading and checking what the admin sent. The routes in
// worker/codes/routes.ts record each change in the audit log before making it.

const MAX_DAYS = 3650;
const MAX_USES = 100_000;

export function toAdminCode(code: PromoCode, now = new Date()): AdminCode {
  const problem = codeProblem(code, now, { forSignUp: false });
  return {
    id: code.id,
    code: code.code,
    label: code.label,
    tier: code.tier === "individual" ? "individual" : "household",
    access:
      code.accessDays !== null
        ? { days: code.accessDays }
        : { until: (code.accessUntil ?? now).toISOString() },
    allowsSignUp: code.allowsSignUp,
    maxUses: code.maxUses,
    uses: code.uses,
    redeemBy: code.redeemBy?.toISOString() ?? null,
    disabledAt: code.disabledAt?.toISOString() ?? null,
    createdAt: code.createdAt.toISOString(),
    status:
      problem === "disabled"
        ? "disabled"
        : problem === "used_up"
          ? "used_up"
          : problem
            ? "expired"
            : "active",
  };
}

export async function listCodes(db: Database): Promise<AdminCode[]> {
  const rows = await db.select().from(promoCode).orderBy(desc(promoCode.createdAt)).all();
  const now = new Date();
  return rows.map((row) => toAdminCode(row, now));
}

export async function codeById(db: Database, id: string): Promise<PromoCode | undefined> {
  return db.select().from(promoCode).where(eq(promoCode.id, id)).get();
}

export async function codeUses(db: Database, code: PromoCode): Promise<AdminCodeUse[]> {
  const rows = await db
    .select({
      name: user.name,
      email: user.email,
      usedAt: premiumGrant.createdAt,
      endsAt: premiumGrant.endsAt,
      revokedAt: premiumGrant.revokedAt,
    })
    .from(premiumGrant)
    .innerJoin(user, eq(premiumGrant.userId, user.id))
    .where(eq(premiumGrant.promoCodeId, code.id))
    .orderBy(desc(premiumGrant.createdAt))
    .all();
  return rows.map((row) => ({
    name: row.name,
    email: row.email,
    usedAt: row.usedAt.toISOString(),
    endsAt: (row.revokedAt ?? row.endsAt ?? code.accessUntil)?.toISOString() ?? null,
    ended: row.revokedAt !== null,
  }));
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function date(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 ? trimmed : null;
}

/** Checks a new code from the admin console. Error strings are API error codes. */
export function parseNewCode(body: unknown, now = new Date()): Parsed<NewCode> {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = label(input.label);
  if (!name) return { ok: false, error: "invalid_label" };
  if (!isPaidTier(input.tier)) return { ok: false, error: "invalid_tier" };

  let code: string | undefined;
  if (input.code !== undefined && input.code !== null && input.code !== "") {
    const normalized = normalizeCode(input.code);
    if (!normalized) return { ok: false, error: "invalid_code" };
    code = normalized;
  }

  const access = (input.access ?? {}) as Record<string, unknown>;
  let parsedAccess: NewCode["access"];
  if ("until" in access) {
    const until = date(access.until);
    if (!until || until <= now) return { ok: false, error: "invalid_access" };
    parsedAccess = { until: until.toISOString() };
  } else if ("days" in access) {
    const days = wholeNumber(access.days, 1, MAX_DAYS);
    if (days === null) return { ok: false, error: "invalid_access" };
    parsedAccess = { days };
  } else {
    return { ok: false, error: "invalid_access" };
  }

  if (typeof input.allowsSignUp !== "boolean") return { ok: false, error: "invalid_sign_up" };

  let maxUses: number | null = null;
  if (input.maxUses !== null && input.maxUses !== undefined) {
    maxUses = wholeNumber(input.maxUses, 1, MAX_USES);
    if (maxUses === null) return { ok: false, error: "invalid_max_uses" };
  }

  let redeemBy: string | null = null;
  if (input.redeemBy !== null && input.redeemBy !== undefined) {
    const by = date(input.redeemBy);
    if (!by || by <= now) return { ok: false, error: "invalid_redeem_by" };
    redeemBy = by.toISOString();
  }

  return {
    ok: true,
    value: {
      code,
      label: name,
      tier: input.tier,
      access: parsedAccess,
      allowsSignUp: input.allowsSignUp,
      maxUses,
      redeemBy,
    },
  };
}

export async function createCode(
  db: Database,
  input: NewCode & { code: string },
  createdBy: string | null,
  now = new Date(),
): Promise<PromoCode> {
  const row = {
    id: crypto.randomUUID(),
    code: input.code,
    label: input.label,
    tier: input.tier,
    accessUntil: "until" in input.access ? new Date(input.access.until) : null,
    accessDays: "days" in input.access ? input.access.days : null,
    allowsSignUp: input.allowsSignUp,
    maxUses: input.maxUses,
    uses: 0,
    redeemBy: input.redeemBy ? new Date(input.redeemBy) : null,
    disabledAt: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(promoCode).values(row);
  return row;
}

/** A code that isn't taken yet: the one asked for, or a fresh random one. */
export async function availableCode(db: Database, wanted: string | undefined) {
  const candidate = wanted ?? generateCode();
  const taken = await db
    .select({ id: promoCode.id })
    .from(promoCode)
    .where(eq(promoCode.code, candidate))
    .get();
  if (!taken) return candidate;
  return wanted ? null : generateCode();
}

/** Checks changes to a code. Error strings are API error codes. */
export function parseChanges(body: unknown, code: PromoCode): Parsed<CodeChanges> {
  const input = (body ?? {}) as Record<string, unknown>;
  const changes: CodeChanges = {};
  if (input.label !== undefined) {
    const name = label(input.label);
    if (!name) return { ok: false, error: "invalid_label" };
    changes.label = name;
  }
  if (input.accessUntil !== undefined) {
    // A days code's grants have their own end dates; only date codes have one to move.
    if (code.accessUntil === null) return { ok: false, error: "not_a_date_code" };
    const until = date(input.accessUntil);
    if (!until) return { ok: false, error: "invalid_access" };
    changes.accessUntil = until.toISOString();
  }
  if (input.maxUses !== undefined) {
    if (input.maxUses === null) changes.maxUses = null;
    else {
      const max = wholeNumber(input.maxUses, 1, MAX_USES);
      if (max === null) return { ok: false, error: "invalid_max_uses" };
      changes.maxUses = max;
    }
  }
  if (input.redeemBy !== undefined) {
    if (input.redeemBy === null) changes.redeemBy = null;
    else {
      const by = date(input.redeemBy);
      if (!by) return { ok: false, error: "invalid_redeem_by" };
      changes.redeemBy = by.toISOString();
    }
  }
  if (Object.keys(changes).length === 0) return { ok: false, error: "no_changes" };
  return { ok: true, value: changes };
}

export async function updateCode(
  db: Database,
  code: PromoCode,
  changes: CodeChanges,
  now = new Date(),
): Promise<void> {
  await db
    .update(promoCode)
    .set({
      ...(changes.label !== undefined ? { label: changes.label } : {}),
      ...(changes.accessUntil !== undefined ? { accessUntil: new Date(changes.accessUntil) } : {}),
      ...(changes.maxUses !== undefined ? { maxUses: changes.maxUses } : {}),
      ...(changes.redeemBy !== undefined
        ? { redeemBy: changes.redeemBy === null ? null : new Date(changes.redeemBy) }
        : {}),
      updatedAt: now,
    })
    .where(eq(promoCode.id, code.id));
}

/**
 * Turns a code off for new uses. With endAccess, everyone who already used it also loses the
 * Premium it gave (they fall back to Free; nothing is deleted).
 */
export async function disableCode(
  db: Database,
  code: PromoCode,
  endAccess: boolean,
  now = new Date(),
): Promise<void> {
  await db.batch([
    db.update(promoCode).set({ disabledAt: now, updatedAt: now }).where(eq(promoCode.id, code.id)),
    ...(endAccess
      ? [
          db
            .update(premiumGrant)
            .set({ revokedAt: now })
            .where(and(eq(premiumGrant.promoCodeId, code.id), isNull(premiumGrant.revokedAt))),
        ]
      : []),
  ]);
}

/** What the audit log keeps about a code. */
export function codeSummary(code: PromoCode) {
  return {
    codeId: code.id,
    code: code.code,
    label: code.label,
    tier: code.tier,
    accessUntil: code.accessUntil?.toISOString() ?? null,
    accessDays: code.accessDays,
    allowsSignUp: code.allowsSignUp,
    maxUses: code.maxUses,
    redeemBy: code.redeemBy?.toISOString() ?? null,
  };
}
