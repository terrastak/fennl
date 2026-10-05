/**
 * Codes that give free Premium: beta invites and promo codes (phase B5). Shared by the Worker,
 * the app and the admin console.
 */

/** Why a code can't be used right now. */
export const CODE_PROBLEMS = [
  "not_found",
  "disabled",
  "expired",
  "used_up",
  "no_sign_up",
  "already_used",
] as const;
export type CodeProblem = (typeof CODE_PROBLEMS)[number];

/** Error codes Better Auth passes back when sign-up is refused for want of a code. */
export const SIGN_UP_CODE_ERRORS = {
  required: "INVITE_CODE_REQUIRED",
  invalid: "INVITE_CODE_INVALID",
} as const;

/** How long a code's Premium lasts: until a date, a number of days from each use, or no end. */
export type CodeAccess = { until: string } | { days: number } | { forever: true };

/** Plain English for a code problem, for the person who typed it. */
export function codeProblemMessage(problem: CodeProblem | "rate_limited" | "invalid"): string {
  switch (problem) {
    case "not_found":
    case "invalid":
      return "We don't recognise that code. Check it and try again.";
    case "disabled":
    case "expired":
      return "That code has expired.";
    case "used_up":
      return "That code has been used as many times as it allows.";
    case "no_sign_up":
      return "That code can't be used to create an account. Ask for an invite code.";
    case "already_used":
      return "You've already used that code.";
    case "rate_limited":
      return "Too many tries. Please wait a few minutes, then try again.";
  }
}

export type CodeTier = "individual" | "household";

/** A code as the admin console lists it. Dates are ISO strings. */
export interface AdminCode {
  id: string;
  code: string;
  label: string;
  tier: CodeTier;
  access: CodeAccess;
  allowsSignUp: boolean;
  maxUses: number | null;
  uses: number;
  redeemBy: string | null;
  disabledAt: string | null;
  createdAt: string;
  /** Whether someone could use it right now, and if not, why. */
  status: "active" | "disabled" | "expired" | "used_up";
}

/** One person who used a code, for the admin console. */
export interface AdminCodeUse {
  name: string;
  email: string;
  usedAt: string;
  /**
   * When their Premium from this code ends (for "until a date" codes, the code's date). Null for
   * a code with no end date.
   */
  endsAt: string | null;
  /** Ended early by an admin. */
  ended: boolean;
}

/** What the admin console sends to make a code. */
export interface NewCode {
  /** Leave out for a random one. */
  code?: string | undefined;
  label: string;
  tier: CodeTier;
  access: CodeAccess;
  allowsSignUp: boolean;
  maxUses: number | null;
  redeemBy: string | null;
}

/** What the admin console may change on an existing code. */
export interface CodeChanges {
  label?: string;
  /** Only for "until a date" codes: moves the end for everyone who used it. */
  accessUntil?: string;
  maxUses?: number | null;
  redeemBy?: string | null;
}
