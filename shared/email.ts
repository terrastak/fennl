/**
 * Changing an account's email address (phase B7a). Shared by the Worker, the app and the admin
 * console. Dates are ISO strings.
 */

/** How long the link sent to a new address works. */
export const EMAIL_CHANGE_HOURS = 24;

/** The longest address accepted (the limit for an email address in practice). */
const MAX_EMAIL_LENGTH = 254;

/**
 * An address as Fennl stores it (trimmed, lower case), or null if it doesn't look like one. The
 * real check is the link sent to it.
 */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** The account's email, as Settings shows it. */
export interface EmailStatus {
  email: string;
  emailVerified: boolean;
  /** Null when the date wasn't recorded (accounts verified before B7a). */
  emailVerifiedAt: string | null;
  /** A change waiting for the link sent to the new address. */
  pending: { email: string; expiresAt: string } | null;
}

/** What opening the link in the email led to. */
export type EmailChangeResult = "done" | "expired" | "invalid" | "in_use";

/** Why a change couldn't start. */
export type EmailChangeProblem =
  | "invalid_email"
  | "same_email"
  | "email_in_use"
  | "sign_in_again"
  | "not_while_impersonating"
  | "too_many";

/** One row of an account's email history, for the admin console. */
export interface EmailHistoryEntry {
  /** "change" (waits for the new address to be verified) or "restore" (by an admin, at once). */
  kind: "change" | "restore";
  oldEmail: string;
  newEmail: string;
  /** The admin who did it; null when the person did it themselves. */
  adminEmail: string | null;
  requestedAt: string;
  expiresAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

/** "june@example.com" → "j•••@example.com", for the notice sent to the old address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}
