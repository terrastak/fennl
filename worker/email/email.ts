import type { EmailKind } from "../../shared/emailDelivery";
import { database } from "../db/client";
import { recordSentEmail } from "./delivery";
import { devOutbox } from "./outbox";
import { resendSender } from "./resend";

/** One email's content, always with both a plain-text and an HTML version (./templates.ts). */
export interface EmailContent {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** One email to send: its content, which kind it is and whose account it's about. */
export interface EmailMessage extends EmailContent {
  kind: EmailKind;
  /** The account it's sent for; null for notices to Fennl's owner (not recorded). */
  userId: string | null;
}

/** What the email service answered: its id for the email, when it gives one. */
export interface SentEmail {
  id: string | null;
}

/**
 * The one way Fennl sends email. Everything goes through this function, so changing email
 * services means writing one new adapter (like ./resend.ts) and choosing it here.
 */
export type SendEmail = (message: EmailMessage) => Promise<SentEmail>;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email sending is not configured: set RESEND_API_KEY and EMAIL_FROM.");
    this.name = "EmailNotConfiguredError";
  }
}

function adapter(env: Env): SendEmail {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    return resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  }
  if (env.DEV_EMAIL_OUTBOX === "true") return devOutbox.send;
  return async () => {
    throw new EmailNotConfiguredError();
  };
}

/**
 * Picks the email service, and records every email sent for an account (phase U14,
 * ./delivery.ts), including one the service refused outright, which is then rethrown.
 */
export function createEmailSender(env: Env): SendEmail {
  const send = adapter(env);
  const record = async (message: EmailMessage, outcome: { id: string | null } | Error) => {
    if (!message.userId || !env.DB) return;
    try {
      await recordSentEmail(database(env.DB), message, outcome);
    } catch (error) {
      console.error("Couldn't record a sent email", error);
    }
  };
  return async (message) => {
    let sent: SentEmail;
    try {
      sent = await send(message);
    } catch (error) {
      await record(message, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    await record(message, sent);
    return sent;
  };
}
