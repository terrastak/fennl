import { underPath } from "../categories/tree";
import type { RecipeSummary } from "../sync/dbProtocol";

// The recipe list's filters (phases C8, C13a), as plain data: what's chosen, how it is kept in
// the address, and which recipes it leaves. Every filter narrows (they all have to be true), and
// a recipe that doesn't say (no time written down, say) is left out of a filter on that, with the
// number counted so the list can say so plainly instead of guessing.

/** "Not filed in any category", as the category filter's value. */
export const UNFILED = "__unfiled";

export type RatingFilter = "" | "favorite" | "5" | "4" | "3" | "none";
export const RATING_VALUES: RatingFilter[] = ["", "favorite", "5", "4", "3", "none"];

/** Never made; made in the last 30 days; not made in the last 90 days (or never). */
export type MadeFilter = "" | "never" | "recent" | "old";
export const MADE_VALUES: MadeFilter[] = ["", "never", "recent", "old"];

export const TIME_CHOICES = [15, 30, 45, 60, 90, 120];
export const SERVING_CHOICES = [2, 4, 6, 8, 12];

const MAX_WORDS = 10;
const MAX_WORD_LENGTH = 40;
const MAX_CATEGORIES = 10;
const MAX_SOURCE_LENGTH = 80;

export interface RecipeFilters {
  /** The main category (a category's key, or UNFILED), or "" for any. */
  category: string;
  /** More categories, to be in as well (or instead, with `anyCategory`). Keys. */
  alsoIn: string[];
  /** Whether a recipe may be in any of `category` and `alsoIn`, rather than all of them. */
  anyCategory: boolean;
  /** Categories a recipe must not be in. Keys. */
  notIn: string[];
  rating: RatingFilter;
  /** Total time at most this many minutes. */
  maxMinutes: number | null;
  /** Serves at least this many. */
  minServings: number | null;
  photo: boolean;
  nutrition: boolean;
  made: MadeFilter;
  /** Part of the source's name ("Smitten Kitchen", "Aunt June"). */
  source: string;
  /** Words that must be in the ingredients, and words that must not be. */
  with: string[];
  without: string[];
}

export const NO_FILTERS: RecipeFilters = {
  category: "",
  alsoIn: [],
  anyCategory: false,
  notIn: [],
  rating: "",
  maxMinutes: null,
  minServings: null,
  photo: false,
  nutrition: false,
  made: "",
  source: "",
  with: [],
  without: [],
};

const unique = (values: string[], same: (a: string, b: string) => boolean = (a, b) => a === b) =>
  values.filter((value, i) => values.findIndex((other) => same(other, value)) === i);

const sameWord = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Words typed for the ingredient filters: trimmed, no repeats, not too many or too long. */
export function cleanWords(words: string[]): string[] {
  return unique(
    words.map((w) => w.replace(/\s+/g, " ").trim().slice(0, MAX_WORD_LENGTH)).filter(Boolean),
    sameWord,
  ).slice(0, MAX_WORDS);
}

function numberIn(value: string | null, choices: number[]): number | null {
  const n = Number(value);
  return value !== null && choices.includes(n) ? n : null;
}

/** The filters in an address's query string. Anything it doesn't understand is ignored. */
export function filtersFromParams(params: URLSearchParams): RecipeFilters {
  const keys = (name: string) =>
    unique(params.getAll(name).map((v) => v.toLocaleLowerCase())).slice(0, MAX_CATEGORIES);
  const rating = params.get("rating") as RatingFilter;
  const made = params.get("made") as MadeFilter;
  const category = (params.get("category") ?? "").toLocaleLowerCase();
  return {
    category,
    alsoIn: keys("also").filter((key) => key !== category),
    anyCategory: params.get("any") === "1",
    notIn: keys("notin"),
    rating: RATING_VALUES.includes(rating) ? rating : "",
    maxMinutes: numberIn(params.get("time"), TIME_CHOICES),
    minServings: numberIn(params.get("serves"), SERVING_CHOICES),
    photo: params.get("photo") === "1",
    nutrition: params.get("nutrition") === "1",
    made: MADE_VALUES.includes(made) ? made : "",
    source: (params.get("source") ?? "").trim().slice(0, MAX_SOURCE_LENGTH),
    with: cleanWords(params.getAll("with")),
    without: cleanWords(params.getAll("without")),
  };
}

/**
 * The query string for a search and its filters. `pathOf` gives a category's full name from its
 * key (the address says "Desserts › Cakes", as it did in C7), or nothing for one that is gone.
 */
