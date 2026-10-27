import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { emptyRecipeContent, type Recipe, type RecipeNote } from "../../shared/recipe";
import { MIGRATIONS } from "./schema";
import {
  indexRecipe,
  ingredientMatches,
  searchRecipes,
  searchTerms,
  similarByIngredients,
  unindexRecords,
} from "./search";

// Search over the browser's copy (phase C8), on the same SQLite build the browser uses (here
// in memory), with the same tables.

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

function freshDb(): Database {
  const db = new sqlite3.oo1.DB(":memory:");
  for (const step of MIGRATIONS) db.exec(step);
  return db;
}

let n = 0;
function recipe(fields: Partial<Recipe>): Recipe {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    ...emptyRecipeContent(),
    id,
    ownerUserId: "brian",
    updatedByUserId: "brian",
    createdAt: "2026-10-08T00:00:00Z",
    copiedFrom: null,
    import: null,
    updatedAt: "2026-10-08T00:00:00Z",
    deletedAt: null,
    serverSeq: n,
    ...fields,
  };
}

const lines = (...texts: string[]) =>
  texts.map((text, i) => ({
    id: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`,
    text,
    heading: false,
  }));

function put(db: Database, r: Recipe) {
  db.exec({
    sql: `insert into record (kind, key, owner_user_id, data) values ('recipe', ?, ?, ?)
          on conflict (kind, key) do update set data = excluded.data`,
    bind: [r.id, r.ownerUserId, JSON.stringify(r)],
  });
  indexRecipe(db, r.id);
}

function note(db: Database, recipeId: string, text: string) {
  const added: RecipeNote = {
    id: `${recipeId.slice(0, 30)}aaaaaa`,
    recipeId,
    userId: "sarah",
    text,
    writtenAt: "2026-10-08T00:00:00Z",
    editedAt: null,
    updatedAt: "2026-10-08T00:00:00Z",
    deletedAt: null,
    serverSeq: 1,
  };
  db.exec({
    sql: "insert into record (kind, key, owner_user_id, data) values ('note', ?, 'brian', ?)",
    bind: [added.id, JSON.stringify(added)],
  });
  indexRecipe(db, recipeId);
}

describe("searching", () => {
  const stew = recipe({
    title: "Green Chile Stew",
    ingredients: lines("2 lb pork shoulder", "1 cup roasted green chiles"),
    directions: lines("Brown the pork in batches."),
    notes: "Better the next day.",
  });
  const tacos = recipe({
    title: "Black Bean Tacos",
    ingredients: lines("2 cans black beans", "1 jalapeño, minced"),
    source: { kind: "person", name: "Aunt June", url: null, author: null, page: null },
  });
  const cake = recipe({ title: "Lemon Olive Oil Cake", description: "Bright and tender." });
  const pork = recipe({ title: "Pork Carnitas", ingredients: lines("3 lb pork butt") });
  const categories = new Map([[cake.id, ["Desserts › Cakes"]]]);

  let db: Database;
  beforeAll(() => {
    db = freshDb();
    for (const r of [stew, tacos, cake, pork]) put(db, r);
    note(db, tacos.id, "Sarah likes extra lime");
  });

  const find = (query: string) => searchRecipes(db, query, categories);

  it("finds a recipe by an ingredient, a note, part of the title, or the source", () => {
    expect(find("shoulder").ids).toEqual([stew.id]);
    expect(find("next day").ids).toEqual([stew.id]);
    expect(find("carn").ids).toEqual([pork.id]);
    expect(find("june").ids).toEqual([tacos.id]);
    expect(find("lime").ids).toEqual([tacos.id]);
  });

  it("ignores accents and case, and needs every word", () => {
    expect(find("JALAPENO").ids).toEqual([tacos.id]);
    expect(find("pork beans").ids).toEqual([]);
    expect(find("pork batches").ids).toEqual([stew.id]);
  });

  it("matches categories as words too", () => {
    expect(find("cakes").ids).toEqual([cake.id]);
    expect(find("dessert tender").ids).toEqual([cake.id]);
  });

  it("puts title matches first, and says where the others matched", () => {
    const results = find("pork");
    expect(results.titleIds).toEqual([pork.id]);
    expect(results.ids.sort()).toEqual([stew.id, pork.id].sort());
    expect(results.hits[stew.id]).toEqual({ field: "Ingredients", text: "2 lb pork shoulder" });
    expect(find("lime").hits[tacos.id]).toEqual({ field: "Notes", text: "Sarah likes extra lime" });
  });

  it("leaves out recipes in Trash, and catches up when one is edited", () => {
    put(db, { ...pork, deletedAt: "2026-10-08T01:00:00Z" });
    expect(find("carnitas").ids).toEqual([]);
    put(db, { ...pork, deletedAt: null, title: "Pork Pozole" });
    expect(find("carnitas").ids).toEqual([]);
    expect(find("pozole").ids).toEqual([pork.id]);
  });

  it("forgets a recipe whose record goes", () => {
    unindexRecords(db, "key = ?", [cake.id]);
    db.exec({ sql: "delete from record where kind = 'recipe' and key = ?", bind: [cake.id] });
    expect(find("lemon").ids).toEqual([]);
  });

  it("reads typed words safely", () => {
    expect(searchTerms(` "pork" AND (beans)* NEAR `)).toEqual(["pork", "and", "beans", "near"]);
    expect(find('"').ids).toEqual([]);
    expect(find("and").ids).toEqual([]);
  });
});

describe("a device that already has recipes", () => {
  it("indexes them when its copy is upgraded", () => {
    const db = new sqlite3.oo1.DB(":memory:");
    db.exec(MIGRATIONS[0] ?? "");
    const old = recipe({ title: "Sopa de Lima" });
    db.exec({
      sql: "insert into record (kind, key, owner_user_id, data) values ('recipe', ?, 'brian', ?)",
      bind: [old.id, JSON.stringify(old)],
    });
    for (const step of MIGRATIONS.slice(1)) db.exec(step);
    expect(searchRecipes(db, "lima", new Map()).ids).toEqual([old.id]);
    db.close();
  });
});

describe("speed at 10,000 recipes", () => {
  const WORDS =
    "chicken beef pork garlic onion tomato basil lemon lime butter flour sugar egg milk cream cheese rice bean pepper chile cumin oregano thyme rosemary potato carrot celery mushroom spinach ginger soy honey vinegar mustard yogurt almond walnut oat cinnamon vanilla".split(
      " ",
    );
  const pickWords = (seed: number, count: number) =>
    Array.from({ length: count }, (_, i) => WORDS[(seed * 7 + i * 13) % WORDS.length]).join(" ");

  it("indexes 10,000 recipes and answers searches quickly", () => {
    const db = freshDb();
    const startIndexing = performance.now();
    db.transaction(() => {
      for (let i = 0; i < 10_000; i++) {
        put(
          db,
          recipe({
            title: `${pickWords(i, 3)} ${i}`,
            description: pickWords(i + 1, 12),
            ingredients: lines(
              ...Array.from({ length: 12 }, (_, k) => `1 cup ${pickWords(i + k, 3)}`),
            ),
            directions: lines(
              ...Array.from({ length: 8 }, (_, k) => `Stir the ${pickWords(i * k, 10)}.`),
            ),
            notes: pickWords(i + 3, 20),
          }),
        );
      }
    });
    const indexing = performance.now() - startIndexing;
    const categories = new Map<string, string[]>();

    const times: Record<string, number> = {};
    for (const query of [
      "chicken",
      "garlic lemon",
      "ch",
      "rosemary walnut honey",
      "nothinglikethis",
    ]) {
      const start = performance.now();
      const results = searchRecipes(db, query, categories);
      times[query] = Math.round(performance.now() - start);
      expect(results.terms.length).toBeGreaterThan(0);
    }
    console.info(`Indexing 10,000 recipes: ${Math.round(indexing)} ms. Searches (ms):`, times);
    // Generous bounds for a shared test machine; on a phone each search is well under these.
    for (const ms of Object.values(times)) expect(ms).toBeLessThan(300);
    db.close();
  }, 120_000);
});

describe("ingredient matches (phase C13a)", () => {
  function box() {
    const db = freshDb();
    const stew = recipe({
      title: "Mushroom stew",
      ingredients: lines("2 cups sliced mushrooms", "1 green onion", "3 cloves garlic"),
    });
    const toast = recipe({
      title: "Garlic toast",
      ingredients: lines("4 slices bread", "2 cloves garlic, minced"),
      description: "Better with mushrooms on the side",
    });
    const salad = recipe({ title: "Green salad", ingredients: lines("Jalapeño", "lettuce") });
    for (const r of [stew, toast, salad]) put(db, r);
    return { db, stew, toast, salad };
  }

  it("finds recipes by a word in their ingredients, as the start of a word", () => {
    const { db, stew } = box();
    expect(ingredientMatches(db, ["mushroom"])).toEqual({ mushroom: [stew.id] });
  });

  it("looks only at the ingredients, not the title, notes or description", () => {
    const { db, toast } = box();
    // 'Garlic toast' has garlic in its title and ingredients; 'mushrooms' is only in its description.
    expect(ingredientMatches(db, ["toast", "mushrooms"])).toEqual({
      toast: [],
      mushrooms: expect.not.arrayContaining([toast.id]),
    });
  });

  it("needs every word of a longer phrase", () => {
    const { db, stew } = box();
    expect(ingredientMatches(db, ["green onion"])).toEqual({ "green onion": [stew.id] });
    expect(ingredientMatches(db, ["green lettuce"])["green lettuce"]).toHaveLength(0);
  });

  it("ignores case and accents", () => {
    const { db, salad } = box();
    expect(ingredientMatches(db, ["JALAPENO"])).toEqual({ JALAPENO: [salad.id] });
  });

  it("answers each word separately, and nothing for a word with no letters", () => {
    const { db, stew, toast } = box();
    const found = ingredientMatches(db, ["garlic", "??"]);
    expect([...(found.garlic ?? [])].sort()).toEqual([stew.id, toast.id].sort());
    expect(found["??"]).toEqual([]);
  });

  it("doesn't return a recipe that went to Trash", () => {
    const { db, stew } = box();
    put(db, { ...stew, deletedAt: "2026-10-09T00:00:00Z" });
    expect(ingredientMatches(db, ["mushroom"])).toEqual({ mushroom: [] });
  });
});

describe("recipes like one (phase C13c)", () => {
  function box() {
    const db = freshDb();
    const soupA = recipe({
      title: "Mushroom soup",
      ingredients: lines("2 cups mushrooms", "1 onion", "4 cups broth"),
    });
    const soupB = recipe({
      title: "Cream of mushroom",
      ingredients: lines("3 cups mushrooms", "1 cup cream", "2 cups broth"),
    });
    const stew = recipe({
      title: "Onion stew",
      ingredients: lines("3 onions", "2 cups broth", "1 lb beef"),
    });
    const cake = recipe({
      title: "Lemon cake",
      ingredients: lines("2 cups flour", "3 lemons", "4 eggs"),
    });
    const mine = recipe({
      title: "My soup",
      ingredients: lines("1 cup mushrooms", "1 onion", "2 cups broth"),
    });
    for (const r of [soupA, soupB, stew, cake, mine]) put(db, r);
    return { db, soupA, soupB, stew, cake, mine };
  }

  it("finds recipes sharing ingredient words, and not the recipe itself", () => {
    const { db, mine, cake } = box();
    const like = similarByIngredients(db, mine.id, ["mushroom", "onion", "broth"], 10);
    expect(like).not.toContain(mine.id);
    expect(like).not.toContain(cake.id);
    expect(like).toHaveLength(3);
  });

  it("puts the closest first: more of the words, and rarer ones", () => {
    const { db, mine, soupA, soupB, stew } = box();
    const like = similarByIngredients(db, mine.id, ["mushroom", "onion", "broth"], 10);
    // 'Mushroom soup' has all three; the other two have two each.
    expect(like[0]).toBe(soupA.id);
    expect(new Set(like.slice(1))).toEqual(new Set([soupB.id, stew.id]));
  });

  it("looks at ingredients only, and respects the limit", () => {
    const { db, mine } = box();
    // 'soup' is in titles but in no ingredient list.
    expect(similarByIngredients(db, mine.id, ["soup"], 10)).toEqual([]);
    expect(similarByIngredients(db, mine.id, ["mushroom", "onion", "broth"], 2)).toHaveLength(2);
  });

  it("gives nothing for no words, or words with no letters", () => {
    const { db, mine } = box();
    expect(similarByIngredients(db, mine.id, [], 10)).toEqual([]);
    expect(similarByIngredients(db, mine.id, ["?!"], 10)).toEqual([]);
  });

  it("leaves out a recipe in Trash", () => {
    const { db, mine, soupA } = box();
    put(db, { ...soupA, deletedAt: "2026-10-09T00:00:00Z" });
    expect(similarByIngredients(db, mine.id, ["mushroom"], 10)).not.toContain(soupA.id);
  });
});
