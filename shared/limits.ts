/**
 * Plan limits on recipes, as people meet them (phase C11; CLAUDE.md, "Tiers" and "Lapsed
 * subscriptions"). The numbers come from plan_limits and limit_override through the household's
 * entitlements, never from here.
 *
 * - Recipes: how many aren't in Trash.
 * - Recipe text: bytes of text in every recipe, Trash included (until deleted for good).
 * - Each recipe's text: a cap that normal recipes never come near.
 *
 * Over a limit, nothing is deleted or hidden, and everything stays editable: only adding is
 * blocked (a new recipe, putting one back from Trash, and later imports and photos) until usage
 * is back under. The server decides; the app shows the same rules so nobody types a recipe that
 * can't be kept.
 */

/** A household's usage and the limits that apply to it. Null limits: no limit. */
export interface Usage {
  /** Recipes not in Trash. */
  recipes: number;
  /** Bytes of recipe text, Trash included. */
  textBytes: number;
  maxRecipes: number | null;
  maxTextBytes: number | null;
  maxRecipeBytes: number | null;
}

/** The limits that can stop a recipe being added. */
export type AddLimit = "max_recipes" | "max_text_bytes";

/**
 * What stops adding a recipe right now, or null when there's room. `restoring`: putting one back
 * from Trash, which only adds to the count (its text already counts).
 */
export function addBlockedBy(usage: Usage, restoring = false): AddLimit | null {
  if (usage.maxRecipes !== null && usage.recipes >= usage.maxRecipes) return "max_recipes";
  if (!restoring && usage.maxTextBytes !== null && usage.textBytes >= usage.maxTextBytes) {
    return "max_text_bytes";
  }
  return null;
}

/** From this share of a limit, the usage bar shows next to "Add recipe". */
export const NEAR_SHARE = 0.8;

export type UsageLevel = "fine" | "near" | "full" | "over";

/** How close a count is to its limit. */
export function usageLevel(used: number, max: number | null): UsageLevel {
  if (max === null) return "fine";
  if (used > max) return "over";
  if (used >= max) return "full";
  if (used >= max * NEAR_SHARE) return "near";
  return "fine";
}

const ORDER: UsageLevel[] = ["fine", "near", "full", "over"];

/** The closer of the two limits. */
export function overallLevel(usage: Usage): UsageLevel {
  const a = usageLevel(usage.recipes, usage.maxRecipes);
  const b = usageLevel(usage.textBytes, usage.maxTextBytes);
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** Whether a recipe's text is over the per-recipe cap, without being an edit that shrinks it. */
export function tooLarge(bytes: number, before: number, maxRecipeBytes: number | null): boolean {
  return maxRecipeBytes !== null && bytes > maxRecipeBytes && bytes > before;
}
