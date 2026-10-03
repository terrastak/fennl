import { describe, expect, it } from "vitest";
import type { Limits, PaidTier } from "../../shared/entitlements";
import {
  computeEntitlements,
  type EntitlementInputs,
  type PlanLimits,
  type SubscriptionStatus,
} from "./compute";

const MB = 1024 * 1024;
const NOW = new Date("2026-10-03T12:00:00Z");
const LATER = new Date("2026-11-03T12:00:00Z");
const EARLIER = new Date("2026-09-03T12:00:00Z");

const tierLimits = (overrides: Partial<Limits>): Limits => ({
  max_recipes: null,
  max_text_bytes: 50 * MB,
  max_recipe_bytes: 256 * 1024,
  max_devices: 5,
  image_quota_bytes: 2048 * MB,
  image_quota_count: 5000,
  image_max_file_bytes: 10 * MB,
  ...overrides,
});

const PLAN_LIMITS: PlanLimits = {
  free: tierLimits({
    max_recipes: 100,
    max_text_bytes: 3 * MB,
    max_devices: 1,
    image_quota_bytes: 0,
    image_quota_count: 0,
    image_max_file_bytes: 0,
  }),
  individual: tierLimits({}),
  household: tierLimits({ max_text_bytes: 100 * MB, max_devices: 10 }),
  trial: { image_quota_bytes: 100 * MB, image_quota_count: 200 },
};

function compute(inputs: Partial<EntitlementInputs> = {}) {
  return computeEntitlements({
    now: NOW,
    subscription: null,
    grant: null,
    planLimits: PLAN_LIMITS,
    overrides: [],
    ...inputs,
  });
}

const sub = (plan: PaidTier, status: SubscriptionStatus, periodEnd: Date | null = LATER) => ({
  subscription: { plan, status, periodEnd },
});

describe("free", () => {
  it("is what a household with no plan and no grant gets", () => {
    expect(compute()).toEqual({
      tier: "free",
      source: "free",
      trialing: false,
      past_due: false,
      ends_at: null,
      max_members: 1,
      max_recipes: 100,
      max_text_bytes: 3 * MB,
      max_recipe_bytes: 256 * 1024,
      max_devices: 1,
      image_quota_bytes: 0,
      image_quota_count: 0,
      image_max_file_bytes: 0,
      images_enabled: false,
      offline_enabled: false,
      history_enabled: false,
      import_structured_enabled: true,
      import_ai_enabled: false,
    });
  });
});

describe.each(["individual", "household"] as const)("%s plan", (plan) => {
  const premium = {
    tier: plan,
    images_enabled: true,
    offline_enabled: true,
    history_enabled: true,
    import_structured_enabled: true,
    import_ai_enabled: true,
    max_members: plan === "household" ? 2 : 1,
    max_recipes: null,
  };

  it("active: full Premium", () => {
    expect(compute(sub(plan, "active"))).toMatchObject({
      ...premium,
      source: "subscription",
      trialing: false,
      past_due: false,
      ends_at: null,
      max_text_bytes: plan === "household" ? 100 * MB : 50 * MB,
    });
  });

  it("trialing: Premium with the trial's lower image quotas", () => {
    expect(compute(sub(plan, "trialing"))).toMatchObject({
      ...premium,
      trialing: true,
      image_quota_bytes: 100 * MB,
      image_quota_count: 200,
    });
  });

  it("past due: nothing is taken away while the payment is retried", () => {
    expect(compute(sub(plan, "past_due"))).toMatchObject({ ...premium, past_due: true });
  });

  it("cancelled: Premium until the paid period ends, then Free", () => {
    expect(compute(sub(plan, "canceled", LATER))).toMatchObject({
      ...premium,
      ends_at: LATER.toISOString(),
    });
    expect(compute(sub(plan, "canceled", EARLIER))).toMatchObject({ tier: "free" });
    expect(compute(sub(plan, "canceled", null))).toMatchObject({ tier: "free" });
  });

  it("resubscribed after cancelling: Premium again", () => {
    expect(compute(sub(plan, "active"))).toMatchObject(premium);
  });

  it.each(["incomplete", "incomplete_expired", "unpaid", "paused"] as const)(
    "%s: Free",
    (status) => {
      expect(compute(sub(plan, status))).toMatchObject({ tier: "free", source: "free" });
    },
  );

  it("beta grant: Premium until the grant ends, then Free", () => {
    expect(compute({ grant: { tier: plan, endsAt: LATER } })).toMatchObject({
      ...premium,
      source: "beta_grant",
      ends_at: LATER.toISOString(),
    });
    expect(compute({ grant: { tier: plan, endsAt: EARLIER } })).toMatchObject({
      tier: "free",
      source: "free",
    });
    expect(compute({ grant: { tier: plan, endsAt: NOW } })).toMatchObject({ tier: "free" });
  });
});

describe("a plan and a beta grant together", () => {
  it("use whichever gives more", () => {
    expect(
      compute({ ...sub("individual", "active"), grant: { tier: "household", endsAt: LATER } }),
    ).toMatchObject({ tier: "household", source: "beta_grant" });
    expect(
      compute({ ...sub("household", "active"), grant: { tier: "individual", endsAt: LATER } }),
    ).toMatchObject({ tier: "household", source: "subscription" });
  });

  it("prefer the plan when they give the same", () => {
    expect(
      compute({ ...sub("individual", "active"), grant: { tier: "individual", endsAt: LATER } }),
    ).toMatchObject({ source: "subscription" });
  });

  it("fall back to the grant when the plan lapses", () => {
    expect(
      compute({ ...sub("household", "unpaid"), grant: { tier: "individual", endsAt: LATER } }),
    ).toMatchObject({ tier: "individual", source: "beta_grant" });
  });
});

describe("per-household overrides", () => {
  it("beat the tier's limit until they expire", () => {
    const overrides = [
      { key: "max_recipes" as const, value: 150, expiresAt: LATER },
      { key: "max_devices" as const, value: 3, expiresAt: null },
      { key: "max_text_bytes" as const, value: 10 * MB, expiresAt: EARLIER },
    ];
    expect(compute({ overrides })).toMatchObject({
      max_recipes: 150,
      max_devices: 3,
      max_text_bytes: 3 * MB,
    });
  });

  it("can lift a limit entirely", () => {
    const overrides = [{ key: "max_recipes" as const, value: null, expiresAt: null }];
    expect(compute({ overrides }).max_recipes).toBeNull();
  });

  it("never change what the tier itself includes", () => {
    const overrides = [{ key: "image_quota_bytes" as const, value: 10 * MB, expiresAt: null }];
    expect(compute({ overrides })).toMatchObject({ tier: "free", images_enabled: false });
  });
});

describe("missing limits", () => {
  it("count as zero, so a gap in plan_limits blocks rather than allows", () => {
    const { max_recipes, ...freeWithoutRecipes } = PLAN_LIMITS.free!;
    void max_recipes;
    expect(compute({ planLimits: { ...PLAN_LIMITS, free: freeWithoutRecipes } }).max_recipes).toBe(
      0,
    );
    expect(compute({ planLimits: {} })).toMatchObject({ max_recipes: 0, max_text_bytes: 0 });
  });
});
