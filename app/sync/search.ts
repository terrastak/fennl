import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Recipe, RecipeOpinion } from "../../shared/recipe";

// Searching the browser's copy of the recipe box (phase C8). Search runs on this device, so it
// works offline, and it's built on SQLite's full-text search (FTS5), chosen in C2.
//
// The index holds each recipe's title, headnote, ingredients, directions, notes (the recipe's
// own and everyone's signed notes) and source. It's kept up to date as records change here or
// arrive from the server (indexRecipe). Categories aren't in it: they're matched by their paths
// when searching, so renaming a category doesn't mean indexing every recipe in it again.
//
// A recipe matches when every word typed is found somewhere in it, as the start of a word
// ("chick" finds "chicken"), ignoring case and accents ("jalapeno" finds "jalapeño").

/** The index, as a step of the local schema (app/sync/schema.ts). Rows use the record's rowid. */
export const SEARCH_SCHEMA = `
  create virtual table recipe_search using fts5(
    recipe_id unindexed, title, description, ingredients, directions, notes, source,
    tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
  );`;

/** One recipe's index entry, from its record (and its opinions' notes). */
const INDEX_SQL = `
  insert into recipe_search (rowid, recipe_id, title, description, ingredients, directions, notes, source)
  select r.rowid, r.key,
    json_extract(r.data, '$.title'),
    json_extract(r.data, '$.description'),
    (select group_concat(json_extract(l.value, '$.text'), char(10))
       from json_each(r.data, '$.ingredients') l),
    (select group_concat(json_extract(l.value, '$.text'), char(10))
       from json_each(r.data, '$.directions') l),
    concat_ws(char(10), json_extract(r.data, '$.notes'),
      (select group_concat(json_extract(o.data, '$.note'), char(10)) from record o
        where o.kind = 'opinion' and o.key > r.key || '|' and o.key < r.key || '|~'
          and o.data is not null and json_extract(o.data, '$.deletedAt') is null)),
    concat_ws(' ', json_extract(r.data, '$.source.name'), json_extract(r.data, '$.source.author'),
      json_extract(r.data, '$.source.page'), json_extract(r.data, '$.source.url'))
  from record r
  where r.kind = 'recipe' and r.data is not null and json_extract(r.data, '$.deletedAt') is null`;

/** Indexes every recipe from scratch (the schema step that adds the index runs this). */
export const INDEX_ALL_SQL = `delete from recipe_search; ${INDEX_SQL};`;

/**
 * Brings one recipe's entry up to date: after it changed, an opinion on it changed, or it went
 * to Trash (then it has no entry). Entries go by the record's row; removing a recipe's record
 * removes its entry first (unindexRecords). A search also checks each entry against its record,
 * so a stale one never shows.
 */
export function indexRecipe(db: Database, recipeId: string): void {
  const rowid = db.selectValue("select rowid from record where kind = 'recipe' and key = ?", [
    recipeId,
  ]) as number | undefined;
  if (rowid === undefined) return;
  db.exec({ sql: "delete from recipe_search where rowid = ?", bind: [rowid] });
  db.exec({ sql: `${INDEX_SQL} and r.key = ?`, bind: [recipeId] });
}

/** Removes the entries of recipe records about to be removed (`where` picks them from record). */
export function unindexRecords(db: Database, where: string, bind: string[] = []): void {
  db.exec({
    sql: `delete from recipe_search where rowid in
      (select rowid from record where kind = 'recipe' and (${where}))`,
    bind,
  });
}

// ---------------------------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------------------------

/** Where a recipe matched, when it wasn't its title: "Ingredients: 2 cups buttermilk". */
export interface SearchHit {
  field: string;
  text: string;
}

export interface SearchResults {
  /** The words searched for, as understood. */
  terms: string[];
  /** Every matching recipe. */
  ids: string[];
  /** Those whose title has every word: they're shown first. */
  titleIds: string[];
  /** Where the others matched (for the first few hundred). */
  hits: Record<string, SearchHit>;
}

