import { MAX_SAVED_SEARCHES, type SavedSearch } from "./savedSearch";

// Quick searches (U18, owner's choices 2026-11-05): the left panel's shortcuts, chosen and put in
// order by the person and kept with their account, so every device shows the same ones. Two kinds
// of line: a tick line is one filter, on or off, staying on with whatever else is chosen
// (Favorites, 30 minutes or less, Without mushroom); a search line shows a whole saved search
// (shared/savedSearch.ts), named by its id here. The list is stored as JSON in user.quick_searches;
// never set means DEFAULT_QUICK_SEARCHES. Saved searches stay in their own table: one the list
// doesn't name yet is shown at the end, and an id whose saved search is gone is skipped, so saving
// or deleting a saved search never has to write the list.
//
// What a tick line does to the recipe list's filters is in app/recipes/quickSearchFilters.ts,
// next to the filters themselves.

/** The total-time choices, in minutes ("30 minutes or less"); the recipe list's too. */
export const TIME_CHOICES = [15, 30, 45, 60, 90, 120];
/** The "serves at least" choices; the recipe list's too. */
export const SERVING_CHOICES = [2, 4, 6, 8, 12];
/** The longest ingredient word and source name the recipe list's filters keep. */
export const MAX_WORD_LENGTH = 40;
export const MAX_SOURCE_LENGTH = 80;
/**
 * A sanity cap on the tick lines (not a plan limit: every plan gets the same). Search lines are
 * capped separately, by how many saved searches a person may keep (MAX_SAVED_SEARCHES), since every
 * saved search shows as one: so a list holding all of them can always be saved.
 */
export const MAX_QUICK_SEARCHES = 60;

/** How many tick lines (not search lines) a list has, for MAX_QUICK_SEARCHES. */
export function quickFilterCount(items: QuickSearchItem[]): number {
  return items.reduce((n, item) => (item.type === "filter" ? n + 1 : n), 0);
}

function fits(items: QuickSearchItem[]): boolean {
  return (
    quickFilterCount(items) <= MAX_QUICK_SEARCHES &&
    items.length - quickFilterCount(items) <= MAX_SAVED_SEARCHES
  );
}
const MAX_SEARCH_ID_LENGTH = 64;

export type QuickRating = "5" | "4" | "3" | "none";
export const QUICK_RATINGS: QuickRating[] = ["5", "4", "3", "none"];
export type QuickMade = "recent" | "never" | "old";
export const QUICK_MADE: QuickMade[] = ["recent", "never", "old"];

/** A tick line: one filter, on or off. */
export type QuickFilter =
  | { type: "filter"; filter: "favorites" }
  | { type: "filter"; filter: "time"; minutes: number }
  | { type: "filter"; filter: "rating"; value: QuickRating }
  | { type: "filter"; filter: "made"; value: QuickMade }
  | { type: "filter"; filter: "serves"; value: number }
  | { type: "filter"; filter: "photo" }
  | { type: "filter"; filter: "nutrition" }
  | { type: "filter"; filter: "with"; word: string }
  | { type: "filter"; filter: "without"; word: string }
  | { type: "filter"; filter: "source"; value: string };

/** A search line: a saved search, by its id. */
export interface QuickSavedSearch {
  type: "search";
  id: string;
}

export type QuickSearchItem = QuickFilter | QuickSavedSearch;

/** Lines made in code: `quick.time(30)`, `quick.without("mushroom")`. */
export const quick = {
  favorites: { type: "filter", filter: "favorites" } as QuickFilter,
  time: (minutes: number): QuickFilter => ({ type: "filter", filter: "time", minutes }),
  rating: (value: QuickRating): QuickFilter => ({ type: "filter", filter: "rating", value }),
  made: (value: QuickMade): QuickFilter => ({ type: "filter", filter: "made", value }),
  serves: (value: number): QuickFilter => ({ type: "filter", filter: "serves", value }),
  photo: { type: "filter", filter: "photo" } as QuickFilter,
  nutrition: { type: "filter", filter: "nutrition" } as QuickFilter,
  with: (word: string): QuickFilter => ({ type: "filter", filter: "with", word }),
  without: (word: string): QuickFilter => ({ type: "filter", filter: "without", word }),
  source: (value: string): QuickFilter => ({ type: "filter", filter: "source", value }),
  search: (id: string): QuickSavedSearch => ({ type: "search", id }),
};

/** New accounts start with these (owner's choice 2026-11-05). */
export const DEFAULT_QUICK_SEARCHES: QuickSearchItem[] = [quick.favorites, quick.time(30)];

/** The common ones offered by "+ Add", in this order (owner's choice 2026-11-05). */
export const QUICK_PRESETS: QuickFilter[] = [
  quick.favorites,
  quick.time(30),
  quick.made("recent"),
  quick.made("never"),
  quick.rating("4"),
  quick.rating("none"),
  quick.photo,
];

