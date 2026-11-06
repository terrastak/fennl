import {
  quick,
  quickFilterLabel,
  QUICK_MADE,
  SERVING_CHOICES,
  TIME_CHOICES,
  type QuickSearchItem,
} from "../../shared/quickSearches";
import { CATEGORY_SEPARATOR } from "../../shared/recipe";
import { pathKey } from "../categories/tree";
import type { RecipeSummary } from "../sync/dbProtocol";
import {
  applyFilters,
  filterLabels,
  minutesLabel,
  NO_FILTERS,
  searchKey,
  UNFILED,
  type RecipeFilters,
} from "./filters";
import { quickSearchCounts } from "./quickSearchFilters";

// The recipe box in the left panel (U17, owner's choices 2026-11-04), as plain data: which list
// or category is picked, and how many recipes each row would show with the words searched for
// and the filters that are on.
//
// "All recipes" and the categories are lists: one is picked at a time. The quick searches' tick
// lines (U18, quickSearchFilters.ts) are on/off and stay on together with a category. Clicking
// "All recipes" starts fresh (owner's choice 2026-11-05): no words, no filters, no category, so
// it also closes a saved search; its count is every recipe.
// Everything is still kept in the address (filters.ts), so back, forward and saved searches keep
// working.

export type Picked = { kind: "all" } | { kind: "category"; key: string };

/** What the list shows: a category, or all recipes. */
export function pickedList(filters: RecipeFilters): Picked {
  if (filters.category) return { kind: "category", key: filters.category };
  return { kind: "all" };
}

/** "All recipes" as the left panel's row and the phone's sheet show it: everything, nothing on. */
export const ALL_RECIPES: RecipeFilters = NO_FILTERS;

/** Whether the list shows every recipe, with nothing searched or filtered. */
export function showingEverything(query: string, filters: RecipeFilters): boolean {
  return searchKey(query, filters) === searchKey("", ALL_RECIPES);
}

/**
 * No category; the search and the filters stay. For "Show all categories" and "Search all
 * recipes", which drop only the category; the "All recipes" row starts fresh (ALL_RECIPES).
 */
export function pickAll(filters: RecipeFilters): RecipeFilters {
  return { ...filters, category: "", alsoIn: [], anyCategory: false };
}

export function pickCategory(filters: RecipeFilters, key: string): RecipeFilters {
  return { ...filters, category: key, alsoIn: filters.alsoIn.filter((k) => k !== key) };
}

export interface LibraryCounts {
  /** Every recipe: what the "All recipes" row shows, whatever is searched or filtered. */
  total: number;
  /** Every recipe the search and filters leave, whatever is picked. */
  all: number;
  /**
   * By quick search key (shared/quickSearches.ts): what the list would show with that tick line
   * on (or shows, when it is on). Search lines aren't counted.
   */
  quick: Map<string, number>;
  /**
   * By category key: what clicking it would show (recipes in it or anything inside it, with
   * More filters' "also in" kept). Read with `categoryCount`: a key not here has `otherwise`.
   */
  byKey: Map<string, number>;
  /** What a category not in `byKey` would show: none, unless "in any category" is on. */
  otherwise: number;
  /** Recipes in no category. */
  unfiled: number;
}

/** The keys of a category path and every category it sits inside. */
function keysOf(path: string): string[] {
  const names = path.split(CATEGORY_SEPARATOR);
  return names.map((_, i) => pathKey(names.slice(0, i + 1)));
}

/**
 * How many recipes each row of the left panel would show, following the words searched for
 * (`matching`: the ids the search found, or null with nothing typed) and every filter except
 * what is picked. Null while the ingredient answers haven't arrived.
 */
export function libraryCounts(
  recipes: RecipeSummary[],
  filters: RecipeFilters,
  ingredients: Record<string, string[]> | null,
  today: string,
  matching: Set<string> | null,
  /** The quick searches, each tick line counted. */
  items: QuickSearchItem[] = [],
): LibraryCounts | null {
  const count = (f: RecipeFilters) => {
    const found = applyFilters(recipes, f, ingredients, today);
    if (found.pending) return null;
    return matching ? found.recipes.filter((r) => matching.has(r.id)) : found.recipes;
  };
  const base = count(pickAll(filters));
  const quickCounts = quickSearchCounts(items, recipes, filters, ingredients, today, matching);
  if (!base || !quickCounts) return null;

  // A category's count is what clicking it shows (pickCategory), so More filters' "also in"
  // stays: the recipes in every one of those (each under the key is then counted), or, with "in
  // any category", those in any of them plus the ones under the key.
  const also = filters.alsoIn.length > 0;
  const inAlso = also
    ? count({ ...pickAll(filters), alsoIn: filters.alsoIn, anyCategory: filters.anyCategory })
    : base;
  const unfiled = also ? count(pickCategory(filters, UNFILED)) : null;
  if (!inAlso || (also && !unfiled)) return null;
  const either = also && filters.anyCategory;
  const already = either ? new Set(inAlso.map((r) => r.id)) : null;
  const otherwise = either ? inAlso.length : 0;

  const byKey = new Map<string, number>();
  for (const recipe of either ? base : inAlso) {
    if (already?.has(recipe.id)) continue;
    const keys = new Set(recipe.categories.flatMap(keysOf));
    for (const key of keys) byKey.set(key, (byKey.get(key) ?? otherwise) + 1);
  }
  return {
    total: recipes.length,
    all: base.length,
    quick: quickCounts,
    byKey,
    otherwise,
    unfiled: unfiled ? unfiled.length : base.filter((r) => r.categories.length === 0).length,
  };
}

/** How many recipes clicking a category would show. */
export function categoryCount(counts: LibraryCounts, key: string): number {
  return counts.byKey.get(key) ?? counts.otherwise;
}

