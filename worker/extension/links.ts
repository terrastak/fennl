import { and, asc, count, eq, isNull } from "drizzle-orm";
import { EXTENSION_RULES, type ExtensionLinkSummary } from "../../shared/extension";
import type { Database } from "../db/client";
import { account, extensionLink } from "../db/schema";

// Connected Chrome extensions (phase E5). A key is 32 random bytes; only its SHA-256 is stored,
// so the table alone can't be used to act as anyone. Keys this long can't be guessed, so a plain
// hash (not a slow password hash) is enough.

const DAY = 24 * 60 * 60 * 1000;
/** How often last_used_at is written: often enough for the 90 days, without a write per request. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  return (
    EXTENSION_RULES.keyPrefix + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  );
}

/**
 * A fingerprint of the account's password as it is now (null without one), so any change to it
 * (changed, reset, a temporary one from support) is noticed and disconnects the extension.
 */
async function passwordMarker(db: Database, userId: string): Promise<string | null> {
  const row = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .get();
  return row?.password ? sha256(`fennl-extension:${row.password}`) : null;
}

export type CreateLinkResult = { key: string; id: string } | { error: "too_many" };

/** Connects an extension: a new key for the person, returned once. */
export async function createLink(
  db: Database,
  userId: string,
  label: string,
  now = new Date(),
): Promise<CreateLinkResult> {
  const active = await db
    .select({ n: count() })
    .from(extensionLink)
    .where(and(eq(extensionLink.userId, userId), isNull(extensionLink.revokedAt)))
    .get();
  if ((active?.n ?? 0) >= EXTENSION_RULES.maxLinks) return { error: "too_many" };
  const key = newKey();
  const id = crypto.randomUUID();
  await db.insert(extensionLink).values({
    id,
    userId,
    label: label.slice(0, 100),
    keyHash: await sha256(key),
    passwordMarker: await passwordMarker(db, userId),
    createdAt: now,
    lastUsedAt: now,
  });
  return { key, id };
}

async function revoke(db: Database, id: string, reason: string, now: Date) {
  await db
    .update(extensionLink)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(extensionLink.id, id), isNull(extensionLink.revokedAt)));
}

/**
 * The connection a key belongs to, if it still works. A key unused for 90 days, or made before
 * the account's password changed, is revoked here and refused.
 */
export async function linkForKey(
  db: Database,
  key: string,
  now = new Date(),
): Promise<{ id: string; userId: string } | null> {
  const link = await db
    .select()
    .from(extensionLink)
    .where(eq(extensionLink.keyHash, await sha256(key)))
    .get();
  if (!link || link.revokedAt) return null;
  if (now.getTime() - link.lastUsedAt.getTime() > EXTENSION_RULES.unusedDays * DAY) {
    await revoke(db, link.id, "unused", now);
    return null;
  }
  if ((await passwordMarker(db, link.userId)) !== link.passwordMarker) {
    await revoke(db, link.id, "password_changed", now);
    return null;
  }
  if (now.getTime() - link.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await db.update(extensionLink).set({ lastUsedAt: now }).where(eq(extensionLink.id, link.id));
  }
  return { id: link.id, userId: link.userId };
}

/** The person's connected extensions that still work, oldest first. */
export async function listLinks(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<ExtensionLinkSummary[]> {
  const rows = await db
    .select()
    .from(extensionLink)
    .where(and(eq(extensionLink.userId, userId), isNull(extensionLink.revokedAt)))
    .orderBy(asc(extensionLink.createdAt))
    .all();
  const marker = await passwordMarker(db, userId);
  return rows
    .filter(
      (row) =>
        row.passwordMarker === marker &&
        now.getTime() - row.lastUsedAt.getTime() <= EXTENSION_RULES.unusedDays * DAY,
    )
    .map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
    }));
}

/** Disconnects one of the person's extensions. False if it isn't theirs or is already gone. */
export async function removeLink(
  db: Database,
  userId: string,
  id: string,
  reason: "removed" | "disconnected",
  now = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(extensionLink)
    .set({ revokedAt: now, revokedReason: reason })
    .where(
      and(
        eq(extensionLink.id, id),
        eq(extensionLink.userId, userId),
        isNull(extensionLink.revokedAt),
      ),
    )
    .returning({ id: extensionLink.id })
    .all();
  return rows.length > 0;
}
