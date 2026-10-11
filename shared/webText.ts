import { decodeHTML } from "entities";
import {
  NUTRIENTS,
  type Nutrient,
  type RecipeNutrition,
  type RecipeServings,
  type RecipeTime,
} from "./recipe";
import { timeFromText } from "./recipeText";

/**
 * Cleaning up what web pages publish as recipe data (phase E3): text with HTML left in it,
 * times as ISO 8601 durations or words, yields in every shape, nutrition with units. Used by the
 * structured data reader (shared/webRecipe.ts).
 */

/** Text garbled by being read as the wrong encoding ("Â°" for "°"), as recipe pages often are. */
const MOJIBAKE: [string, string][] = [
  ["â€™", "’"],
  ["â€˜", "‘"],
  ["â€œ", "“"],
  ["â€\u009d", "”"],
  ["â€“", "–"],
  ["â€”", "—"],
  ["â€¦", "…"],
  ["Â½", "½"],
  ["Â¼", "¼"],
  ["Â¾", "¾"],
  ["Â°", "°"],
  ["Â ", " "],
  ["Ã©", "é"],
  ["Ã¨", "è"],
  ["Ã±", "ñ"],
];

/** Spaces of every width become plain ones; invisible characters go. */
const ODD_SPACE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;

/**
 * Plain text from a value a page published: HTML entities decoded (twice over, for pages that
 * encode them twice), tags taken out (a line break where a paragraph or `<br>` was), garbled
 * characters fixed, and spaces tidied. Line breaks are kept; `oneLine` joins them.
 */
