import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { CodeProblem } from "../../shared/codes";
import type { PaidTier } from "../../shared/entitlements";
import type { Database } from "../db/client";
import { premiumGrant, promoCode } from "../db/schema";
import type { GrantInput } from "../entitlements/compute";

// Codes that give a household free Premium (phase B5). The rules, in CLAUDE.md "Beta grants":
// a code's grant is one more input to the entitlement service, never a separate code path.

export type PromoCode = typeof promoCode.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

/** No 0/O or 1/I, so codes read aloud or typed from paper come out right. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A random code like "K7QX-M4TR-9WAZ" (60 bits, so codes can't be guessed). */
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/**
 * How codes are stored and compared: capitals, no spaces. Returns null for something that can't
 * be a code (codes are 4 to 40 letters, digits and dashes).
 */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9-]{4,40}$/.test(code) ? code : null;
}

export function isPaidTier(value: unknown): value is PaidTier {
  return value === "individual" || value === "household";
}

export async function findCode(db: Database, input: unknown): Promise<PromoCode | undefined> {
  const code = normalizeCode(input);
  if (!code) return undefined;
  return db.select().from(promoCode).where(eq(promoCode.code, code)).get();
}

/** Why a code can't be used now, or null if it can. */
export function codeProblem(
  code: PromoCode | undefined,
  now: Date,
  options: { forSignUp: boolean },
): Exclude<CodeProblem, "already_used"> | null {
  if (!code) return "not_found";
  if (code.disabledAt) return "disabled";
  if (code.redeemBy && code.redeemBy <= now) return "expired";
  // An "until a date" code whose date has passed gives nothing any more.
  if (code.accessUntil && code.accessUntil <= now) return "expired";
  if (code.maxUses !== null && code.uses >= code.maxUses) return "used_up";
  if (options.forSignUp && !code.allowsSignUp) return "no_sign_up";
  return null;
}

/**
 * Counts one use of the code, only if it's still usable: one conditional update, so two people
 * can't both take its last use. Returns false if it wasn't.
 */
export async function reserveUse(db: Database, codeId: string, now: Date): Promise<boolean> {
  const row = await db
    .update(promoCode)
    .set({ uses: sql`${promoCode.uses} + 1` })
    .where(
      and(
        eq(promoCode.id, codeId),
        isNull(promoCode.disabledAt),
        or(isNull(promoCode.maxUses), lt(promoCode.uses, promoCode.maxUses)),
        or(isNull(promoCode.redeemBy), gt(promoCode.redeemBy, now)),
        or(isNull(promoCode.accessUntil), gt(promoCode.accessUntil, now)),
      ),
    )
    .returning({ id: promoCode.id })
    .get();
  return row !== undefined;
}

/** Gives back a use reserved for a grant that then couldn't be saved. */
export async function releaseUse(db: Database, codeId: string): Promise<void> {
  await db
    .update(promoCode)
    .set({ uses: sql`max(${promoCode.uses} - 1, 0)` })
    .where(eq(promoCode.id, codeId));
}

/**
 * When a grant from this code, used now, ends. Null means "whenever the code's date is" for a
 * date code, and never for a code with no end date.
 */
export function grantEnd(code: PromoCode, now: Date): Date | null {
  return code.accessDays !== null ? new Date(now.getTime() + code.accessDays * DAY_MS) : null;
}

/** Saves the grant for a use that's already been reserved. */
export async function saveGrant(
  db: Database,
  code: PromoCode,
  who: { userId: string; householdId: string },
  now: Date,
): Promise<void> {
  await db.insert(premiumGrant).values({
    id: crypto.randomUUID(),
    householdId: who.householdId,
    userId: who.userId,
    promoCodeId: code.id,
    tier: code.tier,
    startsAt: now,
    endsAt: grantEnd(code, now),
    createdAt: now,
  });
}

export type RedeemResult = { ok: true; code: PromoCode } | { ok: false; problem: CodeProblem };

/** A signed-in person uses a code for their household (the Account page). */
export async function redeemCode(
  db: Database,
  input: unknown,
  who: { userId: string; householdId: string },
  now = new Date(),
): Promise<RedeemResult> {
  const code = await findCode(db, input);
  const problem = codeProblem(code, now, { forSignUp: false });
  if (problem || !code) return { ok: false, problem: problem ?? "not_found" };

  const used = await db
    .select({ id: premiumGrant.id })
    .from(premiumGrant)
    .where(and(eq(premiumGrant.userId, who.userId), eq(premiumGrant.promoCodeId, code.id)))
    .get();
  if (used) return { ok: false, problem: "already_used" };

  if (!(await reserveUse(db, code.id, now))) {
    const latest = await findCode(db, code.code);
    return { ok: false, problem: codeProblem(latest, now, { forSignUp: false }) ?? "used_up" };
  }
  try {
    await saveGrant(db, code, who, now);
  } catch (error) {
    // The same person using it twice at once: the unique index refused the second.
    await releaseUse(db, code.id);
    const again = await db
      .select({ id: premiumGrant.id })
      .from(premiumGrant)
      .where(and(eq(premiumGrant.userId, who.userId), eq(premiumGrant.promoCodeId, code.id)))
      .get();
    if (again) return { ok: false, problem: "already_used" };
    throw error;
  }
  return { ok: true, code };
}

const RANK: Record<PaidTier, number> = { individual: 1, household: 2 };

/**
 * The best Premium a household has from codes right now: the higher tier, then the later end
 * (no end date beats any date).
 * Grants from "until a date" codes end on the code's current date, so moving it moves them.
 */
export async function activeGrant(
  db: Database,
  householdId: string,
  now = new Date(),
): Promise<GrantInput | null> {
  const rows = await db
    .select({
      tier: premiumGrant.tier,
      startsAt: premiumGrant.startsAt,
      endsAt: premiumGrant.endsAt,
      accessUntil: promoCode.accessUntil,
    })
    .from(premiumGrant)
    .innerJoin(promoCode, eq(premiumGrant.promoCodeId, promoCode.id))
    .where(and(eq(premiumGrant.householdId, householdId), isNull(premiumGrant.revokedAt)))
    .all();

  // A null end means no end date, which beats any date.
  const later = (a: Date | null, b: Date | null) => (a === null ? b !== null : b !== null && a > b);
  let best: GrantInput | null = null;
  for (const row of rows) {
    const endsAt = row.endsAt ?? row.accessUntil;
    if (!isPaidTier(row.tier) || (endsAt && endsAt <= now) || row.startsAt > now) continue;
    if (
      !best ||
      RANK[row.tier] > RANK[best.tier] ||
      (RANK[row.tier] === RANK[best.tier] && later(endsAt, best.endsAt))
    ) {
      best = { tier: row.tier, endsAt };
    }
  }
  return best;
}
