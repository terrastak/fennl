import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import {
  draftParts,
  untitledHint,
  type DraftData,
  type RecipeDraft,
  type SavedForDraft,
} from "../../shared/drafts";
import {
  CATEGORY_SEPARATOR,
  emptyRecipeContent,
  RECIPE_FIELDS,
  RECIPE_SCHEMA_VERSION,
  type Category,
  type ImportSource,
  type Recipe,
  type RecipeCategory,
  type RecipeMade,
  type RecipeNote,
  type RecipeOpinion,
  type RecipePhoto,
} from "../../shared/recipe";
import { printOrder } from "../../shared/print";
import {
  MAX_LINK_DEPTH,
  reachable,
  recipeLinkIds,
  type LinkedRecipe,
} from "../../shared/subRecipes";
import type { PullResponse, SyncChange } from "../../shared/sync";
import type { CategoryData } from "../categories/tree";
import type {
  DbRequest,
  DbResponse,
  DbResults,
  DraftItem,
  DraftToSend,
  ImportedRecipe,
  LocalDraft,
  LocalDraftWrite,
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
  draftIngredientMatches,
  indexRecipe,
  ingredientMatches,
  searchRecipes,
  similarByIngredients,
  unindexRecords,
  withDrafts,
  type DraftForSearch,
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
    const note =
      kind === "note"
        ? (d.selectValue(
            "select json_extract(coalesce(data, server_data), '$.recipeId') from record where kind = 'note' and key = ?",
            [key],
          ) as string | undefined)
        : undefined;
    d.exec({ sql: "delete from record where kind = ? and key = ?", bind: [kind, key] });
    if (note) indexRecipe(d, note);
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
  // In Trash (U27 part 3, owner's choice 2026-11-21): a draft of it is thrown away, here as on
  // the server (which removes its copy with the same push).
  const gone = value as Recipe | null;
  if (kind === "recipe" && (gone?.deletedAt || gone?.expungedAt)) {
    d.exec({ sql: "delete from draft where recipe_id = ?", bind: [key] });
  }
  // Keep search up to date (phase C8): a recipe's own words, and the notes added to it (U7).
  if (kind === "recipe") indexRecipe(d, key);
  if (kind === "note") indexRecipe(d, ((value ?? server) as RecipeNote).recipeId);
}

