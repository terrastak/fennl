import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LIMIT_KEYS, TIERS } from "../../shared/entitlements";
import { database } from "../db/client";
import { limitOverride, planLimits } from "../db/schema";
import { signUpConfirmed, visitor, setUpDatabase } from "../test/visitor";
import {
  PLAN_LIMITS_CACHE_MS,
  forgetCachedPlanLimits,
  householdEntitlements,
  loadPlanLimits,
} from "./entitlements";

const MB = 1024 * 1024;
const db = () => database(env.DB);

beforeAll(async () => {
  await setUpDatabase();
});

beforeEach(() => {
  forgetCachedPlanLimits();
});

async function householdOf(v: Awaited<ReturnType<typeof signUpConfirmed>>) {
  const res = await v.request("/api/household");
  return ((await res.json()) as { id: string }).id;
}

describe("starting limits (migration 0004)", () => {
  it("cover every limit for every tier", async () => {
    const limits = await loadPlanLimits(db());
    for (const tier of TIERS) {
      expect(Object.keys(limits[tier] ?? {}).sort(), tier).toEqual([...LIMIT_KEYS].sort());
    }
  });

  it("match the decided numbers", async () => {
    const limits = await loadPlanLimits(db());
    expect(limits.free).toMatchObject({
      max_recipes: 100,
      max_text_bytes: 3 * MB,
      max_recipe_bytes: 256 * 1024,
      max_devices: 1,
    });
    expect(limits.individual).toMatchObject({
      max_recipes: null,
      max_text_bytes: 50 * MB,
      max_recipe_bytes: 256 * 1024,
    });
    expect(limits.household).toMatchObject({
      max_recipes: null,
      max_text_bytes: 100 * MB,
      max_recipe_bytes: 256 * 1024,
    });
  });
});

describe("GET /api/entitlements", () => {
  it("says a new account is Free", async () => {
    const v = await signUpConfirmed("new.free@example.com");
    const res = await v.request("/api/entitlements");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      tier: "free",
      source: "free",
      max_recipes: 100,
      max_text_bytes: 3 * MB,
      images_enabled: false,
      import_structured_enabled: true,
      import_ai_enabled: false,
    });
  });

  it("applies the household's own overrides, and nobody else's", async () => {
    const june = await signUpConfirmed("june.limits@example.com");
    const rose = await signUpConfirmed("rose.limits@example.com");
    await db()
      .insert(limitOverride)
      .values({
        id: crypto.randomUUID(),
        householdId: await householdOf(june),
        key: "max_recipes",
        value: 150,
        note: "Friendly tester",
        createdAt: new Date(),
      });
    const junes = (await (await june.request("/api/entitlements")).json()) as {
      max_recipes: number;
    };
    const roses = (await (await rose.request("/api/entitlements")).json()) as {
      max_recipes: number;
    };
    expect(junes.max_recipes).toBe(150);
    expect(roses.max_recipes).toBe(100);
  });

  it("needs a signed-in account", async () => {
    expect((await visitor().request("/api/entitlements")).status).toBe(401);
  });
});

describe("changing a tier's limits", () => {
  it("takes effect within a minute, without a deploy", async () => {
    const v = await signUpConfirmed("cache.check@example.com");
    const householdId = await householdOf(v);
    const start = new Date("2026-10-03T12:00:00Z");
    expect((await householdEntitlements(db(), householdId, start)).max_recipes).toBe(100);

    const where = and(eq(planLimits.tier, "free"), eq(planLimits.key, "max_recipes"));
    await db().update(planLimits).set({ value: 150 }).where(where);
    try {
      const soon = new Date(start.getTime() + 1000);
      expect((await householdEntitlements(db(), householdId, soon)).max_recipes).toBe(100);
      const later = new Date(start.getTime() + PLAN_LIMITS_CACHE_MS);
      expect((await householdEntitlements(db(), householdId, later)).max_recipes).toBe(150);
    } finally {
      await db().update(planLimits).set({ value: 100 }).where(where);
    }
  });
});
