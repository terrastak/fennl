import type { RecipeMade, RecipeServings, RecipeSource, RecipeTime } from "../../shared/recipe";

// How recipe details read on screen (phase C5).

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

/** "2026-10-03" → "Oct 3" this year, "Oct 3, 2025" otherwise. */
export function dayText(day: string, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  const when = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  return when.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(when.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Today in the person's own calendar: "2026-10-07". */
export function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "★★★★☆" for 4. */
export function stars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
}

/** "June", "June and Sam", "June, Sam and Rose". */
export function namesText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The household's latest "made it" (records arrive newest first). */
export function lastMade(made: RecipeMade[]): RecipeMade | null {
  return made[0] ?? null;
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

/** The first name, for "Added by June" and signed notes. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