export function filtersToParams(
  query: string,
  filters: RecipeFilters,
  pathOf: (key: string) => string | undefined,
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query);
  const named = (key: string) => (key === UNFILED ? UNFILED : pathOf(key));
  const category = filters.category ? named(filters.category) : undefined;
  if (category) params.set("category", category);
  for (const key of filters.alsoIn) {
    const path = pathOf(key);
    if (path) params.append("also", path);
  }
  if (filters.anyCategory && (category || filters.alsoIn.length > 0)) params.set("any", "1");
  for (const key of filters.notIn) {
    const path = pathOf(key);
    if (path) params.append("notin", path);
  }
  if (filters.rating) params.set("rating", filters.rating);
  if (filters.maxMinutes !== null) params.set("time", String(filters.maxMinutes));
  if (filters.minServings !== null) params.set("serves", String(filters.minServings));
  if (filters.photo) params.set("photo", "1");
  if (filters.nutrition) params.set("nutrition", "1");
  if (filters.made) params.set("made", filters.made);
  if (filters.source.trim()) params.set("source", filters.source.trim());
  for (const word of filters.with) params.append("with", word);
  for (const word of filters.without) params.append("without", word);
  return params;
}

/** The ingredient words the list needs answers for. */
export function ingredientWords(filters: RecipeFilters): string[] {
  return unique([...filters.with, ...filters.without]);
}

/** How many separate things are narrowing the list (not counting the words typed in search). */
export function activeFilterCount(filters: RecipeFilters): number {
  return [
    filters.category !== "",
    filters.alsoIn.length > 0,
    filters.notIn.length > 0,
    filters.rating !== "",
    filters.maxMinutes !== null,
    filters.minServings !== null,
    filters.photo,
    filters.nutrition,
    filters.made !== "",
    filters.source.trim() !== "",
    filters.with.length > 0,
    filters.without.length > 0,
  ].filter(Boolean).length;
}

/** The time a recipe takes: its total, else prep plus cook when both are written down. */
export function recipeMinutes(recipe: RecipeSummary): number | null {
  if (recipe.totalMinutes !== null) return recipe.totalMinutes;
  if (recipe.prepMinutes !== null && recipe.cookMinutes !== null) {
    return recipe.prepMinutes + recipe.cookMinutes;
  }
  return null;
}

/** A day written "2026-10-03", some days earlier or later. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type Answer = "yes" | "no" | "unknown";
const answer = (ok: boolean): Answer => (ok ? "yes" : "no");

/** Whether a recipe is in a category (or inside it), or in none, for UNFILED. */
function inCategory(recipe: RecipeSummary, key: string): boolean {
  if (key === UNFILED) return recipe.categories.length === 0;
  return recipe.categories.some((path) => underPath(path, key));
}

export interface FilterResult {
  /** The recipes left, in the order given. */
  recipes: RecipeSummary[];
  /** Recipes left out only because they don't say (no time, no number served). */
  unknown: { time: number; servings: number };
  /** The ingredient answers haven't arrived yet. */
  pending: boolean;
}

/**
 * The recipes that pass every filter. `ingredients` is the answer to `ingredientWords(filters)`
 * (which recipes have each word), or null while it hasn't arrived. `today` is the day to count
 * "made in the last 30 days" from.
 */
