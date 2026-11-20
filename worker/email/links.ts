import { and, eq, isNull } from "drizzle-orm";
import { database, type Database } from "../db/client";
import { emailMessage } from "../db/schema";

// When an email's link did its job (U26): an address verified, a password chosen, a new address
// confirmed, or a photo email's Account page opened by the person, signed in. The email's record
// keeps the SHA-256 of what identifies its link (the token in it, or a ref), never the link.

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the record keeps for a link's token or ref. */
export async function linkRefHash(ref: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ref)));
}

/**
 * Marks the email whose link carried this token or ref as used, the first time only. With
 * `userId`, only that person's email (a photo email's ref comes from the app, signed in).
 * Returns whether an email was marked.
 */
export async function markLinkUsed(
  db: Database,
  ref: string,
  options: { userId?: string } = {},
  now = new Date(),
): Promise<boolean> {
  if (!ref || ref.length > 512) return false;
  const hash = await linkRefHash(ref);
  const marked = await db
    .update(emailMessage)
    .set({ linkUsedAt: now })
    .where(
      and(
        eq(emailMessage.linkRef, hash),
        isNull(emailMessage.linkUsedAt),
        options.userId ? eq(emailMessage.userId, options.userId) : undefined,
      ),
    )
    .returning({ id: emailMessage.id })
    .all();
  return marked.length > 0;
}

/** After a password was chosen from the emailed link: marks that email (worker/index.ts). */
export async function markResetLinkUsed(env: Env, request: Request): Promise<void> {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof body?.token === "string") await markLinkUsed(database(env.DB), body.token);
}
