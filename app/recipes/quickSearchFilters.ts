import {
  MAX_SOURCE_LENGTH,
  quick,
  quickSearchKey,
  type QuickFilter,
  type QuickSearchItem,
} from "../../shared/quickSearches";
import type { RecipeSummary } from "../sync/dbProtocol";
import { applyFilters, cleanWords, type RecipeFilters } from "./filters";

// What a quick search's tick line (U18, shared/quickSearches.ts) does to the recipe list's filters
// (filters.ts): whether it is on, turning it on or off, the filters set in Filters that could be
// added as tick lines, and how many recipes each line would show.
//
// A tick line is one part of the filters. Lines on the same part behave like radio buttons
// without anything extra: turning on "4 stars and up" turns Favorites off, since both are the
// stars. Turning a line off clears only its own part, and only when it is what that part holds.

const sameWord = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
const hasWord = (words: string[], word: string) => words.some((w) => sameWord(w, word));

/** Whether a tick line is on: the filters hold exactly its choice (or its word). */
export function quickFilterOn(item: QuickFilter, filters: RecipeFilters): boolean {
  switch (item.filter) {
    case "favorites":
      return filters.rating === "favorite";
    case "time":
      return filters.maxMinutes === item.minutes;
    case "rating":
      return filters.rating === item.value;
    case "made":
      return filters.made === item.value;
    case "serves":
      return filters.minServings === item.value;
    case "photo":
      return filters.photo;
    case "nutrition":
      return filters.nutrition;
    case "with":
      return hasWord(filters.with, item.word);
    case "without":
      return hasWord(filters.without, item.word);
    case "source":
      return sameWord(filters.source.trim(), item.value);
  }
}

/**
 * The filters with a tick line turned on. A word goes in with the others (and out of the
 * opposite list, as a recipe can't both have it and not).
 */
export function turnOnQuickFilter(filters: RecipeFilters, item: QuickFilter): RecipeFilters {
  switch (item.filter) {
    case "favorites":
      return { ...filters, rating: "favorite" };
    case "time":
      return { ...filters, maxMinutes: item.minutes };
    case "rating":
      return { ...filters, rating: item.value };
    case "made":
      return { ...filters, made: item.value };
    case "serves":
      return { ...filters, minServings: item.value };
    case "photo":
      return { ...filters, photo: true };
    case "nutrition":
      return { ...filters, nutrition: true };
    case "with":
      return {
        ...filters,
        with: hasWord(filters.with, item.word)
          ? filters.with
          : cleanWords([...filters.with, item.word]),
        without: filters.without.filter((w) => !sameWord(w, item.word)),
      };
    case "without":
      return {
        ...filters,
        without: hasWord(filters.without, item.word)
          ? filters.without
          : cleanWords([...filters.without, item.word]),
        with: filters.with.filter((w) => !sameWord(w, item.word)),
      };
    case "source":
      return { ...filters, source: item.value };
  }
}

/** The filters with a tick line turned off: only its own part, and only when it is on. */
export function turnOffQuickFilter(filters: RecipeFilters, item: QuickFilter): RecipeFilters {
  if (!quickFilterOn(item, filters)) return filters;
  switch (item.filter) {
    case "favorites":
    case "rating":
      return { ...filters, rating: "" };
    case "time":
      return { ...filters, maxMinutes: null };
    case "made":
      return { ...filters, made: "" };
    case "serves":
      return { ...filters, minServings: null };
    case "photo":
      return { ...filters, photo: false };
    case "nutrition":
      return { ...filters, nutrition: false };
    case "with":
      return { ...filters, with: filters.with.filter((w) => !sameWord(w, item.word)) };
    case "without":
      return { ...filters, without: filters.without.filter((w) => !sameWord(w, item.word)) };
    case "source":
      return { ...filters, source: "" };
  }
}

