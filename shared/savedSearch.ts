// Saved searches (phase C13b): a name for a search and its filters, kept with the person's
// account so they follow them to every device. A saved search is a rule, not a list of recipes,
// so it stays current as recipes change. It is stored as the recipe list's address query
// ("q=soup&time=30&without=mushroom", the same text app/recipes/filters.ts writes), which keeps
// one format for the address and for what is saved. Saved searches are the person's own: a
// partner in the household never sees them.

/** A sanity cap per account (not a plan limit: every plan gets the same). */
export const MAX_SAVED_SEARCHES = 100;
export const MAX_SAVED_NAME_LENGTH = 60;
export const MAX_SAVED_QUERY_LENGTH = 2000;

/** The address keys the recipe list understands (app/recipes/filters.ts). Nothing else is kept. */
export const SAVED_SEARCH_KEYS = [
  "q",
  "category",
  "also",
  "any",
  "notin",
  "rating",
  "time",
  "serves",
  "photo",
  "nutrition",
  "made",
  "source",
  "with",
  "without",
] as const;

const MAX_PARAMS = 60;
const MAX_VALUE_LENGTH = 200;

export interface SavedSearch {
  id: string;
  name: string;
  /** The search as an address query, without the "?". */
  query: string;
  createdAt: string;
  updatedAt: string;
}

/** A name as typed: spaces tidied, not too long. Null when nothing is left. */
export function cleanSavedName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const tidy = name.replace(/\s+/g, " ").trim();
  return tidy === "" || tidy.length > MAX_SAVED_NAME_LENGTH ? null : tidy;
}

/**
 * A search query as it will be kept, or null if it can't be one: only keys the list understands,
 * short values, not too many, and something to save. A leading "?" is allowed.
 */
export function cleanSavedQuery(query: unknown): string | null {
  if (typeof query !== "string" || query.length > MAX_SAVED_QUERY_LENGTH) return null;
  const params = new URLSearchParams(query.replace(/^\?/, ""));
  let count = 0;
  for (const [key, value] of params) {
    count++;
    if (!(SAVED_SEARCH_KEYS as readonly string[]).includes(key)) return null;
    if (value.length > MAX_VALUE_LENGTH) return null;
  }
  if (count === 0 || count > MAX_PARAMS) return null;
  return params.toString();
}

/** Whether two names are the same to a person (ignoring case and spacing). */
export const sameSavedName = (a: string, b: string): boolean =>
  a.replace(/\s+/g, " ").trim().toLocaleLowerCase() ===
  b.replace(/\s+/g, " ").trim().toLocaleLowerCase();
