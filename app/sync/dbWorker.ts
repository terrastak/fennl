import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import {
  CATEGORY_SEPARATOR,
  RECIPE_SCHEMA_VERSION,
  type Category,
  type ImportSource,
  type Recipe,
  type RecipeCategory,
  type RecipeMade,
  type RecipeOpinion,
  type RecipePhoto,
} from "../../shared/recipe";
import { printOrder } from "../../shared/print";
import { MAX_LINK_DEPTH, linkedIds, reachable, type LinkedRecipe } from "../../shared/subRecipes";
import type { PullResponse, SyncChange } from "../../shared/sync";
import type { CategoryData } from "../categories/tree";
import type {
  DbRequest,
  DbResponse,
  DbResults,
  ImportedRecipe,
  Member,
  OutboxEntry,
  PrintSet,
  RecipeDetail,
  RecipeSummary,
  TrashItem,
} from "./dbProtocol";
import { MIGRATIONS } from "./schema";
import {
  findDuplicatePairs,
  findDuplicates,
  type DuplicateMatch,
  type DuplicatePair,
  type DuplicateQuery,
} from "../../shared/duplicates";
import {
  indexRecipe,
  ingredientMatches,
  searchRecipes,
  similarByIngredients,
  unindexRecords,
} from "./search";
import { ingredientKeywords, suggestCategories } from "../categories/suggest";
import {
  keyOf,
  ownerOfRecord,
  pulledRecords,
  recordOf,
  withPending,
  type ApplyContext,
  type RecordKind,
  type RecordValue,
} from "./records";

// The browser's copy of the recipe box (phase C4): SQLite on the origin private file system
// (opfs-sahpool, chosen in C2), one database file per account. Only one tab at a time can open
// it; app/sync/tabs.ts makes sure only the tab that owns it starts this worker.
//
// This copy is a cache. The account on the server is what counts (CLAUDE.md, "Core principle"):
// if the browser clears it, the next sync downloads everything again.

let db: Database | null = null;
let userId = "";

function database(): Database {
  if (!db) throw new Error("The local database isn't open.");
  return db;
}

function migrate(d: Database) {
  const version = Number(d.selectValue("pragma user_version") ?? 0);
  MIGRATIONS.forEach((sql, i) => {
    if (i < version) return;
    d.transaction(() => {
      d.exec(sql);
      d.exec(`pragma user_version = ${i + 1}`);
    });
  });
  // The server's record shape changed since this copy was made: download it all again.
  const shape = d.selectValue("select value from meta where key = 'recipe_schema'");
  if (shape !== undefined && Number(shape) !== RECIPE_SCHEMA_VERSION) {
    d.exec(
      "delete from record; delete from cursor; delete from recheck; delete from recipe_search;",
    );
  }
  d.exec({
    sql: "insert or replace into meta (key, value) values ('recipe_schema', ?)",
    bind: [String(RECIPE_SCHEMA_VERSION)],
  });
}

async function open(forUser: string, file: string) {
  const sqlite3 = await sqlite3InitModule();
  // Only one tab can hold this storage at a time; a second one fails here (C2).
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "fennl" });
  await pool.reserveMinimumCapacity(6);
  db = new pool.OpfsSAHPoolDb(`/fennl-${file}.sqlite3`);
  userId = forUser;
  migrate(db);
}

function context(now: string): ApplyContext {
  return {
    userId,
    now,
    ownerOf: (recipeId) =>
      (database().selectValue(
        "select owner_user_id from record where kind = 'recipe' and key = ?",
        [recipeId],
      ) as string | undefined) ?? null,
  };
}