const lower = (text: string) => text.toLocaleLowerCase();

/**
 * One text per line, the same for lines that are the same to a person ("With Lime" and
 * "with lime"), used for telling duplicates apart and as the line's key on screen.
 */
export function quickSearchKey(item: QuickSearchItem): string {
  if (item.type === "search") return `search:${item.id}`;
  switch (item.filter) {
    case "favorites":
    case "photo":
    case "nutrition":
      return item.filter;
    case "time":
      return `time:${item.minutes}`;
    case "rating":
    case "made":
    case "serves":
      return `${item.filter}:${item.value}`;
    case "source":
      return `source:${lower(item.value)}`;
    case "with":
    case "without":
      return `${item.filter}:${lower(item.word)}`;
  }
}

/** A time as a tick line says it: "30 minutes or less", "1 hour or less", "1½ hours or less". */
export function timeLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes or less`;
  const hours = `${Math.floor(minutes / 60)}${minutes % 60 === 30 ? "½" : ""}`;
  return `${hours} ${minutes === 60 ? "hour" : "hours"} or less`;
}

const RATING_NAMES: Record<QuickRating, string> = {
  "5": "5 stars",
  "4": "4 stars and up",
  "3": "3 stars and up",
  none: "Not rated yet",
};

const MADE_NAMES: Record<QuickMade, string> = {
  recent: "Made lately",
  never: "Never made",
  old: "Not made in 90 days",
};

/** A tick line's name: "Favorites", "4 stars and up", "Without mushroom". */
export function quickFilterLabel(item: QuickFilter): string {
  switch (item.filter) {
    case "favorites":
      return "Favorites";
    case "time":
      return timeLabel(item.minutes);
    case "rating":
      return RATING_NAMES[item.value];
    case "made":
      return MADE_NAMES[item.value];
    case "serves":
      return `Serves ${item.value} or more`;
    case "photo":
      return "Has a photo";
    case "nutrition":
      return "Has nutrition";
    case "with":
      return `With ${item.word}`;
    case "without":
      return `Without ${item.word}`;
    case "source":
      return `From ${item.value}`;
  }
}

/**
 * The other choices a tick line's ▾ offers, the line's own among them, in order: the times, the
 * stars, when last made and serves at least. Empty for a line with no choices.
 */
export function quickChoices(item: QuickSearchItem): QuickFilter[] {
  if (item.type !== "filter") return [];
  switch (item.filter) {
    case "time":
      return TIME_CHOICES.map(quick.time);
    case "rating":
      return QUICK_RATINGS.map(quick.rating);
    case "made":
      return QUICK_MADE.map(quick.made);
    case "serves":
      return SERVING_CHOICES.map(quick.serves);
    default:
      return [];
  }
}

/**
 * Whether a "+ Add" preset is already a line (shown ticked): a time preset matches a line of any
 * time, since the ▾ changes it; the others match the same filter and choice exactly.
 */
export function presetMatches(preset: QuickFilter, item: QuickSearchItem): boolean {
  if (item.type !== "filter") return false;
  if (preset.filter === "time") return item.filter === "time";
  return quickSearchKey(preset) === quickSearchKey(item);
}

/** The index of the line a "+ Add" preset stands for, or -1. */
export function presetIndex(preset: QuickFilter, items: QuickSearchItem[]): number {
  return items.findIndex((item) => presetMatches(preset, item));
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const isTidyText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value !== "" && value.length <= max && tidy(value) === value;

function hasOnly(v: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/** Whether a value is one well-formed line, with nothing extra in it. */
export function isQuickSearchItem(value: unknown): value is QuickSearchItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.type === "search") {
    return (
      hasOnly(v, ["type", "id"]) &&
      typeof v.id === "string" &&
      v.id.length <= MAX_SEARCH_ID_LENGTH &&
      /^[A-Za-z0-9_-]+$/.test(v.id)
    );
  }
  if (v.type !== "filter") return false;
  switch (v.filter) {
    case "favorites":
    case "photo":
    case "nutrition":
      return hasOnly(v, ["type", "filter"]);
    case "time":
      return (
        hasOnly(v, ["type", "filter", "minutes"]) && TIME_CHOICES.includes(v.minutes as number)
      );
    case "serves":
      return hasOnly(v, ["type", "filter", "value"]) && SERVING_CHOICES.includes(v.value as number);
    case "rating":
      return (
        hasOnly(v, ["type", "filter", "value"]) && QUICK_RATINGS.includes(v.value as QuickRating)
      );
    case "made":
      return hasOnly(v, ["type", "filter", "value"]) && QUICK_MADE.includes(v.value as QuickMade);
    case "source":
      return hasOnly(v, ["type", "filter", "value"]) && isTidyText(v.value, MAX_SOURCE_LENGTH);
    case "with":
    case "without":
      return hasOnly(v, ["type", "filter", "word"]) && isTidyText(v.word, MAX_WORD_LENGTH);
    default:
      return false;
  }
}

/**
 * Whether a value sent to the server is a whole, correct list: well-formed lines, not too many
 * (MAX_QUICK_SEARCHES tick lines, MAX_SAVED_SEARCHES search lines), and no line twice (the same
 * filter and choice, the same word ignoring case, the same search).
 */
export function isQuickSearchList(value: unknown): value is QuickSearchItem[] {
  if (!Array.isArray(value) || value.length > MAX_QUICK_SEARCHES + MAX_SAVED_SEARCHES) return false;
  if (!value.every(isQuickSearchItem) || !fits(value)) return false;
  const keys = new Set(value.map(quickSearchKey));
  return keys.size === value.length;
}

/**
 * The list as stored with the account (user.quick_searches): never set gives the starting list;
 * anything not understood is left out, and a line twice is kept once, so a list kept by an older
 * or newer version of Fennl still shows.
 */
export function readQuickSearches(text: string | null | undefined): QuickSearchItem[] {
  if (text === null || text === undefined) return DEFAULT_QUICK_SEARCHES;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_QUICK_SEARCHES;
  }
  if (!Array.isArray(value)) return DEFAULT_QUICK_SEARCHES;
  const seen = new Set<string>();
  const items: QuickSearchItem[] = [];
  for (const item of value) {
    if (!isQuickSearchItem(item)) continue;
    const key = quickSearchKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (!fits(items)) items.pop();
  }
  return items;
}

/**
 * The lines to show: the stored ones in their order, skipping a saved search that is gone, then
 * every saved search the list doesn't name yet, oldest first (so a new one comes last). With the
 * saved searches not known yet (null), the stored lines are kept as they are and nothing is added.
 */
export function mergeQuickSearches(
  items: QuickSearchItem[],
  searches: Pick<SavedSearch, "id" | "createdAt">[] | null,
): QuickSearchItem[] {
  if (searches === null) return items;
  const ids = new Set(searches.map((s) => s.id));
  const kept = items.filter((item) => item.type !== "search" || ids.has(item.id));
  const named = new Set(kept.flatMap((item) => (item.type === "search" ? [item.id] : [])));
  const added = searches
    .filter((s) => !named.has(s.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((s) => quick.search(s.id));
  return [...kept, ...added];
}

/**
 * The list with a line added at the end; unchanged when it's already there or there is no room
 * for it (quickSearchFull).
 */
export function addQuickSearch(items: QuickSearchItem[], item: QuickSearchItem): QuickSearchItem[] {
  const key = quickSearchKey(item);
  if (quickSearchFull(items, item) || items.some((i) => quickSearchKey(i) === key)) {
    return items;
  }
  return [...items, item];
}

/** Whether there's no room left in the list for one more line like this one. */
export function quickSearchFull(items: QuickSearchItem[], item: QuickSearchItem): boolean {
  return !fits([...items, item]);
}

/** The list without the line with this key. */
export function removeQuickSearch(items: QuickSearchItem[], key: string): QuickSearchItem[] {
  return items.filter((item) => quickSearchKey(item) !== key);
}

/**
 * The list with one line changed in place (a choice from its ▾). Another line that is now the
 * same is removed. Unchanged when no line has the key.
 */
export function replaceQuickSearch(
  items: QuickSearchItem[],
  key: string,
  next: QuickSearchItem,
): QuickSearchItem[] {
  if (!items.some((item) => quickSearchKey(item) === key)) return items;
  const nextKey = quickSearchKey(next);
  return items
    .filter((item) => {
      const k = quickSearchKey(item);
      return k === key || k !== nextKey;
    })
    .map((item) => (quickSearchKey(item) === key ? next : item));
}

/**
 * The list with one line moved to a new place (0 is the top; past the end is the end). Unchanged
 * when no line has the key.
 */
export function moveQuickSearch(
  items: QuickSearchItem[],
  key: string,
  to: number,
): QuickSearchItem[] {
  const moving = items.find((item) => quickSearchKey(item) === key);
  if (!moving) return items;
  const rest = items.filter((item) => item !== moving);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/**
 * The list with one line moved to just before another (`before`), or to the end (null), as a drag
 * drops it between two lines. Unchanged when no line has the key, or `before` is not in the list.
 */
export function moveQuickSearchBefore(
  items: QuickSearchItem[],
  key: string,
  before: string | null,
): QuickSearchItem[] {
  const moving = items.find((item) => quickSearchKey(item) === key);
  if (!moving || before === key) return items;
  const rest = items.filter((item) => item !== moving);
  if (before === null) return [...rest, moving];
  const at = rest.findIndex((item) => quickSearchKey(item) === before);
  if (at === -1) return items;
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}
