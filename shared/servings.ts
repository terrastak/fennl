import { RECIPE_RULES, type RecipeServings } from "./recipe";
import { leadingCount, servingsFacts } from "./recipeText";

// "Serves or makes" (U27, owner's choice 2026-11-21): the editor's one box for how many a recipe
// serves or makes. The recipe still keeps the two apart (shared/recipe.ts RecipeServings): the
// count drives scaling, the words say what you get. This file goes between the box and the two:
//
// - "4" → serves 4 (count 4, no words).
// - "24 cookies", "Makes 2 loaves" → makes that many (the count, and the words as typed).
// - "Serves 8, makes about 24 pancakes" → count 8, words "about 24 pancakes".
// - "8 servings", "Serves 4", "Feeds 4" → serves 8, serves 4 (the words say no more).
// - "4-6", "4 to 6" → serves 4 to 6 (count 4, words "Serves 4-6"); "Serves 6 to 8" as typed.
// - Words the recipe page can't count from are kept with no count, so the page shows them whole
//   and scales the number inside them: "about 24 pancakes", "1 loaf", "1/2 cup", "12 -14 Slices".
//
// The box shows a recipe the same way back, and reading what it shows keeps its count and words:
// nothing stored is lost by opening a recipe and saving it (servings.test.ts tries every sample).

const NUMBER = String.raw`(\d+)`;

/** Words that only say how many it serves: "Serves 4", "8 servings", "Makes 6 servings". */
const SERVINGS_ONLY = new RegExp(
  [
    String.raw`(?:serves|feeds)\s*:?\s*${NUMBER}(?:\s+(?:people|persons))?`,
    String.raw`servings?\s*:?\s*${NUMBER}(?:\s+servings?)?`,
    String.raw`${NUMBER}\s+(?:servings?|serving\(s\)|portions?|people|persons)`,
    String.raw`(?:makes|yields?)\s*:?\s*${NUMBER}\s+(?:servings?|serving\(s\)|portions?)`,
  ]
    .map((words) => `^${words}\\.?$`)
    .join("|"),
  "iu",
);

/**
 * "Serves 8, makes about 24 pancakes", "serves 8; makes 24", "Serves 4 and makes 2 loaves". The
 * count may have a decimal point here, as an imported recipe's can ("Serves 1.5, makes 1.5 quarts").
 */
const SERVES_THEN_MAKES = new RegExp(
  String.raw`^serves\s*:?\s*(\d+(?:\.\d+)?)\s*(?:[,;·.–—-]|\band\b)?\s*(?:and\s+)?(?:it\s+)?(?:makes|yields?)\s*:?\s+(.+)$`,
  "iu",
);

/** "Makes 24 pancakes, serves 8", "24 pancakes (serves 8)". */
const MAKES_THEN_SERVES = new RegExp(
  String.raw`^(?:(?:makes|yields?)\s*:?\s+)?(.+?)\s*(?:[,;·–—]|\(|\band\b)\s*(?:it\s+)?serves\s*:?\s*${NUMBER}\s*\)?\.?$`,
  "iu",
);

/** A leading "Makes" or "Yields", which the box's "makes" already says. */
const MAKES_WORD = /^(?:makes|yields?)\s*:?\s*/iu;

/** A bare range, how many it serves: "4-6", "4 – 6", "4 to 6", "4 or 5". */
const RANGE = /^(\d+)\s*(?:-|–|—|to|or)\s*\d+$/iu;

/**
 * "24 cookies", "Makes 2 loaves", "2 (10-inch) crusts", "Makes 24": a count the recipe page can
 * show and scale with the words after it. Not "about 24 pancakes" or "1 loaf" (the page would
 * show just the number), nor words with another number in them ("12 -14 slices").
 */