/** Ratings, notes, "made it" days and category links of a recipe deleted for good. */
function dropRelated(d: Database, recipeId: string) {
  d.exec({
    sql: `delete from record where kind in ('opinion', 'recipeCategory')
          and key > ?1 || '|' and key < ?1 || '|~'`,
    bind: [recipeId],
  });
  d.exec({
    sql: `delete from record where kind in ('made', 'note', 'photo')
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
  let seqs: number[] = [];
  database().transaction(() => {
    seqs = enqueueNow(changes, now);
  });
  return { seqs };
}

/** enqueue's work, inside a transaction the caller holds. */
function enqueueNow(changes: SyncChange[], now: string): number[] {
  const d = database();
  const ctx = context(now);
  const seqs: number[] = [];
  for (const change of changes) {
    const { kind, key } = recordOf(change, userId);
    d.exec({
      sql: "insert into outbox (kind, key, change, created_at) values (?, ?, ?, ?)",
      bind: [kind, key, JSON.stringify(change), Date.now()],
    });
    seqs.push(Number(d.selectValue("select last_insert_rowid()")));
    recompute(kind, key, ctx);
  }
  return seqs;
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
    // Drafts of their recipes go too (the server drops its copies the same way).
    d.exec({
      sql: `delete from draft where is_new = 0 and owner_user_id not in (${placeholders})`,
      bind: members,
    });
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
    .concat(newDraftSummaries())
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

/** A new recipe waiting for Done, as the list and search see it (U27 part 3). */
interface NewDraft extends DraftForSearch {
  data: DraftData;
  startedAt: number;
  editedAt: number;
}

/**
 * New recipes' drafts with a title (U27 part 3): in the person's own list, tagged Draft, until
 * Done adds them to the recipe box. Untitled ones are only on the Drafts page.
 */
function newDrafts(): NewDraft[] {
  const found: NewDraft[] = [];
  for (const [recipeId, , , text, startedAt, editedAt] of draftRows(
    "where deleting = 0 and is_new = 1",
  )) {
    // Done applied it here (its recipe exists), or it's a recipe in Trash: not a new recipe.
    if (recipeById(recipeId)) continue;
    const data = JSON.parse(text) as DraftData;
    const content = { ...emptyRecipeContent(), ...data.fields };
    if (!content.title.trim()) continue;
    const categories = (data.categories ?? [])
      .map((names) => names.join(CATEGORY_SEPARATOR))
      .sort((a, b) => a.localeCompare(b));
    found.push({ id: recipeId, content, categories, data, startedAt, editedAt });
  }
  return found;
}

function newDraftSummaries(): RecipeSummary[] {
  return newDrafts().map(({ id, content, categories, data, startedAt, editedAt }) => {
    const photo = data.photos?.[0];
    return {
      id,
      title: content.title,
      ownerUserId: userId,
      createdAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(editedAt).toISOString(),
      totalMinutes: content.times.total.minutes,
      categories,
      addedBy: null,
      waiting: false,
      myRating: null,
      favorite: false,
      cover: photo ? { hash: photo.imageHash, width: photo.width, height: photo.height } : null,
      prepMinutes: content.times.prep.minutes,
      cookMinutes: content.times.cook.minutes,
      servings: content.servings.count,
      sourceName: content.source.name,
      hasNutrition: content.nutrition !== null,
      lastMadeOn: null,
      draft: true,
    };
  });
}

/** Categories to suggest for a recipe, from the recipes most like it (phase C13c). */
function categorySuggestions(recipeId: string): string[] {
  const d = database();
  const data = d.selectValue(
    "select data from record where kind = 'recipe' and key = ? and data is not null",
    [recipeId],
  ) as string | undefined;
  // The editor's draft (U27 part 3): its ingredients and categories, a new recipe's included.
  const draftText = d.selectValue("select data from draft where recipe_id = ? and deleting = 0", [
    recipeId,
  ]) as string | undefined;
  const draft = draftText ? (JSON.parse(draftText) as DraftData) : null;
  if (!data && !draft) return [];
  const recipe = data ? (JSON.parse(data) as Recipe) : null;
  const ingredients = draft?.fields.ingredients ?? recipe?.ingredients ?? [];
  const like = similarByIngredients(d, recipeId, ingredientKeywords(ingredients), 15);
  const categories = recipeCategories();
  return suggestCategories(
    like.map((id) => categories.get(id) ?? []),
    draft?.categories
      ? draft.categories.map((names) => names.join(CATEGORY_SEPARATOR))
      : (categories.get(recipeId) ?? []),
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
 * deepest can still be named), for showing in place (phase F3) or naming after a step (U27).
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
      return r && !r.expungedAt ? recipeLinkIds(r) : [];
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

/**
 * Every recipe's links, from ingredients and steps, for refusing a link that would go round in a
 * circle (phase F3, U27).
 */
function recipeLinks(): Record<string, string[]> {
  const links: Record<string, string[]> = {};
  for (const recipe of values<Recipe>("recipe")) {
    if (!recipe.expungedAt) links[recipe.id] = recipeLinkIds(recipe);
  }
  return links;
}

/** The notes added to a recipe (U7), oldest first. */
function notesOf(recipeId: string): RecipeNote[] {
  return values<RecipeNote>("note", "and json_extract(data, '$.recipeId') = ?", [recipeId])
    .filter((n) => !n.deletedAt)
    .sort((a, b) => a.writtenAt.localeCompare(b.writtenAt) || a.id.localeCompare(b.id));
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
    notes: notesOf(id),
    categories: recipeCategories(id).get(id) ?? [],
    members: members(),
    photos: livePhotos(id),
    changes: changesOf(id),
  };
}

/** Who changed a recipe's gallery photos and category links, and when (U27 part 3). */
function changesOf(id: string): NonNullable<RecipeDetail["changes"]> {
  const mark = (row: { updatedByUserId?: string; updatedAt: string }) =>
    row.updatedByUserId ? [{ userId: row.updatedByUserId, at: row.updatedAt }] : [];
  return {
    photos: values<RecipePhoto>("photo", "and json_extract(data, '$.recipeId') = ?", [id])
      .filter((photo) => photo.role === "photo")
      .flatMap(mark),
    categories: values<RecipeCategory>("recipeCategory", "and key like ?", [`${id}|%`]).flatMap(
      mark,
    ),
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
    // Recipes linked from ingredients and from steps (U27), each printed once.
    return recipe ? recipeLinkIds(recipe).filter((linked) => load(linked)) : [];
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
  const notes = new Map<string, RecipeNote[]>();
  for (const note of values<RecipeNote>("note")
    .filter((n) => !n.deletedAt)
    .sort((a, b) => a.writtenAt.localeCompare(b.writtenAt) || a.id.localeCompare(b.id))) {
    notes.set(note.recipeId, [...(notes.get(note.recipeId) ?? []), note]);
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
          notes: notes.get(id) ?? [],
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
  const trashed = values<Recipe>("recipe").filter(
    (recipe) => recipe.deletedAt && !recipe.expungedAt,
  );
  if (trashed.length === 0) return [];
  // What its card shows on a laptop (U24), worked out as the recipe list does.
  const waiting = new Set(
    database().selectValues("select distinct key from outbox where kind = 'recipe'") as string[],
  );
  const categories = recipeCategories();
  const mine = new Map(
    values<RecipeOpinion>("opinion", "and key like ?", [`%|${userId}`])
      .filter((o) => !o.deletedAt)
      .map((o) => [o.recipeId, o]),
  );
  const coverOf = covers();
  return trashed
    .map((recipe) => {
      const photo = coverOf.get(recipe.id);
      return {
        id: recipe.id,
        title: recipe.title,
        deletedAt: recipe.deletedAt ?? "",
        addedBy: recipe.ownerUserId === userId ? null : (names.get(recipe.ownerUserId) ?? null),
        cover: photo ? { hash: photo.imageHash, width: photo.width, height: photo.height } : null,
        totalMinutes: recipe.times.total.minutes,
        categories: categories.get(recipe.id) ?? [],
        myRating: mine.get(recipe.id)?.rating ?? null,
        favorite: mine.get(recipe.id)?.favorite ?? false,
        waiting: waiting.has(recipe.id),
      };
    })
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** How many recipes are in Trash (U21): counted in SQLite, without reading each recipe. */
function countTrash(): number {
  return Number(
    database().selectValue(
      `select count(*) from record where kind = 'recipe' and data is not null
         and json_extract(data, '$.deletedAt') is not null
         and json_extract(data, '$.expungedAt') is null`,
    ) ?? 0,
  );
}

// --- Drafts (U27 part 3; shared/drafts.ts) ---------------------------------------------------
// The person's drafts, written here first by the editor and sent to the account by the sync
// engine. A row is "in the account" once the server confirmed its latest edit (sent_edited_at =
// edited_at); `deleting` marks one Done or Discard finished here, whose removal from the account
// is waiting. A draft of a recipe in Trash, or of a recipe no longer visible, goes (recompute and
// applyPull above).

type DraftRow = [
  recipeId: string,
  ownerUserId: string,
  isNew: number,
  data: string,
  startedAt: number,
  editedAt: number,
  sentEditedAt: number | null,
  serverEditedAt: number | null,
  problem: string | null,
  deleting: number,
  version: number,
  fromServer: number,
  finishing: string | null,
];

const DRAFT_COLUMNS = `recipe_id, owner_user_id, is_new, data, started_at, edited_at, sent_edited_at,
  server_edited_at, problem, deleting, version, from_server, finishing`;

function draftRows(where: string, bind: (string | number)[] = []): DraftRow[] {
  return database().selectArrays(
    `select ${DRAFT_COLUMNS} from draft ${where}`,
    bind,
  ) as unknown as DraftRow[];
}

const draftRow = (recipeId: string) => draftRows("where recipe_id = ?", [recipeId])[0];

/** The recipe box's version of a recipe, as drafts compare against it. */
function savedForDraft(recipe: Recipe): SavedForDraft {
  const content = Object.fromEntries(
    RECIPE_FIELDS.map((field) => [field, recipe[field]]),
  ) as unknown as SavedForDraft["content"];
  return {
    content,
    galleryIds: livePhotos(recipe.id)
      .filter((photo) => photo.role === "photo")
      .map((photo) => photo.id),
    categoryKeys: (recipeCategories(recipe.id).get(recipe.id) ?? []).map((path) =>
      path.toLocaleLowerCase(),
    ),
  };
}

/** A recipe not in Trash, as stored here. */
function liveRecipe(id: string): Recipe | undefined {
  const recipe = recipeById(id);
  return recipe && !recipe.deletedAt && !recipe.expungedAt ? recipe : undefined;
}

function putDraft(write: LocalDraftWrite): DbResults["putDraft"] {
  // A recipe in Trash keeps no draft (the editor of a recipe just trashed may still save once).
  const stored = recipeById(write.recipeId);
  if (stored && (stored.deletedAt || stored.expungedAt)) return { version: 0 };
  const d = database();
  d.exec({
    sql: `insert into draft (${DRAFT_COLUMNS})
          values (?, ?, ?, ?, ?, ?, null, null, null, 0, 1, 0, null)
          on conflict (recipe_id) do update set
            owner_user_id = excluded.owner_user_id,
            is_new = excluded.is_new,
            data = excluded.data,
            started_at = case when draft.deleting = 1 then excluded.started_at
                              else draft.started_at end,
            edited_at = max(excluded.edited_at, draft.edited_at + 1),
            problem = null,
            deleting = 0,
            version = draft.version + 1,
            from_server = 0,
            finishing = null`,
    bind: [
      write.recipeId,
      write.ownerUserId,
      write.isNew ? 1 : 0,
      JSON.stringify(write.data),
      write.startedAt,
      write.editedAt,
    ],
  });
  return {
    version: Number(
      d.selectValue("select version from draft where recipe_id = ?", [write.recipeId]) ?? 0,
    ),
  };
}

/** A newer version is here than the one the editor shows (null: no check). */
function draftIsNewer(recipeId: string, version: number | null): boolean {
  if (version === null) return false;
  const row = draftRow(recipeId);
  return Boolean(row && !row[9] && row[10] !== version);
}

/** Marks a draft for removal from the account (Discard), unless a newer version is here. */
function dropDraft(recipeId: string, version: number | null): DbResults["dropDraft"] {
  if (draftIsNewer(recipeId, version)) return { stale: true };
  database().exec({
    sql: "update draft set deleting = 1, problem = null, finishing = null where recipe_id = ?",
    bind: [recipeId],
  });
  return { stale: false };
}

/**
 * Done: its changes queued and the draft marked for removal, together or not at all, unless a
 * newer version is here. The removal waits for these changes (draftsToSend); if the server
 * refuses one for good, the draft comes back (finishRefused).
 */
function finishDraft(
  recipeId: string,
  changes: SyncChange[],
  now: string,
  version: number | null,
): DbResults["finishDraft"] {
  if (draftIsNewer(recipeId, version)) return { seqs: [], stale: true };
  let seqs: number[] = [];
  const d = database();
  d.transaction(() => {
    seqs = enqueueNow(changes, now);
    d.exec({
      sql: "update draft set deleting = 1, problem = null, finishing = ? where recipe_id = ?",
      bind: [JSON.stringify(seqs), recipeId],
    });
  });
  return { seqs, stale: false };
}

/**
 * Done's changes the server refused for good (not a plan limit, which waits): the drafts they
 * came from are no longer being removed, so they show again, still in the account.
 */
function finishRefused(seqs: number[]) {
  database().exec({
    sql: `update draft set deleting = 0, finishing = null
          where deleting = 1 and finishing is not null
            and exists (select 1 from json_each(draft.finishing) j
              where j.value in (select value from json_each(?)))`,
    bind: [JSON.stringify(seqs)],
  });
}

function localDraft(row: DraftRow): LocalDraft {
  const [recipeId, ownerUserId, isNew, data, startedAt, editedAt, sent, , problem] = row;
  return {
    version: row[10],
    fromServer: Boolean(row[11]),
    recipeId,
    ownerUserId,
    isNew: Boolean(isNew) && !liveRecipe(recipeId),
    data: JSON.parse(data) as DraftData,
    startedAt,
    editedAt,
    inAccount: sent !== null && sent >= editedAt,
    problem,
  };
}

function getDraft(recipeId: string): LocalDraft | null {
  const row = draftRows("where recipe_id = ? and deleting = 0", [recipeId])[0];
  return row ? localDraft(row) : null;
}

function listDrafts(): DraftItem[] {
  const items: DraftItem[] = [];
  // The recipe box's covers, read once and only when a draft leaves its photos as they are.
  let coverOf: ReturnType<typeof covers> | undefined;
  for (const row of draftRows("where deleting = 0 order by edited_at desc")) {
    const draft = localDraft(row);
    const recipe = liveRecipe(draft.recipeId);
    // A saved recipe's draft whose recipe hasn't reached this device yet waits for it.
    if (!recipe && !row[2]) continue;
    const { data } = draft;
    const parts = draftParts(recipe ? savedForDraft(recipe) : null, data);
    if (parts.length === 0) continue;
    const firstPhoto = data.photos?.[0];
    const cover = data.photos
      ? firstPhoto
        ? { hash: firstPhoto.imageHash, width: firstPhoto.width, height: firstPhoto.height }
        : null
      : (() => {
          coverOf ??= covers();
          const photo = recipe ? coverOf.get(recipe.id) : undefined;
          return photo ? { hash: photo.imageHash, width: photo.width, height: photo.height } : null;
        })();
    const times = data.fields.times ?? recipe?.times;
    items.push({
      recipeId: draft.recipeId,
      ownerUserId: draft.ownerUserId,
      isNew: !recipe,
      title: (data.fields.title ?? recipe?.title ?? "").trim(),
      untitledHint: untitledHint(data),
      parts,
      startedAt: draft.startedAt,
      editedAt: draft.editedAt,
      inAccount: draft.inAccount,
      cover,
      totalMinutes: times?.total?.minutes ?? null,
      categories: data.categories
        ? data.categories
            .map((names) => names.join(CATEGORY_SEPARATOR))
            .sort((a, b) => a.localeCompare(b))
        : recipe
          ? (recipeCategories(recipe.id).get(recipe.id) ?? [])
          : [],
    });
  }
  return items;
}

/**
 * Drafts to send: written here and not yet in the account, or being removed. A removal after
 * Done waits until every change Done queued has been taken by the server (or held for a plan
 * limit, when it keeps waiting), so the account always has the draft or its changes.
 */
function draftsToSend(): DraftToSend[] {
  return draftRows(
    `where (deleting = 1 and (finishing is null or not exists (
          select 1 from outbox o, json_each(draft.finishing) j where o.seq = j.value)))
        or (deleting = 0 and (sent_edited_at is null or sent_edited_at < edited_at)
          and problem is null)`,
  ).map(([recipeId, , , data, startedAt, editedAt, sent, serverEditedAt, , deleting]) => ({
    recipeId,
    deleting: Boolean(deleting),
    data: JSON.parse(data) as DraftData,
    startedAt,
    editedAt,
    // The account's time for this version once it confirmed it; else this device's own time,
    // which the server moves onto its clock (a newer draft from another device stays).
    upTo:
      sent !== null && sent >= editedAt && serverEditedAt !== null
        ? { editedAt: serverEditedAt }
        : { deviceEditedAt: editedAt },
  }));
}

/** The server's answer to a draft sent (PUT): kept, or a newer one from another device. */
function draftSent(recipeId: string, editedAt: number, server: RecipeDraft, kept: boolean) {
  const row = draftRow(recipeId);
  if (!row) return;
  const d = database();
  const serverMs = Date.parse(server.editedAt);
  // Removed or edited again here since it was sent: only remember the server's time.
  if (row[9] || row[5] !== editedAt) {
    d.exec({
      sql: "update draft set server_edited_at = ? where recipe_id = ?",
      bind: [serverMs, recipeId],
    });
    return;
  }
  if (kept) {
    d.exec({
      sql: `update draft set sent_edited_at = edited_at, server_edited_at = ?, problem = null
            where recipe_id = ?`,
      bind: [serverMs, recipeId],
    });
    return;
  }
  replaceWithServer(server);
}

/** A draft as the account has it, taking the place of this device's (which it's newer than). */
function replaceWithServer(server: RecipeDraft) {
  const serverMs = Date.parse(server.editedAt);
  database().exec({
    sql: `insert into draft (${DRAFT_COLUMNS})
          values (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6, null, 0, 1, 1, null)
          on conflict (recipe_id) do update set
            owner_user_id = excluded.owner_user_id,
            is_new = excluded.is_new,
            data = excluded.data,
            started_at = excluded.started_at,
            edited_at = excluded.edited_at,
            sent_edited_at = excluded.sent_edited_at,
            server_edited_at = excluded.server_edited_at,
            problem = null,
            deleting = 0,
            version = draft.version + 1,
            from_server = 1,
            finishing = null`,
    bind: [
      server.recipeId,
      server.ownerUserId,
      server.isNew ? 1 : 0,
      JSON.stringify(server.data),
      Date.parse(server.startedAt),
      serverMs,
    ],
  });
}

/** The server turned a draft away for good (too large, too many): kept here, not sent again. */
function draftRefused(recipeId: string, editedAt: number, problem: string) {
  database().exec({
    sql: "update draft set problem = ? where recipe_id = ? and edited_at = ? and deleting = 0",
    bind: [problem, recipeId, editedAt],
  });
}

function draftGone(recipeId: string) {
  database().exec({ sql: "delete from draft where recipe_id = ?", bind: [recipeId] });
}

/**
 * Drafts fetched from the account (another device's, or this one's after a reload). One edited
 * here and not sent yet stays as it is (sending it settles which is newer); one being removed is
 * never brought back. With `ids` (every draft the account has), drafts in the account here that
 * the account no longer has go.
 */
function applyDrafts(drafts: RecipeDraft[], ids: { recipeId: string }[] | null) {
  const d = database();
  d.transaction(() => {
    for (const server of drafts) {
      const row = draftRow(server.recipeId);
      if (row) {
        const [, , , , , editedAt, sent, serverEditedAt, , deleting] = row;
        if (deleting) continue;
        if (sent === null || sent < editedAt) continue;
        if (serverEditedAt === Date.parse(server.editedAt)) continue;
      }
      replaceWithServer(server);
    }
    if (ids) {
      d.exec({
        sql: `delete from draft where deleting = 0 and sent_edited_at is not null
                and sent_edited_at >= edited_at
                and recipe_id not in (select value from json_each(?))`,
        bind: [JSON.stringify(ids.map((id) => id.recipeId))],
      });
    }
  });
}

/**
 * A saved recipe's draft that has become the same as the recipe (Done applied it but its removal
 * didn't reach the account, or a partner made the same change) is removed.
 */
function tidyDrafts() {
  for (const row of draftRows("where deleting = 0")) {
    const recipe = liveRecipe(row[0]);
    if (!recipe) continue;
    const data = JSON.parse(row[3]) as DraftData;
    if (draftParts(savedForDraft(recipe), data).length === 0) dropDraft(row[0], null);
  }
}

/** Empties the copy, leaving nothing of it in the file either. */
function wipe() {
  database().exec(
    `delete from record; delete from cursor; delete from member; delete from outbox;
     delete from recheck; delete from recipe_search; delete from draft; vacuum;`,
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
        case "countTrash":
          value = countTrash();
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
          value = withDrafts(
            searchRecipes(database(), request.query, recipeCategories()),
            newDrafts(),
          );
          break;
        case "suggestCategories":
          value = categorySuggestions(request.recipeId);
          break;
        case "ingredientMatches": {
          const inRecipes = ingredientMatches(database(), request.words);
          const inDrafts = draftIngredientMatches(newDrafts(), request.words);
          value = Object.fromEntries(
            Object.entries(inRecipes).map(([word, ids]) => [
              word,
              [...ids, ...(inDrafts[word] ?? [])],
            ]),
          );
          break;
        }
        case "putDraft":
          value = putDraft(request.draft);
          break;
        case "dropDraft":
          value = dropDraft(request.recipeId, request.version);
          break;
        case "finishDraft":
          value = finishDraft(request.recipeId, request.changes, request.now, request.version);
          break;
        case "finishRefused":
          finishRefused(request.seqs);
          break;
        case "getDraft":
          value = getDraft(request.recipeId);
          break;
        case "listDrafts":
          value = listDrafts();
          break;
        case "draftsToSend":
          value = draftsToSend();
          break;
        case "draftSent":
          draftSent(request.recipeId, request.editedAt, request.server, request.kept);
          break;
        case "draftRefused":
          draftRefused(request.recipeId, request.editedAt, request.problem);
          break;
        case "draftGone":
          draftGone(request.recipeId);
          break;
        case "applyDrafts":
          applyDrafts(request.drafts, request.ids);
          break;
        case "tidyDrafts":
          tidyDrafts();
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
