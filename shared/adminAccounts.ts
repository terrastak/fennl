/**
 * The admin console's account tools (phase B7). Shared by the Worker and the console.
 * Dates are ISO strings.
 */
import type { DeviceSummary } from "./devices";
import type { Entitlements, LimitKey } from "./entitlements";

/** One row of an account search. */
export interface AccountMatch {
  id: string;
  name: string;
  email: string;
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
  /** Recipes and storage arrive with the recipe box (Stage C): null until then. */
  usage: { recipes: number; textBytes: number } | null;
}

/** The tier limits table, as the console edits it. */
export interface PlanLimitRow {
  tier: string;
  key: LimitKey;
  value: number | null;
  updatedAt: string;
}
