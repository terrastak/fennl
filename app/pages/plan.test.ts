import { describe, expect, it } from "vitest";
import type { Entitlements } from "../../shared/entitlements";
import { formatBytes, planDetails, planName, planStatus } from "./plan";

const MB = 1024 * 1024;

const FREE: Entitlements = {
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
};

const HOUSEHOLD: Entitlements = {
  ...FREE,
  tier: "household",
  source: "promo_code",
  ends_at: "2027-01-05T12:00:00.000Z",
  max_members: 2,
  max_recipes: null,
  max_text_bytes: 100 * MB,
  max_devices: 10,
  image_quota_bytes: 4096 * MB,
  images_enabled: true,
  import_ai_enabled: true,
};

describe("plan display", () => {
  it("formats sizes the way people say them", () => {
    expect(formatBytes(3 * MB)).toBe("3 MB");
    expect(formatBytes(256 * 1024)).toBe("256 KB");
    expect(formatBytes(4096 * MB)).toBe("4 GB");
    expect(formatBytes(1.5 * MB)).toBe("1.5 MB");
  });

  it("describes Free", () => {
    expect(planName(FREE)).toBe("Free");
    expect(planStatus(FREE)).toBeNull();
    expect(planDetails(FREE)).toEqual([
      { label: "Recipes", value: "Up to 100" },
      { label: "Recipe text", value: "Up to 3 MB in total" },
      { label: "Devices", value: "One at a time" },
      { label: "Household", value: "Just you" },
      { label: "Photos", value: "Not included" },
      { label: "Import", value: "Paprika files and recipe web pages (text only)" },
    ]);
  });

  it("describes Premium from a code", () => {
    expect(planName(HOUSEHOLD)).toBe("Premium Household");
    expect(planStatus(HOUSEHOLD)).toMatch(
      /^Included with your code until .*2027\. After that you're on Free, and nothing is deleted\.$/,
    );
    expect(planStatus({ ...HOUSEHOLD, ends_at: null })).toBe(
      "Included with your code, with no end date.",
    );
    expect(planStatus({ ...HOUSEHOLD, source: "subscription" })).toMatch(
      /^Premium until .*2027, then Free\. Nothing is deleted\.$/,
    );
    expect(planDetails(HOUSEHOLD)).toContainEqual({ label: "Recipes", value: "Unlimited" });
    expect(planDetails(HOUSEHOLD)).toContainEqual({ label: "Photos", value: "Up to 4 GB" });
    expect(planDetails(HOUSEHOLD)).toContainEqual({ label: "Household", value: "Up to 2 people" });
  });

  it("names trials and paid plans, and explains a failed payment", () => {
    expect(planName({ ...HOUSEHOLD, source: "subscription", trialing: true })).toBe(
      "Premium Household (trial)",
    );
    expect(planName({ ...HOUSEHOLD, tier: "individual", source: "subscription" })).toBe(
      "Premium Individual",
    );
    expect(planStatus({ ...HOUSEHOLD, source: "subscription", past_due: true })).toMatch(
      /didn't go through/,
    );
  });
});