const COUNTED = /^(\d+)(?:\s+([\p{L}(].*))?$/u;

const count = (digits: string | undefined): number | null => {
  const n = Number(digits);
  return Number.isSafeInteger(n) && n >= 1 && n <= RECIPE_RULES.maxServings ? n : null;
};

/** A count read before "makes": a whole number, or a decimal an imported recipe kept. */
const countBeforeMakes = (digits: string | undefined): number | null => {
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 && n <= RECIPE_RULES.maxServings ? n : null;
};

/** The count words like "24 cookies" give, or null (see COUNTED). */
function countedWords(words: string): number | null {
  const counted = COUNTED.exec(words.replace(MAKES_WORD, ""));
  if (!counted) return null;
  const n = count(counted[1]);
  const rest = (counted[2] ?? "").replace(/\([^)]*\)/gu, "");
  return n !== null && n >= 2 && !/\d/u.test(rest) ? n : null;
}

export { leadingCount };

/** The box as typed, as the recipe keeps it. */
export function parseServesOrMakes(typed: string): RecipeServings {
  const text = typed.trim().replace(/\s+/gu, " ");
  if (!text) return { count: null, yield: null };
  // A number on its own: how many it serves (rounded, as the old Serves box did; 0 stays 0 so
  // the editor can say it isn't a number it can use).
  if (/^\d+(?:\.\d+)?$/u.test(text)) return { count: Math.round(Number(text)), yield: null };
  // A range on its own: how many it serves, said so in the words the page shows.
  const range = RANGE.exec(text);
  if (range && count(range[1]) !== null) return { count: count(range[1]), yield: `Serves ${text}` };
  const servesOnly = SERVINGS_ONLY.exec(text);
  if (servesOnly) {
    const n = count(servesOnly.slice(1).find(Boolean));
    if (n !== null) return { count: n, yield: null };
  }
  const both = SERVES_THEN_MAKES.exec(text);
  const before = countBeforeMakes(both?.[1]);
  if (both?.[2] && before !== null) return { count: before, yield: both[2] };
  const after = MAKES_THEN_SERVES.exec(text);
  if (after?.[1] && count(after[2]) !== null && !/^serves\b/iu.test(after[1])) {
    return { count: count(after[2]), yield: after[1] };
  }
  // "Serves 6 to 8", "Servings: 4-6": how many it serves, counted from the first number.
  if (/^(?:serves|servings?|feeds)\b/iu.test(text))
    return { count: leadingCount(text), yield: text };
  return { count: countedWords(text), yield: text };
}

/** Words about how many it serves: "Serves 4", "Serves 8 to 10", "6 servings", "4-6". */
export function wordsSayServes(words: string): boolean {
  const text = words.trim();
  return (
    SERVINGS_ONLY.test(text) || /^(?:serves|servings?|feeds)\b/iu.test(text) || RANGE.test(text)
  );
}

/** The box, showing what the recipe keeps. */
export function formatServesOrMakes(servings: RecipeServings): string {
  const made = servings.yield?.trim() || null;
  if (servings.count === null) return made ?? "";
  if (!made) return String(servings.count);
  // The words give the count as the box reads them ("24 cookies" for 24, "Serves 4" for 4).
  const read = parseServesOrMakes(made);
  if (read.count === servings.count) return made;
  // Words that only say how many it serves, with another number than the count (the old editor
  // let the two be changed apart): the count is what the recipe page shows and scales by.
  if (wordsSayServes(made)) return String(servings.count);
  return `Serves ${servings.count}, makes ${made.replace(MAKES_WORD, "") || made}`;
}

/** Words that start a sentence with a capital only: "One 9-inch pie" reads "Makes one 9-inch pie". */
const PLAIN_START =
  /^(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|About|Approximately|Approx\.?|Around|Roughly|Nearly|Almost|Up|At|A|An|Enough|Several|Plenty)\b/u;

/** How Fennl reads it, as the recipe page will say it: "Serves 4", "Makes 24 cookies". */
export function servesOrMakesReading(servings: RecipeServings): string {
  return servingsFacts(servings)
    .map((fact, i) => {
      const value = PLAIN_START.test(fact.value)
        ? `${fact.value[0]?.toLowerCase() ?? ""}${fact.value.slice(1)}`
        : fact.value;
      return `${i === 0 ? fact.label : fact.label.toLowerCase()} ${value}`;
    })
    .join(", ");
}
