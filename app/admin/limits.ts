import { LIMIT_KEYS, type LimitKey } from "../../shared/entitlements";

/** How the console names each limit. Byte limits are shown and typed in MB. */
export const LIMIT_LABELS: Record<LimitKey, string> = {
  max_recipes: "Recipes",
  max_text_bytes: "Recipe text, in total",
  max_recipe_bytes: "Text per recipe",
  max_devices: "Devices at once",
  image_quota_bytes: "Photo storage",
  image_quota_count: "Number of photos",
  image_max_file_bytes: "Largest photo",
  image_uploads_per_minute: "Photo uploads per minute (each person)",
  image_uploads_per_day: "Photo uploads per day (household)",
  max_photos_per_recipe: "Photos per recipe",
};

export const LIMIT_ORDER: readonly LimitKey[] = LIMIT_KEYS;

const MB = 1024 * 1024;

export function isBytes(key: LimitKey): boolean {
  return key.endsWith("_bytes");
}

/** "No limit", "100", "3 MB". */
export function showLimit(key: LimitKey, value: number | null): string {
  if (value === null) return "No limit";
  if (!isBytes(key)) return String(value);
  const mb = value / MB;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(2)} MB`;
}

/** The text field's starting value: blank for "no limit". */
export function inputValue(key: LimitKey, value: number | null): string {
  if (value === null) return "";
  return isBytes(key) ? String(Math.round((value / MB) * 100) / 100) : String(value);
}

/** What was typed, as the API's value: null for blank, or undefined if it isn't a number. */
export function parseInput(key: LimitKey, text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return isBytes(key) ? Math.round(n * MB) : Number.isInteger(n) ? n : undefined;
}