/** Works out a record again: the server's copy with the changes still waiting applied. */
function recompute(kind: RecordKind, key: string, ctx: ApplyContext) {
  const d = database();
  const serverText = d.selectValue("select server_data from record where kind = ? and key = ?", [
    kind,
    key,
  ]) as string | null | undefined;
  const server = serverText ? (JSON.parse(serverText) as RecordValue) : null;
  const pending = (
    d.selectValues("select change from outbox where kind = ? and key = ? order by seq", [
      kind,
      key,
    ]) as string[]
  ).map((text) => JSON.parse(text) as SyncChange);
  const value = withPending(server, pending, ctx);
  if (!server && !value) {
    if (kind === "recipe") unindexRecords(d, "key = ?", [key]);
    d.exec({ sql: "delete from record where kind = ? and key = ?", bind: [kind, key] });
    if (kind === "opinion") indexRecipe(d, key.split("|")[0] ?? "");
    return;
  }
  const owner = ownerOfRecord(kind, (value ?? server) as RecordValue, ctx);
  d.exec({
    sql: `insert into record (kind, key, owner_user_id, server_data, data) values (?, ?, ?, ?, ?)
          on conflict (kind, key) do update set
            owner_user_id = excluded.owner_user_id, data = excluded.data`,
    bind: [kind, key, owner, serverText ?? null, value ? JSON.stringify(value) : null],
  });
  // Deleted for good (phase C9): what belonged to it goes from this copy too.
  if (kind === "recipe" && (value as Recipe | null)?.expungedAt) dropRelated(d, key);
  // Keep search up to date (phase C8): a recipe's own words, and its signed notes.
  if (kind === "recipe") indexRecipe(d, key);
  if (kind === "opinion") indexRecipe(d, key.split("|")[0] ?? "");
}

/** Ratings, notes, "made it" days and category links of a recipe deleted for good. */
function dropRelated(d: Database, recipeId: string) {
  d.exec({
    sql: `delete from record where kind in ('opinion', 'recipeCategory')
          and key > ?1 || '|' and key < ?1 || '|~'`,
    bind: [recipeId],
  });
  d.exec({
    sql: `delete from record where kind in ('made', 'photo')
          and json_extract(coalesce(data, server_data), '$.recipeId') = ?`,
    bind: [recipeId],
  });
}

