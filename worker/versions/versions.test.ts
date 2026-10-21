import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  RECIPE_SCHEMA_VERSION,
  emptyRecipeContent,
  type RecipeContent,
  type RecipeImport,
} from "../../shared/recipe";
import type { ChangeResult } from "../../shared/sync";
import type { RecipeVersion } from "../../shared/versions";
import { database } from "../db/client";
import { member, organization, recipe, recipeVersion, session } from "../db/schema";
import { expungeRecipes } from "../sync/trash";
import {
  overrideLimit,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";

// Phase E13: importing again from Paprika records the newer version on the recipe, and the
// version before it is kept until someone in the household decides.

const db = () => database(env.DB);
let counter = 0;
const id = () => crypto.randomUUID();

beforeAll(async () => {
  await setUpDatabase();
});

interface Person {
  v: Visitor;
  userId: string;
  deviceId: string;
}

async function person(name = "June Lee"): Promise<Person> {
  const v = await signUpConfirmed(`versions-${++counter}@example.com`, name);
  const userId = (await v.session())!.user.id;
  const deviceId = id();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(res.status).toBe(200);
  return { v, userId, deviceId };
}

async function share(a: Person, b: Person) {
  const householdId = id();
  await db()
    .insert(organization)
    .values({
      id: householdId,
      name: "Shared",
      slug: `shared-${householdId}`,
      createdAt: new Date(),
    });
  await db()
    .insert(member)
    .values(
      [a, b].map((p) => ({
        id: id(),
        organizationId: householdId,
        userId: p.userId,
        role: p === a ? "owner" : "member",
        createdAt: new Date(),
      })),
    );
  await db()
    .update(session)
    .set({ activeOrganizationId: householdId })
    .where(inArray(session.userId, [a.userId, b.userId]));
}

async function push(p: Person, changes: unknown[]): Promise<ChangeResult[]> {
  const res = await p.v.request("/api/sync/push", {
    body: {
      deviceId: p.deviceId,
      schemaVersion: RECIPE_SCHEMA_VERSION,
      sentAt: Date.now(),
      changes,
    },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: ChangeResult[] }).results;
}

const paprika = (hash: string, uid = "PAPRIKA-1"): RecipeImport => ({
  source: "paprika",
  importJobId: null,
  externalId: uid,
  externalHash: hash,
  importedAt: new Date().toISOString(),
  photos: ["PHOTO-1"],
});

const content = (title: string): RecipeContent => ({ ...emptyRecipeContent(), title });

async function imported(p: Person, title = "Fajitas", uid = "PAPRIKA-1") {
  const recipeId = id();
  const [result] = await push(p, [
    {
      kind: "recipe",
      id: recipeId,
      create: { createdAt: "2015-06-13T13:17:32.000Z", import: paprika("h1", uid) },
      fields: content(title),
      changedAt: Date.now(),
    },
  ]);
  expect(result).toEqual({ status: "applied" });
  return recipeId;
}

async function stored(recipeId: string) {
  const row = await db().select().from(recipe).where(eq(recipe.id, recipeId)).get();
  return { title: row?.title, import: JSON.parse(row?.import ?? "null") as RecipeImport | null };
}

async function call(v: Visitor, method: string, path: string, body?: unknown) {
  const res = await v.request(path, { method, ...(body === undefined ? {} : { body }) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> };
}

const keep = (v: Visitor, recipeIds: unknown[], reason: unknown = "paprika_update") =>
  call(v, "POST", "/api/recipes/versions", { recipeIds, reason });
const versions = async (v: Visitor, recipeId: string) =>
  ((await call(v, "GET", `/api/recipes/${recipeId}/versions`)).body.versions ??
    []) as RecipeVersion[];

describe("importing again from Paprika", () => {
  it("records the newer version on the recipe along with what changed", async () => {
    const june = await person();
    const recipeId = await imported(june);
    const newer = { ...paprika("h2"), photos: ["PHOTO-1", "PHOTO-2"] };
    const [result] = await push(june, [
      {
        kind: "recipe",
        id: recipeId,
        import: newer,
        fields: { title: "Fajitas!" },
        changedAt: Date.now(),
      },
    ]);
    expect(result).toEqual({ status: "applied" });
    expect(await stored(recipeId)).toEqual({ title: "Fajitas!", import: newer });
  });

  it("can record the newer version alone, when nothing in the recipe changed", async () => {
    const june = await person();
    const recipeId = await imported(june);
    const newer = paprika("h3");
    expect(
      await push(june, [
        { kind: "recipe", id: recipeId, import: newer, fields: {}, changedAt: Date.now() },
      ]),
    ).toEqual([{ status: "applied" }]);
    expect((await stored(recipeId)).import?.externalHash).toBe("h3");
    // Sending it again changes nothing.
    expect(
      await push(june, [
        { kind: "recipe", id: recipeId, import: newer, fields: {}, changedAt: Date.now() },
      ]),
    ).toEqual([{ status: "unchanged" }]);
  });

  it("never records another source's version on a recipe", async () => {
    const june = await person();
    const recipeId = await imported(june, "Fajitas", "PAPRIKA-A");
    const other = paprika("h9", "PAPRIKA-B");
    expect(
      await push(june, [
        { kind: "recipe", id: recipeId, import: other, fields: {}, changedAt: Date.now() },
      ]),
    ).toEqual([{ status: "unchanged" }]);
    expect((await stored(recipeId)).import?.externalId).toBe("PAPRIKA-A");
  });

  it("refuses Paprika recipes on a plan without imports that cost nothing", async () => {
    const june = await person();
    const recipeId = await imported(june);
    await overrideLimit(june.v, "structured_imports_per_day", 0);
    const [created] = await push(june, [
      {
        kind: "recipe",
        id: id(),
        create: { createdAt: new Date().toISOString(), import: paprika("h1", "PAPRIKA-2") },
        fields: content("Tacos"),
        changedAt: Date.now(),
      },
    ]);
    expect(created).toMatchObject({ status: "rejected", reason: "invalid" });
    const [updated] = await push(june, [
      { kind: "recipe", id: recipeId, import: paprika("h2"), fields: {}, changedAt: Date.now() },
    ]);
    expect(updated).toMatchObject({ status: "rejected", reason: "invalid" });
    // Editing the recipe itself is still fine.
    expect(
      await push(june, [
        { kind: "recipe", id: recipeId, fields: { title: "Mine" }, changedAt: Date.now() },
      ]),
    ).toEqual([{ status: "applied" }]);
  });
});

describe("earlier versions", () => {
  it("keeps the recipe as the server has it, with the importer's own stars and note", async () => {
    const june = await person();
    const recipeId = await imported(june, "Before");
    await push(june, [
      {
        kind: "opinion",
        recipeId,
        fields: { rating: 4, note: "Less onion" },
        changedAt: Date.now(),
      },
    ]);
    expect((await keep(june.v, [recipeId])).body).toEqual({ kept: [recipeId] });
    await push(june, [
      { kind: "recipe", id: recipeId, fields: { title: "After" }, changedAt: Date.now() },
    ]);

    const [version] = await versions(june.v, recipeId);
    expect(version).toMatchObject({
      recipeId,
      reason: "paprika_update",
      authorUserId: june.userId,
      snapshot: {
        content: { ...emptyRecipeContent(), title: "Before" },
        opinion: { userId: june.userId, rating: 4, note: "Less onion" },
      },
    });
  });

  it("keeps the first version when importing again before anyone decided", async () => {
    const june = await person();
    const recipeId = await imported(june, "First");
    await keep(june.v, [recipeId]);
    await push(june, [
      { kind: "recipe", id: recipeId, fields: { title: "Second" }, changedAt: Date.now() },
    ]);
    expect((await keep(june.v, [recipeId])).body).toEqual({ kept: [recipeId] });
    const kept = await versions(june.v, recipeId);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.snapshot.content.title).toBe("First");
  });

  it("is the household's: a partner sees and decides; nobody else can", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Lee");
    const stranger = await person("Pat Smith");
    await share(june, sam);
    const recipeId = await imported(june);
    expect((await keep(stranger.v, [recipeId])).body).toEqual({ kept: [] });
    await keep(sam.v, [recipeId]);
    const [version] = await versions(june.v, recipeId);
    expect(version).toBeDefined();
    expect(await versions(stranger.v, recipeId)).toEqual([]);
    expect(
      (await call(stranger.v, "DELETE", `/api/recipes/${recipeId}/versions/${version!.id}`)).status,
    ).toBe(404);
    expect(
      (await call(sam.v, "DELETE", `/api/recipes/${recipeId}/versions/${version!.id}`)).status,
    ).toBe(204);
    expect(await versions(june.v, recipeId)).toEqual([]);
  });

  it("goes when the recipe is deleted for good", async () => {
    const june = await person();
    const recipeId = await imported(june);
    await keep(june.v, [recipeId]);
    await push(june, [
      { kind: "recipe", id: recipeId, deleted: true, fields: {}, changedAt: Date.now() },
    ]);
    expect(await expungeRecipes(db(), [recipeId])).toBe(1);
    const left = await db()
      .select()
      .from(recipeVersion)
      .where(eq(recipeVersion.recipeId, recipeId))
      .all();
    expect(left).toEqual([]);
  });

  it("turns away bad requests and needs a signed-in person", async () => {
    const june = await person();
    expect((await keep(june.v, [])).status).toBe(400);
    expect((await keep(june.v, ["x"])).status).toBe(400);
    expect((await keep(june.v, [id()], "because")).status).toBe(400);
    expect((await keep(june.v, Array.from({ length: 51 }, id))).status).toBe(400);
    expect((await keep(visitor(), [id()])).status).toBe(401);
    expect((await call(visitor(), "GET", `/api/recipes/${id()}/versions`)).status).toBe(401);
  });
});
