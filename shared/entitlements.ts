/**
 * What a household is allowed to do (CLAUDE.md, "Entitlements model"). The server computes this;
 * the app only displays it. Never trust these values when they come from a client.
 *
 * Field names follow CLAUDE.md. A limit of `null` means "no limit".
 */
export const TIERS = ["free", "individual", "household"] as const;
export type Tier = (typeof TIERS)[number];
export type PaidTier = Exclude<Tier, "free">;

/**
 * Limits that live in the plan_limits table (per tier) and limit_override (per household), so
 * they can be changed without a deploy. Values are counts or bytes; null means unlimited.
 */
export const LIMIT_KEYS = [
  "max_recipes",
  "max_text_bytes",
  "max_recipe_bytes",
  "max_devices",
  "image_quota_bytes",
  "image_quota_count",
  "image_max_file_bytes",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type Limits = Record<LimitKey, number | null>;

export function isLimitKey(value: unknown): value is LimitKey {
  return typeof value === "string" && (LIMIT_KEYS as readonly string[]).includes(value);
}

/** Where the household's tier comes from. */
export type EntitlementSource = "free" | "subscription" | "beta_grant";

export interface Entitlements extends Limits {
  tier: Tier;
  source: EntitlementSource;
  /** A paid plan in its trial period (lower image quotas). */
  trialing: boolean;
  /** A payment failed and is being retried. Nothing is taken away meanwhile. */
  past_due: boolean;
  /** When the current tier ends, if it's known to end (a beta grant, or a cancelled plan). */
  ends_at: string | null;
  max_members: number;
  images_enabled: boolean;
  offline_enabled: boolean;
  history_enabled: boolean;
  import_structured_enabled: boolean;
  import_ai_enabled: boolean;
}
