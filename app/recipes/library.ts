import { CATEGORY_SEPARATOR } from "../../shared/recipe";
import { pathKey } from "../categories/tree";
import type { RecipeSummary } from "../sync/dbProtocol";
import {
  applyFilters,
  filterLabels,
  minutesLabel,
  RATING_LABELS,
  UNFILED,
  type RecipeFilters,
} from "./filters";

// The recipe box in the left panel (U17, owner's choices 2026-11-04), as plain data: which list
// or category is picked, the quick lists' on/off switches, and how many recipes each row would
// show with the words searched for and the switches that are on.
//
// "All recipes", "Made lately" and the categories are lists: one is picked at a time. Favorites
// and "30 minutes or less" are on/off and stay on together with whatever is picked. Everything is
// still kept in the address (filters.ts), so back, forward and saved searches keep working.

/** The quick list's time: "30 minutes or less". */
export const QUICK_MINUTES = 30;

export type Picked = { kind: "all" } | { kind: "made" } | { kind: "category"; key: string };

/** What the list shows: a category, the recipes made lately, or all of them. */
export function pickedList(filters: RecipeFilters): Picked {
  if (filters.category) return { kind: "category", key: filters.category };
  if (filters.made === "recent") return { kind: "made" };
  return { kind: "all" };
}

/** "Made lately" is the "made in the last 30 days" filter, picked like a list. */
const withoutMadeLately = (filters: RecipeFilters): RecipeFilters["made"] =>
  filters.made === "recent" ? "" : filters.made;

/** All recipes: no category and not only those made lately; the search and switches stay. */
export function pickAll(filters: RecipeFilters): RecipeFilters {
  return {
    ...filters,
    category: "",
    alsoIn: [],
    anyCategory: false,
    made: withoutMadeLately(filters),
  };
}

export function pickMadeLately(filters: RecipeFilters): RecipeFilters {
  return { ...pickAll(filters), made: "recent" };
}

export function pickCategory(filters: RecipeFilters, key: string): RecipeFilters {
  return {
    ...filters,
    category: key,
    alsoIn: filters.alsoIn.filter((k) => k !== key),
    made: withoutMadeLately(filters),
  };
}

export const favoritesOn = (filters: RecipeFilters) => filters.rating === "favorite";
export const quickOn = (filters: RecipeFilters) => filters.maxMinutes === QUICK_MINUTES;

export function toggleFavorites(filters: RecipeFilters): RecipeFilters {
  return { ...filters, rating: favoritesOn(filters) ? "" : "favorite" };
}

export function toggleQuick(filters: RecipeFilters): RecipeFilters {
  return { ...filters, maxMinutes: quickOn(filters) ? null : QUICK_MINUTES };
}

export interface LibraryCounts {
  /** Every recipe the search and switches leave, whatever is picked. */
  all: number;
  /** Those made in the last 30 days. */
  made: number;
  /** What the list would show with Favorites on (or shows, when it is on). */
  favorites: number;
  /** What the list would show with "30 minutes or less" on (or shows). */
  quick: number;
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
): LibraryCounts | null {
  const count = (f: RecipeFilters) => {
    const found = applyFilters(recipes, f, ingredients, today);
    if (found.pending) return null;
    return matching ? found.recipes.filter((r) => matching.has(r.id)) : found.recipes;
  };
  const base = count(pickAll(filters));
  // What clicking "Made lately" would show: More filters' own "made" choice gives way to it.
  const made = count(pickMadeLately(filters));
  const favorites = count({ ...filters, rating: "favorite" });
  const quick = count({ ...filters, maxMinutes: QUICK_MINUTES });
  if (!base || !made || !favorites || !quick) return null;

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
    all: base.length,
    made: made.length,
    favorites: favorites.length,
    quick: quick.length,
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

/** The list's title: the category's name, "Made lately", or "All recipes". */
export function listTitle(filters: RecipeFilters, nameOf: (key: string) => string): string {
  const picked = pickedList(filters);
  if (picked.kind === "made") return "Made lately";
  if (picked.kind === "category") {
    return picked.key === UNFILED ? "Not in a category" : nameOf(picked.key);
  }
  return "All recipes";
}

/**
 * What narrows the list beyond what is picked, in words, the switches first: "30 minutes or
 * less", "Without mushroom".
 */
export function narrowingLabels(filters: RecipeFilters, nameOf: (key: string) => string): string[] {
  const picked = pickedList(filters);
  const labels: string[] = [];
  if (favoritesOn(filters)) labels.push("Favorites");
  else if (filters.rating) labels.push(RATING_LABELS[filters.rating]);
  if (filters.maxMinutes !== null) {
    labels.push(
      quickOn(filters) ? "30 minutes or less" : `Up to ${minutesLabel(filters.maxMinutes)}`,
    );
  }
  for (const item of filterLabels(filters, nameOf)) {
    if (item.id === "time") continue;
    if (item.id === "made" && picked.kind === "made") continue;
    labels.push(item.label);
  }
  return labels;
}

const recipesText = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

/**
 * A sentence saying what the list shows ("6 recipes match “lemon” · 30 minutes or less"), or
 * null when nothing narrows it beyond what is picked (the heading's count says it then).
 */
export function shownSentence(
  shown: number,
  query: string,
  filters: RecipeFilters,
  nameOf: (key: string) => string,
): string | null {
  const words = query.trim();
  const labels = narrowingLabels(filters, nameOf);
  if (!words && labels.length === 0) return null;
  const start = words
    ? `${recipesText(shown)} ${shown === 1 ? "matches" : "match"} “${words}”`
    : recipesText(shown);
  return [start, ...labels].join(" · ");
}
