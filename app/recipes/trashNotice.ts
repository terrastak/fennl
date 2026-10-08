import type { Done } from "../categories/useUndoable";

// "Moved “Pozole” to Trash. Undo" on the recipe list, after Move to Trash on a recipe's page
// (phase C9). The recipe page notes it here as it goes back to the list, which shows it once.

let last: Done | null = null;

export function noteTrashed(recipeId: string, title: string, changedAt: number): void {
  last = {
    message: `Moved “${title || "Untitled"}” to Trash.`,
    undo: [{ kind: "recipe", id: recipeId, fields: {}, deleted: false, changedAt }],
  };
}

/** What was just moved to Trash, if anything. */
export function recentlyTrashed(): Done | null {
  return last;
}

/** Shown: not again. */
export function forgetTrashed(): void {
  last = null;
}