/** Photos not removed, in order (phase D2). */
function livePhotos(recipeId?: string): RecipePhoto[] {
  const photos = recipeId
    ? values<RecipePhoto>("photo", "and json_extract(data, '$.recipeId') = ?", [recipeId])
    : values<RecipePhoto>("photo");
  return photos
    .filter((p) => !p.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** Each recipe's cover: its first gallery photo. */
function covers(): Map<string, RecipePhoto> {
  const found = new Map<string, RecipePhoto>();
  for (const photo of livePhotos()) {
    if (photo.role === "photo" && !found.has(photo.recipeId)) found.set(photo.recipeId, photo);
  }
  return found;
}

function snapshot(): DbResults["snapshot"] {
  const d = database();
  const cursors = Object.fromEntries(
    d.selectArrays("select owner_user_id, seq from cursor") as [string, number][],
  );
  const outbox = (
    d.selectArrays("select seq, change from outbox order by seq") as [number, string][]
  ).map(([seq, change]): OutboxEntry => ({ seq, change: JSON.parse(change) as SyncChange }));
  return { cursors, outbox };
}

/** Changes made here, queued to be sent: all of them or (if anything fails) none. */
function enqueue(changes: SyncChange[], now: string): DbResults["enqueue"] {
  const d = database();
  const ctx = context(now);
  const seqs: number[] = [];
  d.transaction(() => {
    for (const change of changes) {
      const { kind, key } = recordOf(change, userId);
      d.exec({
        sql: "insert into outbox (kind, key, change, created_at) values (?, ?, ?, ?)",
        bind: [kind, key, JSON.stringify(change), Date.now()],
      });
      seqs.push(Number(d.selectValue("select last_insert_rowid()")));
      recompute(kind, key, ctx);
    }
  });
  return { seqs };
}

/** Sent and answered: no longer waiting. The records are worked out again after the next fetch. */
function ack(seqs: number[]) {
  const d = database();
  d.transaction(() => {
    for (const seq of seqs) {
      d.exec({
        sql: "insert or ignore into recheck (kind, key) select kind, key from outbox where seq = ?",
        bind: [seq],
      });
      d.exec({ sql: "delete from outbox where seq = ?", bind: [seq] });
    }
  });
}

function recheck(now: string) {
  const d = database();
  const rows = d.selectArrays("select kind, key from recheck") as [RecordKind, string][];
  if (rows.length === 0) return;
  const ctx = context(now);
  d.transaction(() => {
    for (const [kind, key] of rows) recompute(kind, key, ctx);
    d.exec("delete from recheck");
  });
}

function applyPull(page: PullResponse, now: string) {
  const d = database();
  const ctx = context(now);
  d.transaction(() => {
    d.exec("delete from member");
    page.members.forEach((m, position) => {
      d.exec({
        sql: "insert into member (user_id, name, position) values (?, ?, ?)",
        bind: [m.userId, m.name, position],
      });
    });
    for (const { kind, value } of pulledRecords(page)) {
      const key = keyOf(kind, value);
      d.exec({
        sql: `insert into record (kind, key, owner_user_id, server_data) values (?, ?, ?, ?)
              on conflict (kind, key) do update set server_data = excluded.server_data`,
        bind: [kind, key, ownerOfRecord(kind, value, ctx), JSON.stringify(value)],
      });
      recompute(kind, key, ctx);
    }
    for (const [owner, seq] of Object.entries(page.cursors)) {
      d.exec({
        sql: "insert or replace into cursor (owner_user_id, seq) values (?, ?)",
        bind: [owner, seq],
      });
    }
    // Someone who left the household: their recipes are no longer visible here. That isn't a
    // deletion, so nothing is sent; they're just dropped from this copy (CLAUDE.md).
    const members = page.members.map((m) => m.userId);
    if (members.length === 0) return;
    const placeholders = members.map(() => "?").join(", ");
    d.exec({
      sql: `delete from cursor where owner_user_id not in (${placeholders})`,
      bind: members,
    });
    unindexRecords(d, `owner_user_id not in (${placeholders}, '')`, members);
    d.exec({
      sql: `delete from record where owner_user_id not in (${placeholders}, '')`,
      bind: members,
    });
  });
}

/** The values of one kind of record (left out: those with nothing to show). */
function values<T>(kind: RecordKind, where = "", bind: string[] = []): T[] {
  return (
    database().selectValues(
      `select data from record where kind = ? and data is not null ${where}`,
      [kind, ...bind],
    ) as string[]
  ).map((text) => JSON.parse(text) as T);
}

/** Category paths ("Desserts › Cakes") by category ID, for categories not deleted. */
function categoryPaths(): Map<string, string> {
  const categories = new Map(
    values<Category>("category")
      .filter((c) => !c.deletedAt)
      .map((c) => [c.id, c]),
  );
  const paths = new Map<string, string>();
  for (const category of categories.values()) {
    const names: string[] = [];
    let at: Category | undefined = category;
    // A parent that's missing (or a loop) ends the path there.
    for (let depth = 0; at && depth < 20; depth++) {
      names.unshift(at.name);
      at = at.parentId ? categories.get(at.parentId) : undefined;
    }
    paths.set(category.id, names.join(CATEGORY_SEPARATOR));
  }
  return paths;
}

/** Each recipe's category paths, sorted. */
function recipeCategories(recipeId?: string): Map<string, string[]> {
  const paths = categoryPaths();
  const links = recipeId
    ? values<RecipeCategory>("recipeCategory", "and key like ?", [`${recipeId}|%`])
    : values<RecipeCategory>("recipeCategory");
  const byRecipe = new Map<string, string[]>();
  for (const link of links) {
    const path = paths.get(link.categoryId);
    if (link.deletedAt || !path) continue;
    byRecipe.set(link.recipeId, [...(byRecipe.get(link.recipeId) ?? []), path]);
  }
  for (const list of byRecipe.values()) list.sort((a, b) => a.localeCompare(b));
  return byRecipe;
}

function listRecipes(): RecipeSummary[] {
  const d = database();
  const waiting = new Set(
    d.selectValues("select distinct key from outbox where kind = 'recipe'") as string[],
  );
  const categories = recipeCategories();
  const names = new Map(members().map((m) => [m.userId, m.name]));
  const mine = new Map(
    values<RecipeOpinion>("opinion", "and key like ?", [`%|${userId}`])
      .filter((o) => !o.deletedAt)
      .map((o) => [o.recipeId, o]),
  );
  const coverOf = covers();
  const lastMade = new Map<string, string>();
  for (const made of values<RecipeMade>("made")) {
    if (made.deletedAt) continue;
    const before = lastMade.get(made.recipeId);
    if (!before || made.madeOn > before) lastMade.set(made.recipeId, made.madeOn);
  }
  return values<Recipe>("recipe")
    .filter((recipe) => !recipe.deletedAt)
    .map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      ownerUserId: recipe.ownerUserId,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      totalMinutes: recipe.times.total.minutes,
      categories: categories.get(recipe.id) ?? [],
      addedBy: recipe.ownerUserId === userId ? null : (names.get(recipe.ownerUserId) ?? null),
      waiting: waiting.has(recipe.id),
      myRating: mine.get(recipe.id)?.rating ?? null,
      favorite: mine.get(recipe.id)?.favorite ?? false,
      cover: (() => {
        const photo = coverOf.get(recipe.id);
        return photo ? { hash: photo.imageHash, width: photo.width, height: photo.height } : null;
      })(),
      prepMinutes: recipe.times.prep.minutes,
      cookMinutes: recipe.times.cook.minutes,
      servings: recipe.servings.count,
      sourceName: recipe.source.name,
      hasNutrition: recipe.nutrition !== null,
      lastMadeOn: lastMade.get(recipe.id) ?? null,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

/** Categories to suggest for a recipe, from the recipes most like it (phase C13c). */
function categorySuggestions(recipeId: string): string[] {
  const d = database();
  const data = d.selectValue(
    "select data from record where kind = 'recipe' and key = ? and data is not null",
    [recipeId],
  ) as string | undefined;
  if (!data) return [];
  const recipe = JSON.parse(data) as Recipe;
  const like = similarByIngredients(d, recipeId, ingredientKeywords(recipe.ingredients), 15);
  const categories = recipeCategories();
  return suggestCategories(
    like.map((id) => categories.get(id) ?? []),
    categories.get(recipeId) ?? [],
  );
}

function members(): Member[] {
  const rows = database().selectArrays("select user_id, name from member order by position") as [
    string,
    string,
  ][];
  return rows.map(([memberId, name]) => ({ userId: memberId, name }));
}

/** One recipe from the local copy, or undefined when it isn't here. */
function recipeById(id: string): Recipe | undefined {
  const data = database().selectValue(
    "select data from record where kind = 'recipe' and key = ? and data is not null",
    [id],
  ) as string | undefined;
  return data ? (JSON.parse(data) as Recipe) : undefined;
}

/**
 * The recipes a recipe links to, and theirs, as deep as a page expands them and one more (so the
 * deepest can still be named), for showing in place (phase F3).
 */
function linkedRecipes(recipe: Recipe): Record<string, LinkedRecipe> {
  const found = new Map<string, Recipe | undefined>([[recipe.id, recipe]]);
  const load = (id: string) => {
    if (!found.has(id)) found.set(id, recipeById(id));
    return found.get(id);
  };
  const ids = reachable(
    recipe.id,
    (id) => {
      const r = load(id);
      return r && !r.expungedAt ? linkedIds(r.ingredients) : [];
    },
    MAX_LINK_DEPTH + 1,
  );
  const linked: Record<string, LinkedRecipe> = {};
  for (const id of ids) {
    const r = load(id);
    if (!r || r.expungedAt) continue;
    linked[id] = {
      id,
      title: r.title,
      status: r.deletedAt ? "trash" : "ok",
      servings: r.servings,
      ingredients: r.ingredients,
      directions: r.directions,
    };
  }
  return linked;
}

/** Every recipe's links, for refusing a link that would go round in a circle (phase F3). */
function recipeLinks(): Record<string, string[]> {
  const links: Record<string, string[]> = {};
  for (const recipe of values<Recipe>("recipe")) {
    if (!recipe.expungedAt) links[recipe.id] = linkedIds(recipe.ingredients);
  }
  return links;
}

function getRecipe(id: string): RecipeDetail | null {
  const d = database();
  const recipe = recipeById(id);
  if (!recipe) return null;
  return {
    recipe,
    linked: linkedRecipes(recipe),
    waiting: Boolean(
      d.selectValue("select exists (select 1 from outbox where kind = 'recipe' and key = ?)", [id]),
    ),
    opinions: values<RecipeOpinion>("opinion", "and key like ?", [`${id}|%`]).filter(
      (o) => !o.deletedAt,
    ),
    made: values<RecipeMade>("made")
      .filter((m) => m.recipeId === id && !m.deletedAt)
      .sort((a, b) => b.madeOn.localeCompare(a.madeOn) || b.updatedAt.localeCompare(a.updatedAt)),
    categories: recipeCategories(id).get(id) ?? [],
    members: members(),
    photos: livePhotos(id),
  };
}

/**
 * Recipes to print (phase F6), read in one go so a booklet of many is quick: the ones chosen
 * that are here and not in Trash, each followed by the recipes it links to when asked.
 */
function printRecipes(ids: string[], withLinked: boolean): PrintSet {
  const found = new Map<string, Recipe | null>();
  const load = (id: string) => {
    if (!found.has(id)) {
      const recipe = recipeById(id);
      found.set(id, recipe && !recipe.deletedAt && !recipe.expungedAt ? recipe : null);
    }
    return found.get(id) ?? null;
  };
  const linksOf = (id: string) => {
    const recipe = load(id);
    return recipe ? linkedIds(recipe.ingredients).filter((linked) => load(linked)) : [];
  };
  const order = printOrder(
    ids.filter((id) => load(id)),
    linksOf,
    withLinked,
  );
  const categories = recipeCategories();
  const cover = covers();
  const opinions = new Map<string, RecipeOpinion[]>();
  for (const opinion of values<RecipeOpinion>("opinion")) {
    if (opinion.deletedAt) continue;
    opinions.set(opinion.recipeId, [...(opinions.get(opinion.recipeId) ?? []), opinion]);
  }
  return {
    members: members(),
    recipes: order.flatMap(({ id, linkedFrom }) => {
      const recipe = load(id);
      if (!recipe) return [];
      return [
        {
          recipe,
          linkedFrom,
          opinions: opinions.get(id) ?? [],
          categories: categories.get(id) ?? [],
          cover: cover.get(id) ?? null,
          links: Object.fromEntries(
            linksOf(id).map((linked) => [linked, load(linked)?.title ?? ""]),
          ),
        },
      ];
    }),
  };
}

/** Recipes in the library (not in Trash) an import may duplicate (phase E4). */
function duplicatesOf(query: DuplicateQuery): DuplicateMatch[] {
  return findDuplicates(
    query,
    values<Recipe>("recipe")
      .filter((recipe) => !recipe.deletedAt)
      .map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        urls: [recipe.source.url, recipe.import?.externalId ?? null],
        ingredients: recipe.ingredients,
      })),
  );
}

