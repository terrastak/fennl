/**
 * What Fennl knows about the emails it sends (phase U14): which kind each one is, and what
 * happened to it after the email service took it. Shared by the Worker, the app and (U15) the
 * admin console.
 */

/** Every kind of email Fennl sends. Owner notices aren't recorded per account. */
export type EmailKind =
  | "verification"
  | "password_reset"
  | "email_change"
  | "email_changed"
  | "temporary_password"
  | "photo_grace_started"
  | "photo_grace_reminder"
  | "owner_notice";

/**
 * What happened to one email: `sent` (the email service took it), then what its events said.
 * `bounced` is a permanent bounce; `soft_bounced` a temporary or undetermined one; `suppressed`
 * means the email service skipped it because the address is on its list of addresses that
 * bounced or marked an email as spam; `failed` means it was never sent; `withheld` means Fennl
 * didn't send it: a sign-up link asked for at an address another account uses.
 */
export type EmailDeliveryStatus =
  | "sent"
  | "delivered"
  | "delayed"
  | "bounced"
  | "soft_bounced"
  | "complained"
  | "suppressed"
  | "failed"
  | "withheld";

/** Why an account's address isn't getting Fennl's emails (`user.email_problem`). */
export type EmailProblem = "bounced" | "complained" | "suppressed";

/** The statuses that mean an address is not arriving, and raise the notice across the app. */
export const EMAIL_PROBLEMS: readonly EmailProblem[] = ["bounced", "complained", "suppressed"];

export function isEmailProblem(value: unknown): value is EmailProblem {
  return typeof value === "string" && (EMAIL_PROBLEMS as readonly string[]).includes(value);
}

/** How long each email's record is kept. */
export const EMAIL_RECORD_DAYS = 90;

/**
 * What "Check your email" shows (GET /api/sign-up/status): the link is on its way (`waiting`),
 * slow (`delayed`), bounced or was blocked (`not_arriving`), or couldn't be sent (`not_sent`).
 */
export type SignUpEmailState = "waiting" | "delayed" | "not_arriving" | "not_sent";