export function cleanText(value: unknown, oneLine = false): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  let text = value;
  for (let i = 0; i < 2 && /&(?:#\d+|#x[0-9a-f]+|[a-z]+\d*);/i.test(text); i++) {
    text = decodeHTML(text);
  }
  // Inside HTML, a line break in the source is just a space; tags say where lines end.
  if (/<(?:p|br|div|li)\b/i.test(text)) text = text.replace(/\s*\n\s*/g, " ");
  text = text
    .replace(/<sup>\s*(\d+)\s*<\/sup>\s*[⁄/]\s*<sub>\s*(\d+)\s*<\/sub>/gi, " $1/$2")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  for (const [bad, good] of MOJIBAKE) text = text.split(bad).join(good);
  text = text
    .replace(INVISIBLE, "")
    .replace(ODD_SPACE, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return oneLine ? text.replace(/\s*\n+\s*/g, " ") : text;
}

/** Words pages put after a recipe's name: " Recipe", " Recipe by Tasty", " | Site". */
export function cleanTitle(value: unknown, siteName: string | null): string {
  let title = cleanText(value, true);
  if (siteName) {
    const site = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    title = title.replace(new RegExp(`\\s*(?:[|–—-]|\\bby)\\s*${site}\\s*$`, "i"), "");
  }
  title = title.replace(/\s+recipe(?:\s+by\s+[\w&' ]{2,30})?$/i, "");
  return title.trim();
}

const ISO_DURATION =
  /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;

/**
 * A time as a page gives it: an ISO 8601 duration ("PT1H15M") or words ("1 hour 10 minutes",
 * "2 hours, plus 3 hours for chilling"). Null for nothing, or for zero ("PT0S"): a page that
 * says a recipe takes no cooking time means it has none to show.
 */
export function readDuration(value: unknown): RecipeTime | null {
  const text = cleanText(Array.isArray(value) ? value[0] : value, true);
  if (!text) return null;
  const iso = ISO_DURATION.exec(text.replace(/\s+/g, ""));
  if (iso) {
    const [, years, months, weeks, days, hours, minutes, seconds] = iso.map((v) => Number(v ?? 0));
    const total =
      ((years ?? 0) * 365 + (months ?? 0) * 30 + (weeks ?? 0) * 7 + (days ?? 0)) * 24 * 60 +
      (hours ?? 0) * 60 +
      (minutes ?? 0) +
      (seconds ?? 0) / 60;
    return total > 0 ? { minutes: Math.round(total), text: null } : null;
  }
  const time = timeFromText(text);
  if (time.minutes === 0 && !time.text) return null;
  return time;
}

/** Words that say a yield is a number of servings ("12 to 16 servings", "Serves 6 to 8"). */
const SERVINGS_WORDS = /\b(?:serves|servings?|people|persons?|portions?)(?![a-z])/i;

/**
 * How many a recipe makes, as pages publish it: a number ("6"), words ("Serves 6 to 8",
 * "2-1/2 dozen"), or both (`[12, "12 bars"]`). The count is a whole number of servings when the
 * page gives one; the words are kept unless they say no more than the count does.
 */
export function readYield(value: unknown): RecipeServings {
  const values = (Array.isArray(value) ? value : [value])
    .map((v) => cleanText(v, true))
    .filter(Boolean);
  if (values.length === 0) return { count: null, yield: null };
  const numeric = (v: string) => /^\d+(?:[.,]\d+)?$/.test(v);
  const bare = values.find(numeric);
  const words = values.find((v) => !numeric(v)) ?? null;
  let count: number | null = bare && /^\d+$/.test(bare) ? Number(bare) : null;
  if (count === null && words) {
    const start = /^(?:serves|servings|yield|yields|makes)?:?\s*(\d+)\b/i.exec(words);
    if (start?.[1] && (SERVINGS_WORDS.test(words) || /^\d+\s*(?:-|–|to|or)\s*\d+$/.test(words))) {
      count = Number(start[1]);
    }
  }
  if (count !== null && (count <= 0 || count > 10000)) count = null;
  let made = words ?? (count === null ? (bare ?? null) : null);
  if (
    made &&
    count !== null &&
    new RegExp(`^${count}\\s*(?:servings?|serving\\(s\\))?$`, "i").test(made)
  ) {
    made = null;
  }
  return { count, yield: made };
}

/** Schema.org's nutrition names, and Fennl's. */
const NUTRITION_NAMES: [string, Nutrient][] = [
  ["calories", "calories"],
  ["fatContent", "fat"],
  ["saturatedFatContent", "saturatedFat"],
  ["carbohydrateContent", "carbohydrates"],
  ["fiberContent", "fiber"],
  ["sugarContent", "sugar"],
  ["proteinContent", "protein"],
  ["sodiumContent", "sodium"],
  ["cholesterolContent", "cholesterol"],
];

/** "14.9 grams", "98mg sodium", "521.857", "1,200 kcal": the amount in the nutrient's own unit. */
function nutrientAmount(value: unknown, nutrient: Nutrient): number | null {
  const text = cleanText(value, true)
    .toLowerCase()
    .replace(/(\d),(\d{3})\b/g, "$1$2");
  const match = /(\d+(?:\.\d+)?)\s*(kcal|cal|calories|kj|mg|milligrams?|g|grams?|µg|mcg)?\b/.exec(
    text,
  );
  if (!match?.[1]) return null;
  let amount = Number(match[1]);
  const unit = match[2] ?? "";
  const wanted = NUTRIENTS[nutrient];
  if (unit === "kj") amount /= 4.184;
  else if (wanted === "mg" && /^(?:g|grams?)$/.test(unit)) amount *= 1000;
  else if (wanted === "g" && /^(?:mg|milligrams?)$/.test(unit)) amount /= 1000;
  else if (/^(?:µg|mcg)$/.test(unit)) amount /= wanted === "mg" ? 1000 : 1_000_000;
  return Number.isFinite(amount) ? Math.round(amount * 10) / 10 : null;
}

/** Per-serving nutrition from Schema.org NutritionInformation, or null when it gives none. */
export function readNutrition(value: unknown): RecipeNutrition | null {
  const info = Array.isArray(value) ? value[0] : value;
  if (typeof info !== "object" || info === null) return null;
  const fields = info as Record<string, unknown>;
  const perServing: Partial<Record<Nutrient, number>> = {};
  for (const [name, nutrient] of NUTRITION_NAMES) {
    const amount = nutrientAmount(fields[name], nutrient);
    if (amount !== null) perServing[nutrient] = amount;
  }
  if (Object.keys(perServing).length === 0) return null;
  const size = cleanText(fields.servingSize, true);
  return { perServing, text: size ? `Per serving: ${size}` : null, source: "website" };
}