/** Pairs of recipes in the library (not in Trash) that may be the same recipe (phase C14). */
function duplicatePairs(): DuplicatePair[] {
  return findDuplicatePairs(
    values<Recipe>("recipe")
      .filter((recipe) => !recipe.deletedAt)
      .map((recipe) => ({
        id: recipe.id,
        ownerId: recipe.ownerUserId,
        title: recipe.title,
        urls: [recipe.source.url, recipe.import?.externalId ?? null],
        ingredients: recipe.ingredients,
      })),
  );
}

/** Recipes imported from a source, Trash included, to match when importing again (phase E13). */
function importedRecipes(source: ImportSource): ImportedRecipe[] {
  const gallery = new Map<string, number>();
  for (const photo of livePhotos()) {
    if (photo.role === "photo") gallery.set(photo.recipeId, (gallery.get(photo.recipeId) ?? 0) + 1);
  }
  return values<Recipe>("recipe").flatMap((recipe) =>
    recipe.import?.source === source && !recipe.expungedAt
      ? [
          {
            id: recipe.id,
            ownerUserId: recipe.ownerUserId,
            title: recipe.title,
            import: recipe.import,
            inTrash: Boolean(recipe.deletedAt),
            galleryPhotos: gallery.get(recipe.id) ?? 0,
          },
        ]
      : [],
  );
}