export function applyFilters(
  recipes: RecipeSummary[],
  filters: RecipeFilters,
  ingredients: Record<string, string[]> | null,
  today: string,
): FilterResult {
  const words = ingredientWords(filters);
  const pending = words.length > 0 && ingredients === null;
  if (pending) return { recipes: [], unknown: { time: 0, servings: 0 }, pending };

  const idSets = new Map<string, Set<string>>();
  for (const word of words) idSets.set(word, new Set(ingredients?.[word] ?? []));
  const positives = [filters.category, ...filters.alsoIn].filter(Boolean);
  const recent = addDays(today, -30);
  const old = addDays(today, -90);
  const source = filters.source.trim().toLocaleLowerCase();

  const result: FilterResult = { recipes: [], unknown: { time: 0, servings: 0 }, pending };
  for (const recipe of recipes) {
    const minutes = recipeMinutes(recipe);
    const answers: Record<string, Answer> = {
      categories:
        positives.length === 0
          ? "yes"
          : answer(
              filters.anyCategory
                ? positives.some((key) => inCategory(recipe, key))
                : positives.every((key) => inCategory(recipe, key)),
            ),
      notIn: answer(!filters.notIn.some((key) => inCategory(recipe, key))),
      rating:
        filters.rating === ""
          ? "yes"
          : filters.rating === "favorite"
            ? answer(recipe.favorite)
            : filters.rating === "none"
              ? answer(recipe.myRating === null)
              : answer((recipe.myRating ?? 0) >= Number(filters.rating)),
      time:
        filters.maxMinutes === null
          ? "yes"
          : minutes === null
            ? "unknown"
            : answer(minutes <= filters.maxMinutes),
      servings:
        filters.minServings === null
          ? "yes"
          : recipe.servings === null
            ? "unknown"
            : answer(recipe.servings >= filters.minServings),
      photo: answer(!filters.photo || recipe.cover !== null),
      nutrition: answer(!filters.nutrition || recipe.hasNutrition),
      made:
        filters.made === ""
          ? "yes"
          : filters.made === "never"
            ? answer(recipe.lastMadeOn === null)
            : filters.made === "recent"
              ? answer(recipe.lastMadeOn !== null && recipe.lastMadeOn >= recent)
              : answer(recipe.lastMadeOn === null || recipe.lastMadeOn < old),
      source: answer(
        source === "" || (recipe.sourceName ?? "").toLocaleLowerCase().includes(source),
      ),
      with: answer(filters.with.every((word) => idSets.get(word)?.has(recipe.id))),
      without: answer(!filters.without.some((word) => idSets.get(word)?.has(recipe.id))),
    };
    const failed = Object.entries(answers).filter(([, value]) => value !== "yes");
    if (failed.length === 0) result.recipes.push(recipe);
    // Left out only for not saying: counted under each filter it couldn't answer.
    else if (failed.every(([, value]) => value === "unknown")) {
      for (const [name] of failed) {
        if (name === "time") result.unknown.time++;
        else result.unknown.servings++;
      }
    }
  }
  return result;
}

/** One narrowing filter, as a label with a way to take it off (the chips under the toolbar). */
export interface FilterChip {
  id: string;
  label: string;
  remove: (filters: RecipeFilters) => RecipeFilters;
}

export const MADE_LABELS: Record<Exclude<MadeFilter, "">, string> = {
  never: "Never made",
  recent: "Made in the last 30 days",
  old: "Not made in the last 90 days",
};

export const minutesLabel = (minutes: number): string =>
  minutes % 60 === 0 && minutes >= 60
    ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`
    : `${minutes} minutes`;

/**
 * The filters beyond the category and rating (which have their own boxes in the toolbar), each
 * as a chip. `nameOf` gives a category's full name from its key.
 */
export function filterChips(filters: RecipeFilters, nameOf: (key: string) => string): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const key of filters.alsoIn) {
    chips.push({
      id: `also:${key}`,
      label: `${filters.anyCategory ? "Or in" : "Also in"} ${nameOf(key)}`,
      remove: (f) => ({ ...f, alsoIn: f.alsoIn.filter((k) => k !== key) }),
    });
  }
  for (const key of filters.notIn) {
    chips.push({
      id: `notin:${key}`,
      label: `Not in ${nameOf(key)}`,
      remove: (f) => ({ ...f, notIn: f.notIn.filter((k) => k !== key) }),
    });
  }
  if (filters.maxMinutes !== null) {
    chips.push({
      id: "time",
      label: `Up to ${minutesLabel(filters.maxMinutes)}`,
      remove: (f) => ({ ...f, maxMinutes: null }),
    });
  }
  if (filters.minServings !== null) {
    chips.push({
      id: "serves",
      label: `Serves ${filters.minServings} or more`,
      remove: (f) => ({ ...f, minServings: null }),
    });
  }
  if (filters.made) {
    chips.push({
      id: "made",
      label: MADE_LABELS[filters.made],
      remove: (f) => ({ ...f, made: "" }),
    });
  }
  if (filters.photo) {
    chips.push({ id: "photo", label: "Has a photo", remove: (f) => ({ ...f, photo: false }) });
  }
  if (filters.nutrition) {
    chips.push({
      id: "nutrition",
      label: "Has nutrition",
      remove: (f) => ({ ...f, nutrition: false }),
    });
  }
  if (filters.source.trim()) {
    chips.push({
      id: "source",
      label: `From ${filters.source.trim()}`,
      remove: (f) => ({ ...f, source: "" }),
    });
  }
  for (const word of filters.with) {
    chips.push({
      id: `with:${word.toLocaleLowerCase()}`,
      label: `With ${word}`,
      remove: (f) => ({ ...f, with: f.with.filter((w) => !sameWord(w, word)) }),
    });
  }
  for (const word of filters.without) {
    chips.push({
      id: `without:${word.toLocaleLowerCase()}`,
      label: `Without ${word}`,
      remove: (f) => ({ ...f, without: f.without.filter((w) => !sameWord(w, word)) }),
    });
  }
  return chips;
}
