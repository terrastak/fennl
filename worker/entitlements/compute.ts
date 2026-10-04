import type {
  EntitlementSource,
  Entitlements,
  LimitKey,
  Limits,
  PaidTier,
  Tier,
} from "../../shared/entitlements";
import { LIMIT_KEYS } from "../../shared/entitlements";

/** Stripe subscription statuses (Stage I). */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export interface SubscriptionInput {
  plan: PaidTier;
  status: SubscriptionStatus;
  /** End of the current paid period. A cancelled plan stays active until then. */
  periodEnd: Date | null;
}

/** Free Premium from a beta invite or promo code (phase B5, worker/codes). */
export interface GrantInput {
  tier: PaidTier;
  endsAt: Date;
}

/**
 * Limits per tier, from plan_limits. The "trial" pseudo-tier holds the lower image quotas that
 * apply while a paid plan is trialing (CLAUDE.md, "R2 and image rules").
 */
export type PlanLimits = Partial<Record<Tier | "trial", Partial<Limits>>>;

/** An unexpired per-household exception from limit_override. */
export interface LimitOverride {
  key: LimitKey;
  value: number | null;
  expiresAt: Date | null;
}

export interface EntitlementInputs {
  now: Date;
  subscription: SubscriptionInput | null;
  grant: GrantInput | null;
  planLimits: PlanLimits;
  overrides: LimitOverride[];
}

const RANK: Record<Tier, number> = { free: 0, individual: 1, household: 2 };
const TRIAL_KEYS: LimitKey[] = ["image_quota_bytes", "image_quota_count"];

interface Standing {
  tier: Tier;
  source: EntitlementSource;
  trialing: boolean;
  pastDue: boolean;
  endsAt: Date | null;
}

/** What a subscription gives right now, or null if it gives nothing. */
function fromSubscription(sub: SubscriptionInput, now: Date): Standing | null {
  const standing = (extra: Partial<Standing> = {}): Standing => ({
    tier: sub.plan,
    source: "subscription",
    trialing: false,
    pastDue: false,
    endsAt: null,
    ...extra,
  });
  switch (sub.status) {
    case "active":
      return standing();
    case "trialing":
      return standing({ trialing: true });
    case "past_due":
      // Dunning: keep everything while the payment is retried (CLAUDE.md).
      return standing({ pastDue: true });
    case "canceled":
      // Paid up to the end of the period, then Free.
      return sub.periodEnd && sub.periodEnd > now ? standing({ endsAt: sub.periodEnd }) : null;
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
    case "paused":
      return null;
  }
}

function fromGrant(grant: GrantInput, now: Date): Standing | null {
  if (grant.endsAt <= now) return null;
  return {
    tier: grant.tier,
    source: "promo_code",
    trialing: false,
    pastDue: false,
    endsAt: grant.endsAt,
  };
}

const FREE: Standing = {
  tier: "free",
  source: "free",
  trialing: false,
  pastDue: false,
  endsAt: null,
};

/** The best of what the subscription and a code give. A subscription wins a tie. */
function standingFor(inputs: EntitlementInputs): Standing {
  const candidates = [
    inputs.subscription && fromSubscription(inputs.subscription, inputs.now),
    inputs.grant && fromGrant(inputs.grant, inputs.now),
  ].filter((s): s is Standing => s !== null);
  return candidates.reduce<Standing>(
    (best, next) => (RANK[next.tier] > RANK[best.tier] ? next : best),
    FREE,
  );
}

/**
 * A tier's limits, then the trial's lower image quotas, then the household's unexpired
 * overrides. A limit missing from plan_limits counts as 0 (fail closed), so a gap in the table
 * blocks rather than allows.
 */
function limitsFor(standing: Standing, inputs: EntitlementInputs): Limits {
  const tierLimits = inputs.planLimits[standing.tier] ?? {};
  const limits = Object.fromEntries(
    LIMIT_KEYS.map((key) => [key, key in tierLimits ? (tierLimits[key] ?? null) : 0]),
  ) as Limits;

  if (standing.trialing) {
    const trial = inputs.planLimits.trial ?? {};
    for (const key of TRIAL_KEYS) {
      const value = trial[key];
      if (value !== undefined && value !== null) {
        const current = limits[key];
        limits[key] = current === null ? value : Math.min(current, value);
      }
    }
  }

  for (const override of inputs.overrides) {
    if (override.expiresAt === null || override.expiresAt > inputs.now) {
      limits[override.key] = override.value;
    }
  }
  return limits;
}

/** The one answer to "what is this household allowed to do?". Pure: same inputs, same answer. */
export function computeEntitlements(inputs: EntitlementInputs): Entitlements {
  const standing = standingFor(inputs);
  const premium = standing.tier !== "free";
  return {
    tier: standing.tier,
    source: standing.source,
    trialing: standing.trialing,
    past_due: standing.pastDue,
    ends_at: standing.endsAt?.toISOString() ?? null,
    max_members: standing.tier === "household" ? 2 : 1,
    ...limitsFor(standing, inputs),
    images_enabled: premium,
    offline_enabled: premium,
    history_enabled: premium,
    // Paprika files and structured web pages cost nothing to import, so every tier gets them
    // (text only on Free). Anything that calls the AI is Premium (CLAUDE.md, "Import sources").
    import_structured_enabled: true,
    import_ai_enabled: premium,
  };
}
