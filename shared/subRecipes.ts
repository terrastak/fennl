import type { DirectionStep, IngredientLine, RecipeServings } from "./recipe";

// Linked sub-recipes (phase F3): "1 cup BBQ sauce" linked to the household's BBQ sauce recipe.
// A link is the `linkedRecipeId` on an ingredient line; the line's words are always kept, so a
// link that stops working (the recipe deleted, or no longer shared) only flags the line. Links
// can't go round in a circle (A uses B uses A), and expanding them in place stops a few deep.

/** How many levels of linked recipes expand in place; deeper ones are opened instead. */
export const MAX_LINK_DEPTH = 3;

/** A linked recipe as a recipe page shows it in place. */
export interface LinkedRecipe {
  id: string;
  title: string;
  /** Working, in Trash (it can be put back), or gone (deleted for good, or not shared now). */
  status: "ok" | "trash" | "gone";
  servings: RecipeServings | null;
  ingredients: IngredientLine[];
  directions: DirectionStep[];
}

/** The recipes a list of ingredients links to, in order, each once. */
export function linkedIds(lines: readonly IngredientLine[]): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    if (!line.heading && line.linkedRecipeId && !ids.includes(line.linkedRecipeId)) {
      ids.push(line.linkedRecipeId);
    }
  }
  return ids;
}

/** Every recipe reachable from `start` by links (not `start` itself unless a link leads back). */
export function reachable(
  start: string,
  linksOf: (id: string) => readonly string[],
  maxDepth = Number.POSITIVE_INFINITY,
): Set<string> {
  const seen = new Set<string>();
  let level = [start];
  for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
    const next: string[] = [];
    for (const id of level) {
      for (const linked of linksOf(id)) {
        if (seen.has(linked)) continue;
        seen.add(linked);
        next.push(linked);
      }
    }
    level = next;
  }
  return seen;
}

/**
 * Whether linking `recipeId`'s ingredient to `targetId` would go round in a circle: the target
 * is the recipe itself, or already uses it through its own links.
 */
export function wouldLoop(
  recipeId: string,
  targetId: string,
  linksOf: (id: string) => readonly string[],
): boolean {
  return targetId === recipeId || reachable(targetId, linksOf).has(recipeId);
}

export type LinkView =
  | { kind: "recipe"; recipe: LinkedRecipe }
  /** The recipe is already shown further up this page: open it instead of going round. */
  | { kind: "loop"; recipe: LinkedRecipe }
  /** Too many levels down to show here: open it instead. */
  | { kind: "deep"; recipe: LinkedRecipe }
  /** Not in this household's copy at all: deleted for good, or never shared. */
  | { kind: "gone" };

/**
 * What an ingredient's link shows at a place on the page: `path` is the recipes already open
 * above it, the page's own recipe first.
 */
export function linkView(
  targetId: string,
  path: readonly string[],
  find: (id: string) => LinkedRecipe | undefined,
): LinkView {
  const recipe = find(targetId);
  if (!recipe || recipe.status === "gone") return { kind: "gone" };
  if (path.includes(targetId)) return { kind: "loop", recipe };
  if (path.length > MAX_LINK_DEPTH) return { kind: "deep", recipe };
  return { kind: "recipe", recipe };
}