/** Lower case, without accents. */
export function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** The words of a search: letters and digits, at most ten. */
export function searchTerms(query: string): string[] {
  return [
    ...new Set(
      plain(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    ),
  ].slice(0, 10);
}

/** Whether text has a word starting with the term. */
function hasWordStarting(text: string, term: string): boolean {
  const at = plain(text);
  let i = at.indexOf(term);
  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(at[i - 1] ?? "")) return true;
    i = at.indexOf(term, i + 1);
  }
  return false;
}

const HITS_SHOWN = 300;
const EXCERPT_LENGTH = 120;

function excerpt(line: string): string {
  const text = line.replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;
}

/** The first place in a recipe where one of the words is found. */
function findHit(
  recipe: Recipe,
  notes: string[],
  categories: string[],
  terms: string[],
): SearchHit | null {
  const places: [string, string[]][] = [
    ["Ingredients", recipe.ingredients.map((l) => l.text)],
    ["Method", recipe.directions.map((l) => l.text)],
    ["Notes", [recipe.notes, ...notes].flatMap((n) => n.split("\n"))],
    ["About", [recipe.description]],
    [
      "Source",
      [
        [recipe.source.name, recipe.source.author, recipe.source.page, recipe.source.url]
          .filter(Boolean)
          .join(" · "),
      ],
    ],
    ["Category", categories],
  ];
  for (const [field, lines] of places) {
    const line = lines.find((l) => terms.some((term) => hasWordStarting(l, term)));
    if (line) return { field, text: excerpt(line) };
  }
  return null;
}

/**
 * Searches the recipes in the index. `categories` gives each recipe's category paths ("Desserts ›
 * Cakes"), which match like any other words.
 */
export function searchRecipes(
  db: Database,
  query: string,
  categories: Map<string, string[]>,
): SearchResults {
  const terms = searchTerms(query);
  if (terms.length === 0) return { terms, ids: [], titleIds: [], hits: {} };

  const matching = (match: string): Set<string> =>
    new Set(
      db.selectValues(
        `select s.recipe_id from recipe_search s
          join record r on r.rowid = s.rowid and r.kind = 'recipe' and r.key = s.recipe_id
          where recipe_search match ?`,
        [match],
      ) as string[],
    );

  const found: Set<string>[] = [];
  const titled: Set<string>[] = [];
  for (const term of terms) {
    const anywhere = matching(`"${term}"*`);
    for (const [recipeId, paths] of categories) {
      if (paths.some((path) => hasWordStarting(path, term))) anywhere.add(recipeId);
    }
    found.push(anywhere);
    titled.push(matching(`{title} : "${term}"*`));
  }
  // Every word must match: what all the words' matches have in common.
  const everyWord = (sets: Set<string>[]) =>
    [...(sets[0] ?? [])].filter((id) => sets.every((set) => set.has(id)));
  const ids = everyWord(found);
  const titleIds = everyWord(titled);

  // Where the others matched, for showing under their titles.
  const titleSet = new Set(titleIds);
  const others = ids.filter((id) => !titleSet.has(id)).slice(0, HITS_SHOWN);
  const hits: Record<string, SearchHit> = {};
  if (others.length > 0) {
    const marks = others.map(() => "?").join(", ");
    const rows = db.selectArrays(
      `select key, data from record where kind = 'recipe' and key in (${marks})`,
      others,
    ) as [string, string][];
    const notes = new Map<string, string[]>();
    for (const text of db.selectValues(
      `select data from record where kind = 'opinion' and data is not null
        and substr(key, 1, 36) in (${marks})`,
      others,
    ) as string[]) {
      const opinion = JSON.parse(text) as RecipeOpinion;
      if (!opinion.deletedAt && opinion.note) {
        notes.set(opinion.recipeId, [...(notes.get(opinion.recipeId) ?? []), opinion.note]);
      }
    }
    for (const [recipeId, data] of rows) {
      const hit = findHit(
        JSON.parse(data) as Recipe,
        notes.get(recipeId) ?? [],
        categories.get(recipeId) ?? [],
        terms,
      );
      if (hit) hits[recipeId] = hit;
    }
  }
  return { terms, ids, titleIds, hits };
}
