import { RECIPE_RULES } from "../../shared/recipe";

// Your signed note on a recipe grows a part at a time (owner's choice 2026-10-26): each part added
// with "+ Add a note" goes in as a new paragraph with the day in front of it, all in the one note
// kept with your stars and heart (recipe_opinion.note).

/** "Oct 26, 2026", the day in front of a part of a note. */
export const noteDay = (now: Date): string =>
  now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const GAP = "\n\n";

/** The note with `text` added as a new dated paragraph. */
export function addToNote(note: string, text: string, now: Date): string {
  const part = `${noteDay(now)}: ${text.trim()}`;
  return note.trim() ? `${note.trim()}${GAP}${part}` : part;
}

/** How many characters a new part can have before the note is full. */
export function roomInNote(note: string, now: Date): number {
  const taken = note.trim() ? note.trim().length + GAP.length : 0;
  return Math.max(0, RECIPE_RULES.notesLength - taken - `${noteDay(now)}: `.length);
}
