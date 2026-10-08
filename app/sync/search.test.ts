import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { emptyRecipeContent, type Recipe, type RecipeOpinion } from "../../shared/recipe";
import { MIGRATIONS } from "./schema";
import { indexRecipe, searchRecipes, searchTerms, unindexRecords } from "./search";

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
  const opinion: RecipeOpinion = {
    recipeId,
    userId: "sarah",
    rating: null,
    favorite: false,
    note: text,
    updatedAt: "2026-10-08T00:00:00Z",
    deletedAt: null,
    serverSeq: 1,
  };
  db.exec({
    sql: "insert into record (kind, key, owner_user_id, data) values ('opinion', ?, 'brian', ?)",
    bind: [`${recipeId}|sarah`, JSON.stringify(opinion)],
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
