import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  EMAIL_CHANGE_HOURS,
  type EmailChangeResult,
  type EmailHistoryEntry,
} from "../../shared/email";
import type { Database } from "../db/client";
import { emailChange, user } from "../db/schema";

// Changing an account's email address (phase B7a). Better Auth's own email change is off; this
// one keeps every change (email_change), so the admin console can show the history and put back
// an earlier address after a takeover.
//
// - A change waits for the link sent to the new address. Until it's opened the account keeps its
//   old address; after EMAIL_CHANGE_HOURS the link stops working and nothing changes.
// - A newer request, a cancel or a restore replaces a waiting one.
// - An admin's restore takes effect at once (that address was verified before).

const CHANGE_TTL_MS = EMAIL_CHANGE_HOURS * 60 * 60 * 1000;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The link's secret is only ever in the email; the database keeps its SHA-256. */
async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

/** True when another account already uses this address. */
export async function emailInUse(db: Database, email: string, exceptUserId?: string) {
  const row = await db
    .select({ id: user.id })
    .from(user)
    .where(
      exceptUserId ? and(eq(user.email, email), ne(user.id, exceptUserId)) : eq(user.email, email),
    )
    .get();
  return row !== undefined;
}

function cancelWaiting(db: Database, userId: string, now: Date) {
  return db
    .update(emailChange)
    .set({ cancelledAt: now })
    .where(
      and(
        eq(emailChange.userId, userId),
        eq(emailChange.kind, "change"),
        isNull(emailChange.completedAt),
        isNull(emailChange.cancelledAt),
      ),
    );
}

/**
 * Starts a change: replaces any waiting one and returns the link's secret, to be emailed to the
 * new address. The caller has already checked the address isn't the current one.
 */
export async function startEmailChange(
  db: Database,
  person: { id: string; email: string; emailVerifiedAt: Date | null },
  newEmail: string,
  adminUserId: string | null,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + CHANGE_TTL_MS);
  await db.batch([
    cancelWaiting(db, person.id, now),
    db.insert(emailChange).values({
      id: crypto.randomUUID(),
      userId: person.id,
      kind: "change",
      oldEmail: person.email,
      oldEmailVerifiedAt: person.emailVerifiedAt,
      newEmail,
      adminUserId,
      tokenHash: await hashToken(token),
      createdAt: now,
      expiresAt,
    }),
  ]);
  return { token, expiresAt };
}

/** Cancels a waiting change. Returns false if there wasn't one. */
export async function cancelEmailChange(db: Database, userId: string, now = new Date()) {
  const cancelled = await cancelWaiting(db, userId, now).returning({ id: emailChange.id }).all();
  return cancelled.length > 0;
}

/** The change waiting for its link, if any. */
export async function waitingEmailChange(db: Database, userId: string, now = new Date()) {
  return db
    .select()
    .from(emailChange)
    .where(
      and(
        eq(emailChange.userId, userId),
        eq(emailChange.kind, "change"),
        isNull(emailChange.completedAt),
        isNull(emailChange.cancelledAt),
        gt(emailChange.expiresAt, now),
      ),
    )
    .orderBy(desc(emailChange.createdAt))
    .get();
}

function isUniqueViolation(error: unknown): boolean {
  const text = String((error as { cause?: unknown }).cause ?? error);
  return /UNIQUE constraint failed/i.test(text) || /UNIQUE constraint failed/i.test(String(error));
}

export type CompletedChange =
  | { result: Exclude<EmailChangeResult, "done"> }
  | { result: "done"; userId: string; name: string; oldEmail: string; newEmail: string };

/**
 * Opens the link from the email: the new address takes effect and counts as verified. Works only
 * for the newest waiting change, within its time, while the account still has the address the
 * change started from.
 */
