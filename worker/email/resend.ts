import type { EmailMessage, SendEmail } from "./email";

const RESEND_API = "https://api.resend.com/emails";

/**
 * Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Only the email itself goes to Resend, never its kind or whose it is.
 * Open and click tracking are settings on the sending domain in Resend and stay off for
 * account emails, so links in them are never rewritten.
 */
export function resendSender(config: { apiKey: string; from: string }): SendEmail {
  return async (message: EmailMessage) => {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!res.ok) {
      // Resend's error body says what went wrong (bad key, unverified domain...). Never log the key.
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend refused the email (${res.status}): ${detail.slice(0, 500)}`);
    }
    // Resend answers with its id for the email, which its webhook events name (phase U14).
    const answer = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { id: typeof answer?.id === "string" ? answer.id : null };
  };
}