/** Categories and what's filed under them, for the category tree (phase C7). */
function getCategories(): CategoryData {
  const recipeOwners: Record<string, string> = {};
  for (const recipe of values<Recipe>("recipe")) {
    if (!recipe.deletedAt) recipeOwners[recipe.id] = recipe.ownerUserId;
  }
  return {
    categories: values<Category>("category").filter((c) => !c.deletedAt),
    links: values<RecipeCategory>("recipeCategory")
      .filter((l) => !l.deletedAt && l.recipeId in recipeOwners)
      .map((l) => ({ recipeId: l.recipeId, categoryId: l.categoryId })),
    recipeOwners,
  };
}

/** What's in Trash (phase C9), most recently deleted first. */
function listTrash(): TrashItem[] {
  const names = new Map(members().map((m) => [m.userId, m.name]));
  return values<Recipe>("recipe")
    .filter((recipe) => recipe.deletedAt && !recipe.expungedAt)
    .map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      deletedAt: recipe.deletedAt ?? "",
      addedBy: recipe.ownerUserId === userId ? null : (names.get(recipe.ownerUserId) ?? null),
    }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Empties the copy, leaving nothing of it in the file either. */
function wipe() {
  database().exec(
    `delete from record; delete from cursor; delete from member; delete from outbox;
     delete from recheck; delete from recipe_search; vacuum;`,
  );
}

