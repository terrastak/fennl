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
  "image_uploads_per_minute",
  "image_uploads_per_day",
  "max_photos_per_recipe",
  /**
   * Imports that don't call the AI (web pages with recipe data, Paprika files) per person per
   * day. 0 turns them off for the tier (the Chrome extension then says Premium is required).
   */
  "structured_imports_per_day",
  /**
   * Imports read by the AI per household per calendar month (phase E7; 300 on Premium, decided
   * 2026-10-12). The automatic second look by a stronger model doesn't count; "Read again" does.
   * 0 turns AI import off for the tier (import_ai_enabled).
   */
  "ai_imports_per_month",
  /**
   * A hidden backstop: the estimated AI cost per household per calendar month, in US cents ($15
   * on Premium, decided 2026-10-12). Nobody is expected to reach it; it stops runaway costs.
   */
  "ai_cost_cents_per_month",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type Limits = Record<LimitKey, number | null>;

export function isLimitKey(value: unknown): value is LimitKey {
  return typeof value === "string" && (LIMIT_KEYS as readonly string[]).includes(value);
}

/** Where the household's tier comes from. */
export type EntitlementSource = "free" | "subscription" | "promo_code";

export interface Entitlements extends Limits {
  tier: Tier;
  source: EntitlementSource;
  /** A paid plan in its trial period (lower image quotas). */
  trialing: boolean;
  /** A payment failed and is being retried. Nothing is taken away meanwhile. */
  past_due: boolean;
  /** When the current tier ends, if it's known to end (Premium from a code, or a cancelled plan). */
  ends_at: string | null;
  max_members: number;
  images_enabled: boolean;
  offline_enabled: boolean;
  history_enabled: boolean;
  import_structured_enabled: boolean;
  import_ai_enabled: boolean;
}
