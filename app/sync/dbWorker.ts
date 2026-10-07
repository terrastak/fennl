import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { RECIPE_SCHEMA_VERSION, type Recipe } from "../../shared/recipe";
import type { PullResponse, SyncChange } from "../../shared/sync";
import type { DbRequest, DbResponse, DbResults, OutboxEntry, RecipeSummary } from "./dbProtocol";
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

/**
 * The local tables, one step per schema version (PRAGMA user_version). A device may have any
 * older version, so steps are only ever added, never changed.
 */
const MIGRATIONS = [
  `create table meta (key text primary key, value text not null);
   create table cursor (owner_user_id text primary key, seq integer not null);
   create table member (user_id text primary key, name text not null, position integer not null);
   create table record (
     kind text not null,
     key text not null,
     owner_user_id text not null,
     server_data text,
     data text,
     primary key (kind, key)
   );
   create index record_owner on record (owner_user_id);
   create table outbox (
     seq integer primary key autoincrement,
     kind text not null,
     key text not null,
     change text not null,
     created_at integer not null
   );
   create index outbox_record on outbox (kind, key);
   create table recheck (kind text not null, key text not null, primary key (kind, key));`,
];

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
    d.exec("delete from record; delete from cursor; delete from recheck;");
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
    d.exec({ sql: "delete from record where kind = ? and key = ?", bind: [kind, key] });
    return;
  }
  const owner = ownerOfRecord(kind, (value ?? server) as RecordValue, ctx);
  d.exec({
    sql: `insert into record (kind, key, owner_user_id, server_data, data) values (?, ?, ?, ?, ?)
          on conflict (kind, key) do update set
            owner_user_id = excluded.owner_user_id, data = excluded.data`,
    bind: [kind, key, owner, serverText ?? null, value ? JSON.stringify(value) : null],
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

function enqueue(change: SyncChange, now: string): DbResults["enqueue"] {
  const d = database();
  const { kind, key } = recordOf(change, userId);
  let seq = 0;
  d.transaction(() => {
    d.exec({
      sql: "insert into outbox (kind, key, change, created_at) values (?, ?, ?, ?)",
      bind: [kind, key, JSON.stringify(change), Date.now()],
    });
    seq = Number(d.selectValue("select last_insert_rowid()"));
    recompute(kind, key, context(now));
  });
  return { seq };
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
    d.exec({
      sql: `delete from record where owner_user_id not in (${placeholders}, '')`,
      bind: members,
    });
  });
}

function listRecipes(): RecipeSummary[] {
  const d = database();
  const rows = d.selectArrays(
    `select r.data, exists (select 1 from outbox o where o.kind = 'recipe' and o.key = r.key)
     from record r where r.kind = 'recipe' and r.data is not null`,
  ) as [string, number][];
  return rows
    .map(([data, waiting]) => ({ recipe: JSON.parse(data) as Recipe, waiting: Boolean(waiting) }))
    .filter(({ recipe }) => !recipe.deletedAt)
    .map(({ recipe, waiting }) => ({
      id: recipe.id,
      title: recipe.title,
      ownerUserId: recipe.ownerUserId,
      updatedAt: recipe.updatedAt,
      waiting,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

function wipe() {
  database().exec(
    "delete from record; delete from cursor; delete from member; delete from outbox; delete from recheck;",
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
          value = enqueue(request.change, request.now);
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
