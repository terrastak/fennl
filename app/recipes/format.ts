import { TRASH_DAYS, type RecipeMade } from "../../shared/recipe";

// How recipe details read on screen (phase C5). Those the export shares are in
// shared/recipeText.ts.

export { minutesText, servingsText, sourceLine, timeText } from "../../shared/recipeText";

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

/** The first name, for "Added by June" and signed notes. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** When a recipe in Trash goes for good (phase C9): "Deleted for good in 30 days". */
export function trashText(deletedAt: string, now = new Date()): string {
  const left = Date.parse(deletedAt) + TRASH_DAYS * 86_400_000 - now.getTime();
  const days = Math.ceil(left / 86_400_000);
  if (days <= 0) return "Deleted for good within the hour";
  return `Deleted for good in ${days} ${days === 1 ? "day" : "days"}`;
}
