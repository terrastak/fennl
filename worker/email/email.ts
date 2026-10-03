import { devOutbox } from "./outbox";
import { resendSender } from "./resend";

/** One email, always with both a plain-text and an HTML version. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * The one way Fennl sends email. Everything goes through this function, so changing email
 * services means writing one new adapter (like ./resend.ts) and choosing it here.
 */
export type SendEmail = (message: EmailMessage) => Promise<void>;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email sending is not configured: set RESEND_API_KEY and EMAIL_FROM.");
    this.name = "EmailNotConfiguredError";
  }
}

export function createEmailSender(env: Env): SendEmail {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    return resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  }
  if (env.DEV_EMAIL_OUTBOX === "true") return devOutbox.send;
  return async () => {
    throw new EmailNotConfiguredError();
  };
}
