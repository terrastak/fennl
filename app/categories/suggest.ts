import type { IngredientLine } from "../../shared/recipe";
import { readIngredient } from "../../shared/ingredients";
import { underPath } from "./tree";

// Category suggestions in the recipe editor (phase C13c). A recipe is suggested the categories
// that the recipes most like it (by their ingredients) are already filed in. It all happens on
// this device from the person's own library, with no AI and no cost, and it only ever suggests:
// nothing is filed until the person taps. See `similarByIngredients` (app/sync/search.ts) for
// finding the likenesses, and `suggestCategories` here for turning them into suggestions.

/** Ingredient words that say little about a recipe: they are in nearly everything. */
const PLAIN = new Set([
  "salt",
  "pepper",
  "water",
  "oil",
  "olive",
  "kosher",
  "black",
  "white",
  "large",
  "small",
  "medium",
  "fresh",
  "dried",
  "ground",
  "chopped",
  "minced",
  "sliced",
  "diced",
  "whole",
  "taste",
  "plus",
  "more",
  "cold",
  "warm",
  "hot",
  "boiling",
  "optional",
  "divided",
  "extra",
  "virgin",
  "good",
  "quality",
  "into",
  "inch",
  "pieces",
  "piece",
  "cut",
  "and",
  "for",
  "the",
  "with",
  "from",
  "your",
  "any",
  "such",
  "about",
  "need",
  "needed",
]);

const MAX_KEYWORDS = 10;

/** A word as one root: "tomatoes" and "tomato", "berries" and "berry" meet at the start. */
function root(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("oes")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * The words that say what a recipe is made of, from its ingredient lines: the ingredient's name
 * (not the amount, unit or note), without the very common ones, as roots, the first few.
 */
export function ingredientKeywords(lines: Pick<IngredientLine, "text" | "heading">[]): string[] {
  const words: string[] = [];
  for (const line of lines) {
    if (line.heading) continue;
    const item = readIngredient(line.text).item ?? "";
    for (const raw of item
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase()
      .split(/[^\p{L}]+/u)) {
      if (raw.length < 3 || PLAIN.has(raw)) continue;
      const word = root(raw);
      if (word.length >= 3 && !words.includes(word)) words.push(word);
    }
  }
  return words.slice(0, MAX_KEYWORDS);
}

/** Fewest like recipes worth learning from, and how many suggestions to offer. */
export const MIN_LIKE = 3;
export const MAX_SUGGESTIONS = 3;
/** A category must be in at least this many like recipes, and this share of them. */
const MIN_VOTES = 2;
const MIN_SHARE = 0.3;

/**
 * The categories to suggest, from the categories of the recipes most like this one (most alike
 * first) and the ones it is already in. A category counts once for each like recipe in it;
 * it's suggested when enough of them agree. Not suggested: one the recipe is already in, or a
 * wider one that holds a category it is in ("Dinner" when it is in "Dinner › Soups").
 */
export function suggestCategories(like: string[][], own: string[]): string[] {
  if (like.length < MIN_LIKE) return [];
  const votes = new Map<string, { path: string; count: number }>();
  for (const paths of like) {
    for (const path of new Set(paths.map((p) => p.toLocaleLowerCase()))) {
      const shown = paths.find((p) => p.toLocaleLowerCase() === path) ?? path;
      const seen = votes.get(path);
      if (seen) seen.count++;
      else votes.set(path, { path: shown, count: 1 });
    }
  }
  return [...votes.values()]
    .filter(({ path, count }) => {
      if (count < MIN_VOTES || count / like.length < MIN_SHARE) return false;
      return !own.some((mine) => underPath(mine, path));
    })
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ path }) => path);
}
