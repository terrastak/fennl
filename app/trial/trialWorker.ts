import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import type { TrialRequest, TrialResponse } from "./protocol";
import { sampleRecipe } from "./sampleRecipes";

// The storage trial's database (phase C2): SQLite's official browser build, on the origin
// private file system through its "opfs-sahpool" storage, which needs no special server headers.
// It runs in this background worker because that storage is only available to workers. Only
// made-up test recipes go in, in a database of its own; nothing here touches anyone's account.

const SCHEMA = `
  create table if not exists recipe (
    id text primary key,
    title text not null,
    ingredients text not null,
    directions text not null,
    notes text not null
  );
  create index if not exists recipe_title on recipe(title);
  create virtual table if not exists recipe_search using fts5(
    title, ingredients, directions, notes,
    content='recipe', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );
  create trigger if not exists recipe_added after insert on recipe begin
    insert into recipe_search(rowid, title, ingredients, directions, notes)
    values (new.rowid, new.title, new.ingredients, new.directions, new.notes);
  end;
`;

/** Searches like the ones people will type: words, a phrase, accents, and the start of a word. */
const SEARCHES = ["chicken", "garlic lime", '"sour cream"', "jalapeno", "tort*"];

let db: Database | null = null;

/** The worker's own postMessage (the app's types describe a window, not a worker). */
const scope = self as unknown as {
  postMessage(message: TrialResponse): void;
  onmessage: ((event: MessageEvent<TrialRequest>) => void) | null;
};

function send(message: TrialResponse) {
  scope.postMessage(message);
}

/** Runs a query a few times and reports the middle time, so one slow run doesn't decide it. */
function timed<T>(run: () => T, times = 3): { ms: number; result: T } {
  const durations: number[] = [];
  let result!: T;
  for (let i = 0; i < times; i++) {
    const start = performance.now();
    result = run();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  return { ms: durations[Math.floor(durations.length / 2)] ?? 0, result };
}

async function open() {
  const start = performance.now();
  const sqlite3 = await sqlite3InitModule();
  const loaded = performance.now();
  // Only one tab can hold this storage at a time; a second tab fails here.
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "fennl-storage-trial" });
  db = new pool.OpfsSAHPoolDb("/storage-trial.sqlite3");
  db.exec(SCHEMA);
  const opened = performance.now();
  send({
    type: "opened",
    sqliteVersion: sqlite3.version.libVersion,
    loadMs: loaded - start,
    openMs: opened - loaded,
    existing: Number(db.selectValue("select count(*) from recipe") ?? 0),
  });
}

function write(count: number) {
  if (!db) throw new Error("not open");
  const database = db;
  const start = performance.now();
  const already = Number(database.selectValue("select count(*) from recipe") ?? 0);
  const batch = 500;
  for (let from = already; from < already + count; from += batch) {
    database.transaction(() => {
      const insert = database.prepare(
        "insert into recipe (id, title, ingredients, directions, notes) values (?, ?, ?, ?, ?)",
      );
      try {
        for (let n = from; n < Math.min(from + batch, already + count); n++) {
          const r = sampleRecipe(n);
          insert.bind([r.id, r.title, r.ingredients, r.directions, r.notes]).stepReset();
        }
      } finally {
        insert.finalize();
      }
    });
    send({
      type: "progress",
      written: Math.min(from + batch, already + count) - already,
      of: count,
    });
  }
  const bytes = Number(
    database.selectValue(
      "select sum(length(title) + length(ingredients) + length(directions) + length(notes)) from recipe",
    ) ?? 0,
  );
  send({ type: "written", count, ms: performance.now() - start, textBytes: bytes });
}

function measure() {
  if (!db) throw new Error("not open");
  const database = db;
  const searches = SEARCHES.map((query) => {
    const { ms, result } = timed(() =>
      database.selectValues(
        "select rowid from recipe_search where recipe_search match ? order by bm25(recipe_search) limit 20",
        [query],
      ),
    );
    const matches = Number(
      database.selectValue("select count(*) from recipe_search where recipe_search match ?", [
        query,
      ]) ?? 0,
    );
    return { query, ms, matches, shown: result.length };
  });
  const list = timed(() =>
    database.selectArrays("select id, title from recipe order by title limit 50"),
  );
  const one = timed(() =>
    database.selectObject("select * from recipe where id = ?", [sampleRecipe(42).id]),
  );
  send({
    type: "measured",
    total: Number(database.selectValue("select count(*) from recipe") ?? 0),
    searches,
    listMs: list.ms,
    readOneMs: one.ms,
  });
}

function clear() {
  if (!db) throw new Error("not open");
  db.exec("drop table if exists recipe_search; drop table if exists recipe; vacuum;");
  db.exec(SCHEMA);
  send({ type: "cleared" });
}

scope.onmessage = async (event: MessageEvent<TrialRequest>) => {
  const request = event.data;
  try {
    if (request.type === "open") await open();
    else if (request.type === "write") write(request.count);
    else if (request.type === "measure") measure();
    else clear();
  } catch (error) {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    // Another tab holds the storage: the browser refuses a second "access handle".
    const busy =
      request.type === "open" && /access handle|NoModificationAllowed|locked|busy/i.test(text);
    send({ type: "error", during: request.type, busy, message: text });
  }
};
