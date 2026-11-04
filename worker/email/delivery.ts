import { lt } from "drizzle-orm";
import { EMAIL_RECORD_DAYS } from "../../shared/emailDelivery";
import type { Database } from "../db/client";
import { emailMessage } from "../db/schema";
import type { EmailMessage, SentEmail } from "./email";

/** The longest reason from a mail server Fennl keeps. */
export const MAX_DETAIL_LENGTH = 500;

/**
 * Records one email sent for an account (phase U14): its kind, the address and when, never its
 * words. A refusal by the email service is recorded as `failed` with its reason (which never
 * holds the key: ./resend.ts).
 */
export async function recordSentEmail(
  db: Database,
  message: EmailMessage,
  outcome: SentEmail | Error,
  now = new Date(),
): Promise<void> {
  if (!message.userId) return;
  const failed = outcome instanceof Error;
  await db.insert(emailMessage).values({
    id: crypto.randomUUID(),
    providerId: failed ? null : outcome.id,
    userId: message.userId,
    kind: message.kind,
    toAddress: message.to.trim().toLowerCase(),
    sentAt: now,
    status: failed ? "failed" : "sent",
    statusAt: now,
    detail: failed ? outcome.message.slice(0, MAX_DETAIL_LENGTH) : null,
  });
}

/**
 * Records a sign-up link Fennl didn't send (phase U14): the person asked for it at an address
 * another account uses (worker/account/signUpRoutes.ts). Recorded so "Check your email" answers
 * as it does for a link sent, and nothing shows which addresses have accounts.
 */
export async function recordWithheldLink(
  db: Database,
  userId: string,
  address: string,
  now = new Date(),
): Promise<void> {
  await db.insert(emailMessage).values({
    id: crypto.randomUUID(),
    providerId: null,
    userId,
    kind: "verification",
    toAddress: address.trim().toLowerCase(),
    sentAt: now,
    status: "withheld",
    statusAt: now,
    detail: null,
  });
}

/** Records are kept 90 days, then removed by the hourly job. */
export async function removeOldEmailMessages(db: Database, now = Date.now()): Promise<number> {
  const removed = await db
    .delete(emailMessage)
    .where(lt(emailMessage.sentAt, new Date(now - EMAIL_RECORD_DAYS * 24 * 60 * 60 * 1000)))
    .returning({ id: emailMessage.id })
    .all();
  return removed.length;
}