/** The worker's own postMessage (the app's types describe a window, not a worker). */
const scope = self as unknown as {
  postMessage(message: DbResponse): void;
  onmessage: ((event: MessageEvent<DbRequest & { id: number }>) => void) | null;
};

// One request at a time, in order: each runs to completion before the next starts.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      let value: unknown = null;
      switch (request.op) {
        case "open":
          await open(request.userId, request.file);
          break;
        case "snapshot":
          value = snapshot();
          break;
        case "enqueue":
          value = enqueue(request.changes, request.now);
          break;
        case "ack":
          ack(request.seqs);
          break;
        case "applyPull":
          applyPull(request.page, request.now);
          break;
        case "recheck":
          recheck(request.now);
          break;
        case "listRecipes":
          value = listRecipes();
          break;
        case "getRecipe":
          value = getRecipe(request.recipeId);
          break;
        case "getCategories":
          value = getCategories();
          break;
        case "listTrash":
          value = listTrash();
          break;
        case "findDuplicates":
          value = duplicatesOf(request.query);
          break;
        case "findDuplicatePairs":
          value = duplicatePairs();
          break;
        case "importedRecipes":
          value = importedRecipes(request.source);
          break;
        case "recipeLinks":
          value = recipeLinks();
          break;
        case "printRecipes":
          value = printRecipes(request.recipeIds, request.withLinked);
          break;
        case "photoHashes":
          value = [...new Set(livePhotos().map((p) => p.imageHash))];
          break;
        case "search":
          value = searchRecipes(database(), request.query, recipeCategories());
          break;
        case "suggestCategories":
          value = categorySuggestions(request.recipeId);
          break;
        case "ingredientMatches":
          value = ingredientMatches(database(), request.words);
          break;
        case "wipe":
          wipe();
          break;
      }
      scope.postMessage({ id: request.id, ok: true, value });
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      // Another tab still holds the storage: the browser refuses a second "access handle".
      const busy =
        request.op === "open" && /access handle|NoModificationAllowed|locked|busy/i.test(message);
      scope.postMessage({ id: request.id, ok: false, busy, message });
    }
  });
};