/**
 * How many more recipes match the search outside the category picked ("5 more match outside
 * Dessert"): All recipes' count less those shown. Only when nothing else ties the list to
 * categories: with More filters' "also in" or "in any category" on, All recipes would drop those
 * too, so the difference wouldn't be what is outside the category alone.
 */
export function outsideCount(filters: RecipeFilters, all: number, shown: number): number {
  if (!filters.category || filters.alsoIn.length > 0 || filters.anyCategory) return 0;
  return Math.max(0, all - shown);
}

/**
 * A category's name as the address writes it ("Diet › Vegetarian" gives "Vegetarian"), for while
 * the categories aren't known yet, or for one the address names that no longer exists (an old
 * bookmark): never the lowercased key.
 */
export function addressCategoryName(search: string, key: string): string {
  const typed = new URLSearchParams(search).get("category") ?? "";
  if (typed.toLocaleLowerCase() !== key) return key;
  return typed.split(CATEGORY_SEPARATOR).pop()?.trim() || key;
}

/** The list's title: the category's name, or "All recipes". */
export function listTitle(filters: RecipeFilters, nameOf: (key: string) => string): string {
  const picked = pickedList(filters);
  if (picked.kind === "category") {
    return picked.key === UNFILED ? "Not in a category" : nameOf(picked.key);
  }
  return "All recipes";
}

/**
 * What narrows the list beyond what is picked, in words, the stars and time first. A choice a
 * quick search's tick line can hold is said as the line says it ("45 minutes or less", "Made
 * lately"); anything else as Filters says it ("Up to 25 minutes").
 */
export function narrowingLabels(filters: RecipeFilters, nameOf: (key: string) => string): string[] {
  const labels: string[] = [];
  if (filters.rating === "favorite") labels.push(quickFilterLabel(quick.favorites));
  else if (filters.rating) labels.push(quickFilterLabel(quick.rating(filters.rating)));
  const { maxMinutes, minServings, made } = filters;
  if (maxMinutes !== null) {
    labels.push(
      TIME_CHOICES.includes(maxMinutes)
        ? quickFilterLabel(quick.time(maxMinutes))
        : `Up to ${minutesLabel(maxMinutes)}`,
    );
  }
  for (const item of filterLabels(filters, nameOf)) {
    if (item.id === "time") continue;
    if (item.id === "made" && made && QUICK_MADE.includes(made)) {
      labels.push(quickFilterLabel(quick.made(made)));
    } else if (
      item.id === "serves" &&
      minServings !== null &&
      SERVING_CHOICES.includes(minServings)
    ) {
      labels.push(quickFilterLabel(quick.serves(minServings)));
    } else labels.push(item.label);
  }
  return labels;
}

/** "1 recipe", "6 recipes". */
export const recipesText = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

/** A part of the count line after the count ("matching “lemon”", "30 minutes or less"). */
export interface CountPart {
  text: string;
  /**
   * Not in the saved search the heading names (U20): the person added it since choosing that
   * search, so it's shown as "+ Favorites", marked in words as well as colour.
   */
  added: boolean;
}

/** A saved search's words and filters, read back from its text (filters.ts parseSearch). */
export interface SavedShape {
  q: string;
  filters: RecipeFilters;
}

const same = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * What the count line says after the count (U20, owner's choices 2026-11-05): the words typed
 * ("matching “lemon”"), then what else narrows the list, as narrowingLabels says it. With a
 * saved search's name as the heading (`saved`), its category is said too ("in Dessert", since the
 * heading no longer names it), and anything the saved search doesn't have is marked `added` and
 * put last; what it had and the list no longer does simply isn't there.
 */
export function countLineParts(
  query: string,
  filters: RecipeFilters,
  nameOf: (key: string) => string,
  saved: SavedShape | null = null,
): CountPart[] {
  const parts: CountPart[] = [];
  const words = query.trim();
  if (words) {
    parts.push({ text: `matching “${words}”`, added: saved !== null && !same(saved.q, words) });
  }
  if (saved && filters.category) {
    parts.push({
      text: filters.category === UNFILED ? "not in a category" : `in ${nameOf(filters.category)}`,
      added: saved.filters.category !== filters.category,
    });
  }
  const had = saved ? narrowingLabels(saved.filters, nameOf) : [];
  for (const label of narrowingLabels(filters, nameOf)) {
    parts.push({ text: label, added: saved !== null && !had.some((h) => same(h, label)) });
  }
  // What was added comes last, after what the saved search already had; the words stay first.
  const [first, ...rest] = parts;
  if (!words || !first) return [...parts.filter((p) => !p.added), ...parts.filter((p) => p.added)];
  return [first, ...rest.filter((p) => !p.added), ...rest.filter((p) => p.added)];
}

/**
 * The count line as one text, for tests and anything that can't show the marks: "4 recipes ·
 * matching “lemon” · Favorites (added)".
 */
export function countLineText(shown: number, parts: CountPart[]): string {
  return [recipesText(shown), ...parts.map((p) => (p.added ? `${p.text} (added)` : p.text))].join(
    " · ",
  );
}

/**
 * A name for "Save as new" (U20): the saved search's name with the first number after it that no
 * saved search uses yet ("Quick dinners 2", then 3), kept within the name's length.
 */
export function nextFreeName(name: string, taken: string[], maxLength: number): string {
  const used = new Set(taken.map((t) => t.trim().toLocaleLowerCase()));
  const base = name.trim();
  for (let n = 2; ; n++) {
    const end = ` ${n}`;
    const candidate = `${base.slice(0, Math.max(0, maxLength - end.length)).trimEnd()}${end}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
