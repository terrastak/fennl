import type { EmailMessage, SentEmail } from "./email";

/**
 * Local development and tests only (DEV_EMAIL_OUTBOX=true, no RESEND_API_KEY): emails are kept
 * in memory so you can open the links without a real inbox. Read them at /api/dev/outbox.
 */
const messages: (EmailMessage & { id: string; sentAt: string })[] = [];

export const devOutbox = {
  /** Answers with a made-up id, which tests use to send the email's events (phase U14). */
  async send(message: EmailMessage): Promise<SentEmail> {
    const id = `dev-${crypto.randomUUID()}`;
    messages.push({ ...message, id, sentAt: new Date().toISOString() });
    if (messages.length > 50) messages.shift();
    console.log(`[dev outbox] To ${message.to}: ${message.subject}\n${message.text}`);
    return { id };
  },
  /** Newest first, optionally only those sent to one address. */
  list(to?: string) {
    return messages.filter((m) => !to || m.to.toLowerCase() === to.toLowerCase()).reverse();
  },
};