/** The filters with a tick line switched: off when it is on, else on. */
export function toggleQuickFilter(filters: RecipeFilters, item: QuickFilter): RecipeFilters {
  return quickFilterOn(item, filters)
    ? turnOffQuickFilter(filters, item)
    : turnOnQuickFilter(filters, item);
}

/**
 * The filters set in Filters that could be a tick line, in the panel's order, each as the line it
 * would add ("My favorites" is the Favorites line). Categories never are.
 */
export function quickFiltersIn(filters: RecipeFilters): QuickFilter[] {
  const items: QuickFilter[] = [];
  if (filters.maxMinutes !== null) items.push(quick.time(filters.maxMinutes));
  if (filters.rating === "favorite") items.push(quick.favorites);
  else if (filters.rating) items.push(quick.rating(filters.rating));
  if (filters.made) items.push(quick.made(filters.made));
  if (filters.minServings !== null) items.push(quick.serves(filters.minServings));
  if (filters.photo) items.push(quick.photo);
  if (filters.nutrition) items.push(quick.nutrition);
  const source = filters.source.replace(/\s+/g, " ").trim().slice(0, MAX_SOURCE_LENGTH).trim();
  if (source) items.push(quick.source(source));
  for (const word of filters.with) items.push(quick.with(word));
  for (const word of filters.without) items.push(quick.without(word));
  return items;
}

/** Whether a line is in the list (the same filter and choice, or word ignoring case). */
export function inQuickSearches(items: QuickSearchItem[], item: QuickSearchItem): boolean {
  const key = quickSearchKey(item);
  return items.some((i) => quickSearchKey(i) === key);
}

/**
 * The ingredient words the tick lines need answers for to be counted, beyond those the filters
 * already ask for (filters.ts ingredientWords).
 */
export function quickSearchWords(items: QuickSearchItem[]): string[] {
  const words: string[] = [];
  for (const item of items) {
    if (item.type !== "filter" || (item.filter !== "with" && item.filter !== "without")) continue;
    if (!hasWord(words, item.word)) words.push(item.word);
  }
  return words;
}

/**
 * How many recipes each tick line would show (or shows, when it is on), by `quickSearchKey`: the
 * filters as they are with that line turned on, following the words searched for (`matching`:
 * the ids the search found, or null with nothing typed). Search lines aren't counted. A word line
 * whose word has no answer in `ingredients` is left out (ask for `quickSearchWords` too). Null
 * while the ingredient answers haven't arrived.
 */
export function quickSearchCounts(
  items: QuickSearchItem[],
  recipes: RecipeSummary[],
  filters: RecipeFilters,
  ingredients: Record<string, string[]> | null,
  today: string,
  matching: Set<string> | null,
): Map<string, number> | null {
  const counts = new Map<string, number>();
  const answered = (word: string) =>
    ingredients !== null && Object.keys(ingredients).some((w) => sameWord(w, word));
  for (const item of items) {
    if (item.type !== "filter") continue;
    if ((item.filter === "with" || item.filter === "without") && !answered(item.word)) continue;
    const shown = turnOnQuickFilter(filters, item);
    const found = applyFilters(
      recipes,
      shown,
      ingredients ? withAnswers(ingredients, shown) : null,
      today,
    );
    if (found.pending) return null;
    const ids = matching ? found.recipes.filter((r) => matching.has(r.id)) : found.recipes;
    counts.set(quickSearchKey(item), ids.length);
  }
  return counts;
}

/**
 * The ingredient answers under the words exactly as the filters write them (applyFilters looks
 * them up as written), whatever case the answers were asked for in.
 */
function withAnswers(
  ingredients: Record<string, string[]>,
  filters: RecipeFilters,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...ingredients };
  for (const word of [...filters.with, ...filters.without]) {
    if (word in out) continue;
    const match = Object.entries(ingredients).find(([w]) => sameWord(w, word));
    if (match) out[word] = match[1];
  }
  return out;
}