export async function completeEmailChange(
  db: Database,
  token: string,
  now = new Date(),
): Promise<CompletedChange> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { result: "invalid" };
  const change = await db
    .select()
    .from(emailChange)
    .where(eq(emailChange.tokenHash, await hashToken(token)))
    .get();
  if (!change || change.completedAt || change.cancelledAt) return { result: "invalid" };
  if (!change.expiresAt || change.expiresAt <= now) return { result: "expired" };

  const person = await db
    .select({ name: user.name })
    .from(user)
    .where(and(eq(user.id, change.userId), eq(user.email, change.oldEmail)))
    .get();
  if (!person) return { result: "invalid" };

  // Each statement checks the account still has the old address, so two clicks at once (or a
  // restore in between) change it at most once. The batch runs as one transaction: if another
  // account took the address meanwhile, the unique index refuses it and nothing changes.
  const stillOld = and(eq(user.id, change.userId), eq(user.email, change.oldEmail));
  try {
    const [changed] = await db.batch([
      db
        .update(user)
        .set({ email: change.newEmail, emailVerified: true, emailVerifiedAt: now, updatedAt: now })
        .where(stillOld)
        .returning({ id: user.id }),
      db
        .update(emailChange)
        .set({ completedAt: now })
        .where(
          and(
            eq(emailChange.id, change.id),
            sql`exists (select 1 from ${user} where ${user.id} = ${change.userId} and ${user.email} = ${change.newEmail})`,
          ),
        ),
      db
        .update(emailChange)
        .set({ cancelledAt: now })
        .where(
          and(
            eq(emailChange.userId, change.userId),
            ne(emailChange.id, change.id),
            isNull(emailChange.completedAt),
            isNull(emailChange.cancelledAt),
          ),
        ),
    ]);
    if (changed.length === 0) return { result: "invalid" };
  } catch (error) {
    if (isUniqueViolation(error)) return { result: "in_use" };
    throw error;
  }
  return {
    result: "done",
    userId: change.userId,
    name: person.name,
    oldEmail: change.oldEmail,
    newEmail: change.newEmail,
  };
}

/** Addresses this account used before (changed away from), newest first. */
export async function previousEmails(db: Database, userId: string, current: string) {
  const rows = await db
    .select({ email: emailChange.oldEmail, verifiedAt: emailChange.oldEmailVerifiedAt })
    .from(emailChange)
    .where(and(eq(emailChange.userId, userId), isNotNull(emailChange.completedAt)))
    .orderBy(desc(emailChange.completedAt))
    .all();
  const seen = new Map<string, Date | null>();
  for (const row of rows) {
    if (row.email !== current && !seen.has(row.email)) seen.set(row.email, row.verifiedAt);
  }
  return seen;
}

export type RestoreResult = "done" | "not_previous" | "email_in_use";

/**
 * An admin puts back an address the account used before. It takes effect at once, keeps the
 * date that address was first verified, and cancels any waiting change.
 */
export async function restoreEmail(
  db: Database,
  person: { id: string; email: string; emailVerifiedAt: Date | null },
  email: string,
  adminUserId: string,
  now = new Date(),
): Promise<RestoreResult> {
  const previous = await previousEmails(db, person.id, person.email);
  if (!previous.has(email)) return "not_previous";
  if (await emailInUse(db, email, person.id)) return "email_in_use";
  try {
    const [changed] = await db.batch([
      db
        .update(user)
        .set({
          email,
          emailVerified: true,
          emailVerifiedAt: previous.get(email) ?? null,
          updatedAt: now,
        })
        .where(and(eq(user.id, person.id), eq(user.email, person.email)))
        .returning({ id: user.id }),
      cancelWaiting(db, person.id, now),
      db.insert(emailChange).values({
        id: crypto.randomUUID(),
        userId: person.id,
        kind: "restore",
        oldEmail: person.email,
        oldEmailVerifiedAt: person.emailVerifiedAt,
        newEmail: email,
        adminUserId,
        createdAt: now,
        completedAt: now,
      }),
    ]);
    if (changed.length === 0) throw new Error("The account's email changed during the restore.");
  } catch (error) {
    if (isUniqueViolation(error)) return "email_in_use";
    throw error;
  }
  return "done";
}

/** Every change to the account's email, newest first, for the admin console. */
export async function emailHistory(db: Database, userId: string): Promise<EmailHistoryEntry[]> {
  const rows = await db
    .select()
    .from(emailChange)
    .where(eq(emailChange.userId, userId))
    .orderBy(desc(emailChange.createdAt))
    .all();
  const adminIds = [...new Set(rows.flatMap((r) => (r.adminUserId ? [r.adminUserId] : [])))];
  const admins = adminIds.length
    ? await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(inArray(user.id, adminIds))
        .all()
    : [];
  const adminEmail = new Map(admins.map((a) => [a.id, a.email]));
  return rows.map((row) => ({
    kind: row.kind === "restore" ? "restore" : "change",
    oldEmail: row.oldEmail,
    newEmail: row.newEmail,
    adminEmail: row.adminUserId ? (adminEmail.get(row.adminUserId) ?? "(removed admin)") : null,
    requestedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  }));
}
