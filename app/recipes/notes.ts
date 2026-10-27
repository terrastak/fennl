import type { RecipeNote, RecipeSource } from "../../shared/recipe";
import { sourceCredit } from "../../shared/recipeText";

// Notes on a recipe (U7, owner's choices 2026-10-27): one Notes section. The recipe's own note
// comes first, labelled with where the recipe came from; then each note added in Fennl, oldest
// first, signed with its writer's name and the day it was written.

/** "Oct 26, 2026", the day a note was written. */
export const noteDay = (when: Date): string =>
  when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** How a note is dated: "Oct 26, 2026", and "· edited Oct 28" when changed on a later day. */
export function noteDate(note: Pick<RecipeNote, "writtenAt" | "editedAt">): string {
  const written = new Date(note.writtenAt);
  const day = noteDay(written);
  if (!note.editedAt) return day;
  const edited = new Date(note.editedAt);
  if (noteDay(edited) === day) return day;
  const sameYear = edited.getFullYear() === written.getFullYear();
  const editedDay = sameYear
    ? edited.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : noteDay(edited);
  return `${day} · edited ${editedDay}`;
}

/** Where the recipe's own note came from: "From Donna Hay", or "From the recipe". */
export function noteFrom(source: RecipeSource): string {
  if (source.kind === "person") {
    return source.name?.trim() ? `From ${source.name.trim()}` : "From the recipe";
  }
  const credit = sourceCredit(source);
  return credit ? `From ${credit.text}` : "From the recipe";
}

/** Whether a note being written has changed: only its words count, not spaces around them. */
export const noteChanged = (text: string, initial: string): boolean =>
  text.trim() !== initial.trim();
