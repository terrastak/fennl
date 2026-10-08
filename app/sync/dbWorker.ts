import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import {
  CATEGORY_SEPARATOR,
  RECIPE_SCHEMA_VERSION,
  type Category,
  type Recipe,
  type RecipeCategory,
  type RecipeMade,
  type RecipeOpinion,
} from "../../shared/recipe";
import type { PullResponse, SyncChange } from "../../shared/sync";
import type { CategoryData } from "../categories/tree";
import type {
  DbRequest,
  DbResponse,
  DbResults,
  Member,
  OutboxEntry,
  RecipeDetail,
  RecipeSummary,
  TrashItem,
} from "./dbProtocol";
import { MIGRATIONS } from "./schema";
import { indexRecipe, searchRecipes, unindexRecords } from "./search";
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

async function open(forUser: string) {
  const sqlite3 = await sqlite3InitModule();
  // Only one tab can hold this storage at a time; a second one fails here (C2).
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "fennl" });
  await pool.reserveMinimumCapacity(6);
  db = new pool.OpfsSAHPoolDb(`/fennl-${forUser}.sqlite3`);
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
    sql: `delete from record where kind = 'made'
          and json_extract(coalesce(data, server_data), '$.recipeId') = ?`,
    bind: [recipeId],
  });
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
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

function members(): Member[] {
  const rows = database().selectArrays("select user_id, name from member order by position") as [
    string,
    string,
  ][];
  return rows.map(([memberId, name]) => ({ userId: memberId, name }));
}

function getRecipe(id: string): RecipeDetail | null {
  const d = database();
  const data = d.selectValue(
    "select data from record where kind = 'recipe' and key = ? and data is not null",
    [id],
  ) as string | undefined;
  if (!data) return null;
  return {
    recipe: JSON.parse(data) as Recipe,
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
  };
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

function wipe() {
  database().exec(
    `delete from record; delete from cursor; delete from member; delete from outbox;
     delete from recheck; delete from recipe_search;`,
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
          await open(request.userId);
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
        case "search":
          value = searchRecipes(database(), request.query, recipeCategories());
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
