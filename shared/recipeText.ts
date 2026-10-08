import type { RecipeServings, RecipeSource, RecipeTime } from "./recipe";

// How a recipe's details read in words, wherever they're shown: the app (app/recipes/format.ts)
// and the export's web pages (worker/export/).

/** 75 → "1 hr 15 min", 30 → "30 min", 120 → "2 hr". */
export function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** A time as it reads: minutes, with any words ("plus overnight"), or just the words. */
export function timeText(time: RecipeTime): string | null {
  if (time.minutes === null) return time.text?.trim() || null;
  const extra = time.text?.trim();
  return extra ? `${minutesText(time.minutes)} ${extra}` : minutesText(time.minutes);
}

/** "Serves 6", "2 loaves", or "Serves 8 · about 24 cookies". */
export function servingsText(servings: RecipeServings): string | null {
  const count = servings.count !== null ? `Serves ${servings.count}` : null;
  const made = servings.yield?.trim() || null;
  if (count && made) return made.toLowerCase().startsWith("serves") ? made : `${count} · ${made}`;
  return count ?? made;
}

/** A source worth showing as a line of its own (a person's name shows by the title instead). */
export function sourceLine(source: RecipeSource): string | null {
  if (source.kind === "person") return null;
  const parts = [
    source.name,
    source.author ? `by ${source.author}` : null,
    source.page ? `page ${source.page}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
