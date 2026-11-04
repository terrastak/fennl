/**
 * The admin console's account tools (phase B7). Shared by the Worker and the console.
 * Dates are ISO strings.
 */
import type { Finding, FindingKey, HistoryEntry } from "./accountFindings";
import type { DeviceSummary } from "./devices";
import type { EmailHistoryEntry } from "./email";
import type { EmailProblem } from "./emailDelivery";
import type { Entitlements, LimitKey, PaidTier } from "./entitlements";
import type { PhotoUsage, Usage } from "./limits";

export type {
  Finding,
  FindingAction,
  FindingKey,
  HistoryCategory,
  HistoryEntry,
} from "./accountFindings";

/** One row of an account search. */
export interface AccountMatch {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** Null when not verified, or verified before the date was recorded (B7a). */
  emailVerifiedAt: string | null;
  createdAt: string;
}

/** A per-household exception to one limit (limit_override). */
export interface AccountOverride {
  key: LimitKey;
  /** Null: no limit. */
  value: number | null;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
}

/** Premium from a code, as the account page shows it. */
export interface AccountGrant {
  code: string;
  label: string;
  tier: string;
  usedAt: string;
  endsAt: string | null;
  ended: boolean;
}

/** Everything the account page shows. */
export interface AccountDetail {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** Null when not verified, or verified before the date was recorded (B7a). */
  emailVerifiedAt: string | null;
  /** A change waiting for the link sent to the new address. */
  pendingEmailChange: { email: string; expiresAt: string; bySupport: boolean } | null;
  /** Addresses the account used before, which an admin can put back. */
  previousEmails: string[];
  /** Every change to the account's email, newest first. */
  emailHistory: EmailHistoryEntry[];
  role: string | null;
  createdAt: string;
  /** The latest of its sessions and devices; null if it never signed in. */
  lastSeenAt: string | null;
  /** "credential" (email and password), "google", "apple". */
  signInMethods: string[];
  mustChangePassword: boolean;
  household: { id: string; name: string; members: { name: string; email: string }[] } | null;
  plan: Entitlements | null;
  grants: AccountGrant[];
  devices: DeviceSummary[];
  overrides: AccountOverride[];
  /** The household's recipes and recipe text against its limits (with photos); null without one. */
  usage: Usage | null;
  /** The household's photos against its quota (U15); null without a household. */
  photos: PhotoUsage | null;
  /** Why the address isn't getting Fennl's emails (U14), or null. */
  emailProblem: EmailProblem | null;
  /** Premium given by an admin without a code (U15), newest first. */
  adminGrants: AccountAdminGrant[];
  /** Feedback messages from the account not read yet. */
  unreadFeedback: number;
}

/** Premium given by an admin without a code ("Extend Premium", U15). */
export interface AccountAdminGrant {
  tier: PaidTier;
  startsAt: string;
  endsAt: string;
  /** Replaced by a later one, or otherwise ended early. */
  revokedAt: string | null;
  /** The admin who gave it (their name), if the account still exists. */
  by: string | null;
  createdAt: string;
}

/** GET /api/admin/accounts/:id/overview: "What's going on" and "What happened" (U15). */
export interface AccountOverview {
  findings: Finding[];
  /** The checks that found nothing, by plain names. */
  fine: string[];
  /** Everything on the account, newest first; the page filters by category and period. */
  history: HistoryEntry[];
}

/** One account on the console's Needs attention list (U15). */
export interface AttentionItem {
  userId: string;
  name: string;
  email: string;
  /** The newest Needs-you finding not marked handled. */
  finding: { key: FindingKey; title: string };
  /** The account's other Needs-you findings' titles. */
  more: string[];
  /** When the finding started (ISO), when known. */
  since: string | null;
}

/** Someone in a Coming up item. */
export interface ComingUpPerson {
  userId: string;
  name: string;
  email: string;
}

/**
 * Something about to happen (U15): free Premium ending (grouped by code and date; `code` null for
 * Premium given by support), photos to be deleted, or a photo reminder to be sent.
 */
export interface ComingUpItem {
  kind: "premium_ending" | "photos_deleted" | "photo_reminder";
  /** When (ISO). */
  at: string;
  title: string;
  body: string;
  code: string | null;
  people: ComingUpPerson[];
  /** How many of them would then be over Free's recipe limits (premium_ending only). */
  overFreeLimits: number;
}

/** This week's emails by what last happened to them (U15). */
export interface EmailsThisWeek {
  sent: number;
  delivered: number;
  bounced: number;
  spam: number;
}

/** GET /api/admin/attention: the console's Needs attention page (U15). */
export interface AttentionOverview {
  items: AttentionItem[];
  comingUp: ComingUpItem[];
  emailsThisWeek: EmailsThisWeek;
}

/** POST /api/admin/accounts/:id/email/unblock (U15). */
export interface UnblockAnswer {
  /** removed: off Resend's blocked list; not_blocked: it wasn't on it; not_configured: no key. */
  result: "removed" | "not_blocked" | "not_configured" | "failed";
  detail: AccountDetail;
}

/** The tier limits table, as the console edits it. */
export interface PlanLimitRow {
  tier: string;
  key: LimitKey;
  value: number | null;
  updatedAt: string;
}
