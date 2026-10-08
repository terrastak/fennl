import type { AddLimit, Usage } from "../../shared/limits";
import { formatBytes } from "../pages/plan";

// What the app says about plan limits (phase C11; rules in shared/limits.ts). Plain and kind:
// over a limit nothing is lost, only adding waits for room.

const recipes = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

/** "87 of 100 recipes", or "412 recipes" with no limit. */
export function recipesLine(usage: Usage): string {
  return usage.maxRecipes === null
    ? recipes(usage.recipes)
    : `${usage.recipes} of ${recipes(usage.maxRecipes)}`;
}

/** "1.2 MB of 3 MB of recipe text", or "1.2 MB of recipe text" with no limit. */
export function textLine(usage: Usage): string {
  const used = formatBytes(usage.textBytes);
  return usage.maxTextBytes === null
    ? `${used} of recipe text`
    : `${used} of ${formatBytes(usage.maxTextBytes)} of recipe text`;
}

/** Said wherever adding is blocked. */
export const NOTHING_LOST = "Everything you have stays yours to read, change and download.";

function countText(usage: Usage): string {
  const max = usage.maxRecipes ?? 0;
  return usage.recipes > max
    ? `You have ${recipes(usage.recipes)}, and your plan includes ${max}.`
    : `You have ${recipes(usage.recipes)}, as many as your plan includes.`;
}

/** Why a new recipe can't be added, and how to make room. */
export function addBlockedText(limit: AddLimit, usage: Usage): string {
  if (limit === "max_recipes") {
    return `${countText(usage)} To add another, move one you don’t need to Trash.`;
  }
  return `Your recipes hold ${formatBytes(usage.textBytes)} of text, and your plan includes ${formatBytes(
    usage.maxTextBytes ?? 0,
  )}. To add another, delete recipes you don’t need for good: move them to Trash, then empty it.`;
}

/** Why a recipe in Trash can't be put back yet. */
export function restoreBlockedText(usage: Usage): string {
  return `${countText(usage)} To put this one back, move another recipe to Trash first.`;
}

/** New recipes kept on this device because the server turned them away for a limit. */
export const HELD_TEXT =
  "A new recipe made on this device isn’t in your account yet, because your plan’s limit is reached. It’s kept here and saved as soon as there’s room.";

/** The editor's word for a recipe over the per-recipe cap. */
export const TOO_LARGE_TEXT =
  "This recipe is unusually large, so changes can’t be saved. Shorten it, or split it into two recipes.";
