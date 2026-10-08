import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Usage } from "../../shared/limits";
import {
  RECIPE_SCHEMA_VERSION,
  emptyRecipeContent,
  recipeBytes,
  type RecipeContent,
} from "../../shared/recipe";
import type { ChangeResult, PullResponse, SyncChange } from "../../shared/sync";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import {
  householdOf,
  overrideLimit,
  setUpDatabase,
  signUpConfirmed,
  type Visitor,
} from "../test/visitor";

// Phase C11: plan limits on recipes. Over a limit nothing is lost or locked: only adding is
// refused, until there's room again.

beforeAll(async () => {
  await setUpDatabase();
});

const db = () => database(env.DB);
const id = () => crypto.randomUUID();
let counter = 0;

interface Person {
  v: Visitor;
  deviceId: string;
}

async function person(): Promise<Person> {
  const v = await signUpConfirmed(`cook-${++counter}@example.com`, "June Lee");
  const deviceId = id();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(await res.json()).toEqual({ status: "ok" });
  return { v, deviceId };
}

async function push(p: Person, changes: SyncChange[]) {
  const res = await p.v.request("/api/sync/push", {
    body: {
      deviceId: p.deviceId,
      schemaVersion: RECIPE_SCHEMA_VERSION,
      sentAt: Date.now(),
      changes,
    },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { results: ChangeResult[]; usage: Usage };
}

async function pull(p: Person) {
  const query = new URLSearchParams({
    deviceId: p.deviceId,
    schemaVersion: String(RECIPE_SCHEMA_VERSION),
    since: "",
  });
  const res = await p.v.request(`/api/sync/pull?${query.toString()}`);
  expect(res.status).toBe(200);
  return (await res.json()) as PullResponse;
}

const create = (recipeId: string, fields: Partial<RecipeContent> = {}): SyncChange => ({
  kind: "recipe",
  id: recipeId,
  create: { createdAt: new Date().toISOString(), import: null },
  fields: { ...emptyRecipeContent(), title: "Soup", ...fields },
  changedAt: Date.now(),
});
const edit = (recipeId: string, fields: Partial<RecipeContent>): SyncChange => ({
  kind: "recipe",
  id: recipeId,
  fields,
  changedAt: Date.now(),
});
const trash = (recipeId: string, deleted = true): SyncChange => ({
  kind: "recipe",
  id: recipeId,
  fields: {},
  deleted,
  changedAt: Date.now(),
});

const applied: ChangeResult = { status: "applied" };
const limit = (which: "max_recipes" | "max_text_bytes"): ChangeResult => ({
  status: "rejected",
  reason: "limit",
  limit: which,
});
const tooLarge: ChangeResult = {
  status: "rejected",
  reason: "invalid",
  issues: [{ path: "", problem: "too_large" }],
};

describe("the recipe count", () => {
  it("is Free's 100 to start with (plan_limits)", async () => {
    const june = await person();
    const { usage } = await pull(june);
    expect(usage).toEqual({
      recipes: 0,
      textBytes: 0,
      maxRecipes: 100,
      maxTextBytes: 3 * 1024 * 1024,
      maxRecipeBytes: 256 * 1024,
    });
  });

  it("refuses a new recipe past the limit, and everything sent for it", async () => {
    const june = await person();
    await overrideLimit(june.v, "max_recipes", 2);
    const [a, b, c] = [id(), id(), id()];
    const category = id();
    const answer = await push(june, [
      create(a),
      create(b),
      create(c),
      edit(c, { notes: "More salt" }),
      { kind: "opinion", recipeId: c, fields: { rating: 5 }, changedAt: Date.now() },
      { kind: "made", id: id(), recipeId: c, madeOn: "2026-10-08", changedAt: Date.now() },
      {
        kind: "category",
        id: category,
        create: {},
        fields: { name: "Soups", parentId: null, sortOrder: 0 },
        changedAt: Date.now(),
      },
      {
        kind: "recipeCategory",
        recipeId: c,
        categoryId: category,
        deleted: false,
        changedAt: Date.now(),
      },
    ]);
    expect(answer.results).toEqual([
      applied,
      applied,
      limit("max_recipes"),
      limit("max_recipes"),
      limit("max_recipes"),
      limit("max_recipes"),
      applied,
      limit("max_recipes"),
    ]);
    expect(answer.usage).toMatchObject({ recipes: 2, maxRecipes: 2 });
    expect((await pull(june)).recipes.map((r) => r.id).sort()).toEqual([a, b].sort());

    // Sent again later, the same new recipe is still turned away; nothing is half-saved.
    expect((await push(june, [create(c)])).results).toEqual([limit("max_recipes")]);
  });

  it("doesn't count Trash, and putting one back needs room", async () => {
    const june = await person();
    await overrideLimit(june.v, "max_recipes", 2);
    const [a, b, c] = [id(), id(), id()];
    await push(june, [create(a), create(b)]);

    // Moving one to Trash makes room.
    const moved = await push(june, [trash(a), create(c)]);
    expect(moved.results).toEqual([applied, applied]);
    expect(moved.usage.recipes).toBe(2);

    // Back from Trash only with room: here, none.
    expect((await push(june, [trash(a, false)])).results).toEqual([limit("max_recipes")]);
    const again = await push(june, [trash(b), trash(a, false)]);
    expect(again.results).toEqual([applied, applied]);
    expect(again.usage.recipes).toBe(2);
  });

  it("is unlimited on Premium, unless an override says otherwise", async () => {
    const june = await person();
    const code = await createCode(
      db(),
      {
        code: `LIMITS-${++counter}`,
        label: "Limit tests",
        tier: "individual",
        access: { forever: true },
        allowsSignUp: true,
        maxUses: null,
        redeemBy: null,
      },
      null,
    );
    expect((await june.v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(
      200,
    );
    const many = Array.from({ length: 101 }, () => create(id()));
    const first = await push(june, many.slice(0, 100));
    expect(first.results.every((r) => r.status === "applied")).toBe(true);
    const second = await push(june, many.slice(100));
    expect(second.results).toEqual([applied]);
    expect(second.usage).toMatchObject({ recipes: 101, maxRecipes: null });

    await overrideLimit(june.v, "max_recipes", 101);
    expect((await push(june, [create(id())])).results).toEqual([limit("max_recipes")]);
  });

  it("counts a shared household's recipes together", async () => {
    const june = await person();
    const sam = await person();
    // Sam joins June's household (phase G1 builds joining; here it's set up directly).
    const household = await householdOf(june.v);
    const samId = (await sam.v.session())!.user.id;
    await db().run(sql`insert into member (id, organization_id, user_id, role, created_at)
      values (${id()}, ${household}, ${samId}, 'member', ${Date.now()})`);
    await db().run(sql`update session set active_organization_id = ${household}
      where user_id = ${samId}`);
    await overrideLimit(june.v, "max_recipes", 2);
    await push(june, [create(id())]);
    expect((await push(sam, [create(id()), create(id())])).results).toEqual([
      applied,
      limit("max_recipes"),
    ]);
  });
});

describe("recipe text", () => {
  it("is counted as recipeBytes counts it, accents and all", async () => {
    const june = await person();
    const recipes = [
      { ...emptyRecipeContent(), title: "Jalapeño crème brûlée", notes: "½ cup — “warm”" },
      {
        ...emptyRecipeContent(),
        title: "Stew",
        ingredients: [{ id: id(), text: "2 chiles", heading: false }],
        nutrition: { perServing: { calories: 320 }, text: null, source: "manual" as const },
        difficulty: "easy" as const,
      },
    ];
    const answer = await push(
      june,
      recipes.map((r) => create(id(), r)),
    );
    expect(answer.usage.textBytes).toBe(recipes.reduce((t, r) => t + recipeBytes(r), 0));
  });

  it("blocks new recipes once full, counts Trash until it's emptied", async () => {
    const june = await person();
    await overrideLimit(june.v, "max_text_bytes", 1000);
    const [a, b, c] = [id(), id(), id()];
    // Under the limit, a new recipe may take it over; after that, nothing new.
    const answer = await push(june, [
      create(a, { notes: "x".repeat(600) }),
      create(b, { notes: "y".repeat(600) }),
      create(c),
    ]);
    expect(answer.results).toEqual([applied, applied, limit("max_text_bytes")]);

    // Trash still counts.
    expect((await push(june, [trash(a), create(c)])).results).toEqual([
      applied,
      limit("max_text_bytes"),
    ]);
    // Deleted for good, it doesn't.
    const emptied = await june.v.request("/api/trash/empty", { body: { recipeIds: [a] } });
    expect(emptied.status).toBe(200);
    const after = await push(june, [create(c)]);
    expect(after.results).toEqual([applied]);
  });
});

describe("over the limits", () => {
  it("everything stays editable, and adding waits until there's room", async () => {
    const june = await person();
    const [a, b, c] = [id(), id(), id()];
    await push(june, [create(a), create(b), create(c)]);
    // Premium ended, say, or the limit went down.
    await overrideLimit(june.v, "max_recipes", 1);
    await overrideLimit(june.v, "max_text_bytes", 10);

    const answer = await push(june, [
      edit(a, { title: "Better soup", notes: "Much longer notes than before" }),
      { kind: "opinion", recipeId: b, fields: { rating: 4, note: "Good" }, changedAt: Date.now() },
      { kind: "made", id: id(), recipeId: b, madeOn: "2026-10-08", changedAt: Date.now() },
      trash(c),
      create(id()),
    ]);
    expect(answer.results).toEqual([applied, applied, applied, applied, limit("max_recipes")]);
    expect(answer.usage).toMatchObject({ recipes: 2, maxRecipes: 1 });

    // Everything is still there to fetch.
    const { recipes } = await pull(june);
    expect(recipes).toHaveLength(3);
    expect(recipes.find((r) => r.id === a)?.title).toBe("Better soup");

    // Back under: adding works again.
    await push(june, [trash(a), trash(b)]);
    await overrideLimit(june.v, "max_text_bytes", null);
    expect((await push(june, [create(id())])).results).toEqual([applied]);
  });
});

describe("each recipe's size", () => {
  it("refuses a new recipe, or an edit, past the per-recipe cap", async () => {
    const june = await person();
    await overrideLimit(june.v, "max_recipe_bytes", 1000);
    const recipeId = id();
    expect((await push(june, [create(recipeId, { notes: "z".repeat(1200) })])).results).toEqual([
      tooLarge,
    ]);
    expect((await push(june, [create(recipeId, { notes: "z".repeat(500) })])).results).toEqual([
      applied,
    ]);
    expect((await push(june, [edit(recipeId, { description: "w".repeat(600) })])).results).toEqual([
      tooLarge,
    ]);
    expect((await push(june, [edit(recipeId, { description: "w".repeat(100) })])).results).toEqual([
      applied,
    ]);
  });

  it("lets a recipe already over the cap be edited, as long as it doesn't grow", async () => {
    const june = await person();
    const recipeId = id();
    await push(june, [create(recipeId, { notes: "z".repeat(2000) })]);
    await overrideLimit(june.v, "max_recipe_bytes", 1000);
    expect((await push(june, [edit(recipeId, { notes: "z".repeat(1500) })])).results).toEqual([
      applied,
    ]);
    expect((await push(june, [edit(recipeId, { title: "Longer title" })])).results).toEqual([
      tooLarge,
    ]);
  });
});
