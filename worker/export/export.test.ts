import { unzipSync, strFromU8 } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import {
  importChanges,
  readExportFile,
  type ExportFile,
  type ExportRecipe,
} from "../../shared/exportFormat";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent, type RecipeContent } from "../../shared/recipe";
import type { ChangeResult, SyncChange } from "../../shared/sync";
import {
  overrideLimit,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";

// Phase C10: the export, and its round trip (an export read back into another account gives the
// same library).

beforeAll(async () => {
  await setUpDatabase();
});

let counter = 0;
const id = () => crypto.randomUUID();

interface Person {
  v: Visitor;
  deviceId: string;
}

async function person(name: string): Promise<Person> {
  const v = await signUpConfirmed(`${name.toLowerCase()}-${++counter}@example.com`, name);
  const deviceId = id();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(await res.json()).toEqual({ status: "ok" });
  return { v, deviceId };
}

async function push(p: Person, changes: SyncChange[]) {
  for (let i = 0; i < changes.length; i += 100) {
    const res = await p.v.request("/api/sync/push", {
      body: {
        deviceId: p.deviceId,
        schemaVersion: RECIPE_SCHEMA_VERSION,
        sentAt: Date.now(),
        changes: changes.slice(i, i + 100),
      },
    });
    const body = (await res.json()) as { results: ChangeResult[] };
    expect(body.results.every((r) => r.status === "applied")).toBe(true);
  }
}

async function exported(p: Person) {
  const res = await p.v.request("/api/export");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/zip");
  expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="fennl-recipes-/);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const json = files["fennl-recipes.json"];
  expect(json).toBeDefined();
  const file = readExportFile(JSON.parse(strFromU8(json!)));
  expect(file).not.toBeNull();
  return { files, file: file as ExportFile };
}

/** What must survive the round trip: everything but IDs, owners and update times. */
function comparable(file: ExportFile) {
  const name = (userId: string) => file.people.find((p) => p.userId === userId)?.name;
  return {
    categories: file.categories,
    recipes: file.recipes
      .map((r: ExportRecipe) => {
        const rest: Partial<ExportRecipe> = { ...r };
        delete rest.id;
        delete rest.ownerUserId;
        delete rest.updatedAt;
        return {
          ...rest,
          title: r.title,
          owner: name(r.ownerUserId),
          opinions: r.opinions.map((o) => ({ ...o, userId: name(o.userId) })),
          made: r.made.map((m) => ({ ...m, userId: name(m.userId) })),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

const lines = (...texts: [string, boolean][]) =>
  texts.map(([text, heading]) => ({ id: id(), text, heading }));

describe("exporting the library", () => {
  it("round-trips: an export read into another account exports the same", async () => {
    const june = await person("June");
    const desserts = id();
    const cakes = id();
    const empty = id();
    const cake = id();
    const stew = id();
    const trashed = id();
    const now = Date.now();
    const recipe = (recipeId: string, fields: Partial<RecipeContent>): SyncChange => ({
      kind: "recipe",
      id: recipeId,
      create: { createdAt: "2025-03-01T10:00:00.000Z", import: null },
      fields: { ...emptyRecipeContent(), ...fields },
      changedAt: now,
    });
    await push(june, [
      {
        kind: "category",
        id: desserts,
        create: {},
        fields: { name: "Desserts", parentId: null, sortOrder: 0 },
        changedAt: now,
      },
      {
        kind: "category",
        id: cakes,
        create: {},
        fields: { name: "Cakes", parentId: desserts, sortOrder: 0 },
        changedAt: now,
      },
      {
        kind: "category",
        id: empty,
        create: {},
        fields: { name: "Someday", parentId: null, sortOrder: 0 },
        changedAt: now,
      },
      recipe(cake, {
        title: "Lemon <Olive> Oil Cake",
        description: "Bright & tender.",
        ingredients: lines(["For the cake:", true], ["1 cup flour", false], ["2 lemons", false]),
        directions: lines(["Mix.", false], ["Bake 40 minutes.", false]),
        times: {
          prep: { minutes: 15, text: null },
          cook: { minutes: 40, text: null },
          total: { minutes: 55, text: "plus cooling" },
        },
        servings: { count: 8, yield: "one 9-inch cake" },
        source: { kind: "person", name: "Aunt June", url: null, author: null, page: null },
        notes: "Keeps 3 days.",
        difficulty: "medium",
      }),
      recipe(stew, {
        title: "Green Chile Stew",
        source: {
          kind: "website",
          name: "Example",
          url: "https://example.com/stew",
          author: "Sam",
          page: null,
        },
        nutrition: { perServing: { calories: 320 }, text: null, source: "manual" },
      }),
      recipe(trashed, { title: "Gone soon" }),
      { kind: "recipeCategory", recipeId: cake, categoryId: cakes, deleted: false, changedAt: now },
      {
        kind: "opinion",
        recipeId: cake,
        fields: { rating: 5, favorite: true, note: "Mom's favorite" },
        changedAt: now,
      },
      { kind: "made", id: id(), recipeId: cake, madeOn: "2026-10-01", changedAt: now },
      { kind: "recipe", id: trashed, fields: {}, deleted: true, changedAt: now },
    ]);

    const first = await exported(june);
    // Pages to read: one per recipe (not the one in Trash), and the contents.
    const pages = Object.keys(first.files).filter((name) => name.startsWith("recipes/"));
    expect(pages).toHaveLength(2);
    const index = strFromU8(first.files["index.html"]!);
    expect(index).toContain("Lemon &lt;Olive&gt; Oil Cake");
    const cakePage = strFromU8(first.files[pages.find((p) => p.includes("lemon"))!]!);
    expect(cakePage).toContain("<h1>Lemon &lt;Olive&gt; Oil Cake</h1>");
    expect(cakePage).toContain("<h3>For the cake:</h3>");
    expect(cakePage).toContain("Mom's favorite");
    expect(first.file.recipes.map((r) => r.title).sort()).toEqual([
      "Green Chile Stew",
      "Lemon <Olive> Oil Cake",
    ]);
    expect(first.file.categories).toEqual(["Desserts", "Desserts › Cakes", "Someday"]);

    // Into another account, and out again.
    const sam = await person("June");
    const plan = importChanges(first.file, { now: Date.now() });
    expect(plan.recipes).toBe(2);
    expect(plan.skipped).toEqual([]);
    await push(sam, plan.changes);
    const second = await exported(sam);
    expect(comparable(second.file)).toEqual(comparable(first.file));
  });

  it("gathers a library bigger than one batch, every recipe once", async () => {
    const lee = await person("Lee");
    await overrideLimit(lee.v, "max_recipes", null);
    const changes: SyncChange[] = Array.from({ length: 200 }, (_, i) => ({
      kind: "recipe",
      id: id(),
      create: { createdAt: new Date().toISOString(), import: null },
      fields: { ...emptyRecipeContent(), title: `Recipe ${i + 1}` },
      changedAt: Date.now(),
    }));
    await push(lee, changes);
    const { file, files } = await exported(lee);
    expect(file.recipes).toHaveLength(200);
    expect(new Set(file.recipes.map((r) => r.id)).size).toBe(200);
    expect(Object.keys(files).filter((name) => name.startsWith("recipes/"))).toHaveLength(200);
  });

  it("is there for every account, and only for the account's own household", async () => {
    const outsider = visitor();
    expect((await outsider.request("/api/export")).status).toBe(401);
    const fresh = await person("Lee");
    const { file, files } = await exported(fresh);
    expect(file.recipes).toEqual([]);
    expect(Object.keys(files).sort()).toEqual(["fennl-recipes.json", "index.html"]);
  });
});
