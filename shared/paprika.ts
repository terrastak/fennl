import {
  DRAFT_VERSION,
  type Confidence,
  type DraftFields,
  type DraftInput,
  type DraftValue,
  type RecipeDraft,
} from "./importDraft";
import {
  DIFFICULTIES,
  RECIPE_RULES,
  type Difficulty,
  type Nutrient,
  type RecipeNutrition,
  type RecipeSource,
  type RecipeTime,
} from "./recipe";
import { directionsFromText, ingredientsFromText } from "./recipeLines";
import { nutrientAmount, readDuration, readYield } from "./webText";

/**
 * One recipe from a Paprika 3 export (phase E13; the format is in
 * docs/research/2026-10-07-paprika-export.md): Paprika's JSON for a recipe, turned into a recipe
 * draft (shared/importDraft.ts) plus what isn't recipe content: the importing person's rating and
 * signed note (Paprika's notes), its categories, when it was made in Paprika, and its photos.
 *
 * Paprika's fields are plain text, read as written: nothing is fetched, nothing is guessed. The
 * file around it is read by shared/paprikaFile.ts.
 */

export const PAPRIKA_IMPORTER = "paprika";

/** A photo inside a Paprika recipe: base64 JPEG (or PNG), the cover first. */
export interface PaprikaPhoto {
  /** Paprika's file name for it. */
  name: string;
  /** Paprika's own hash of it, so importing again knows which photos were brought in. */
  hash: string;
  /** About how many bytes it is. */
  bytes: number;
  /** The photo, base64. Dropped from what the preview keeps (it's read again when importing). */
  data: string | null;
}

export interface PaprikaRecipe {
  uid: string;
  /** Paprika's hash, which changes when the recipe is edited there. */
  hash: string | null;
  /** The recipe itself. Paprika's notes aren't in it: they're the person's own (below). */
  draft: RecipeDraft;
  /** The importing person's stars (1 to 5), or null when Paprika has none. */
  rating: number | null;
  /** Paprika's notes: the importing person's signed note (spec.md E13). */
  note: string;
  /** Category paths; Paprika's are plain names, so one name each. */
  categories: string[][];
  /** When it was added to Paprika, as an ISO date (Paprika gives no time zone: read as UTC). */
  createdAt: string | null;
  photos: PaprikaPhoto[];
}

/** Why one recipe in a file couldn't be read, in words for the preview's list of problems. */
export type PaprikaProblem =
  "not_json" | "no_id" | "no_title" | "no_ingredients_or_directions" | "damaged";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Paprika's text: line ends made plain, invisible characters and trailing spaces gone. */
function plain(value: unknown): string {
  return str(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const oneLine = (value: unknown) => plain(value).replace(/\s*\n+\s*/g, " ");

/** "1:30" (hours and minutes, as some apps write it) or Paprika's words ("1 hr 15 min"). */
function readTime(value: unknown): RecipeTime | null {
  const text = oneLine(value);
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (clock) {
    const minutes = Number(clock[1]) * 60 + Number(clock[2]);
    return minutes > 0 ? { minutes, text: null } : null;
  }
  // "35 to 38 mins", "20-30 minutes": the low end, with the rest as words ("to 38 mins").
  const range = /^(\d+(?:[.,]\d+)?[¼½¾]?|[¼½¾])\s*(?:-|–|to)\s*(\d.*)$/i.exec(text);
  if (range?.[1] && range[2]) {
    const high = readDuration(range[2]);
    const unit = /^[\d.,¼½¾/ ]+\s*([a-z]+)/i.exec(range[2])?.[1] ?? "";
    const low = readDuration(`${range[1]} ${unit}`);
    if (high?.minutes && low?.minutes && /[a-z]/i.test(unit)) {
      return { minutes: low.minutes, text: `to ${range[2]}` };
    }
  }
  const time = readDuration(text);
  if (
    time?.minutes !== null &&
    time?.minutes !== undefined &&
    time.minutes > RECIPE_RULES.maxMinutes
  ) {
    return { minutes: null, text };
  }
  return time;
}

/** Paprika's difficulty: one of Fennl's three where it says one of them, else the words. */
function readDifficulty(value: unknown): { difficulty: Difficulty | null; text: string | null } {
  const text = oneLine(value);
  if (!text) return { difficulty: null, text: null };
  const lower = text.toLowerCase();
  if ((DIFFICULTIES as readonly string[]).includes(lower)) {
    return { difficulty: lower as Difficulty, text: null };
  }
  if (/^(?:intermediate|moderate|average)$/.test(lower))
    return { difficulty: "medium", text: null };
  if (/^(?:difficult|advanced|challenging)$/.test(lower)) return { difficulty: "hard", text: null };
  return { difficulty: null, text: text.slice(0, RECIPE_RULES.shortTextLength) };
}

/** The names Paprika's nutrition text uses (from sites it saved from), longest first. */
const NUTRITION_LABELS: [RegExp, Nutrient | null][] = [
  [/^(?:poly|mono)?unsaturated(?: fat)?$/, null],
  [/^trans(?: fat)?$/, null],
  [/^saturated(?: fat)?$/, "saturatedFat"],
  [/^(?:total )?fat$/, "fat"],
  [/^calories?(?: per serving)?$/, "calories"],
  [/^energy$/, "calories"],
  [/^(?:total )?carb(?:ohydrate)?s?$/, "carbohydrates"],
  [/^(?:dietary )?fib(?:er|re)$/, "fiber"],
  [/^(?:total )?sugars?$/, "sugar"],
  [/^protein$/, "protein"],
  [/^sodium$/, "sodium"],
  [/^cholesterol$/, "cholesterol"],
];

const LABEL_WORDS =
  "(?:(?:poly|mono)?unsaturated(?: fat)?|trans(?: fat)?|saturated(?: fat)?|(?:total )?fat|calories?(?: per serving)?|energy|(?:total )?carb(?:ohydrate)?s?|(?:dietary )?fib(?:er|re)|(?:total )?sugars?|protein|sodium|cholesterol|potassium|calcium|iron|vitamin [a-z]\\d?|serving(?: size)?)";

/**
 * Paprika keeps nutrition as free text, in whatever form the page it saved from had: "Fat: 15
 * grams" lines, "Calories 232 / Total Fat 11 g" lines, or "Calories: 467kcal | Carbohydrates:
 * 71g" in one line. Each nutrient Fennl knows is read where it's written plainly; the text is
 * always kept, so nothing is lost when a form isn't recognised.
 */
export function readPaprikaNutrition(value: unknown): RecipeNutrition | null {
  const text = plain(value);
  if (!text) return null;
  const collect = (
    pattern: RegExp,
    label: (m: RegExpMatchArray) => string,
    amount: (m: RegExpMatchArray) => string,
  ) => {
    const found: Partial<Record<Nutrient, number>> = {};
    for (const match of text.matchAll(pattern)) {
      const name = label(match).toLowerCase();
      const nutrient = NUTRITION_LABELS.find(([test]) => test.test(name))?.[1];
      if (!nutrient || nutrient in found) continue;
      const read = nutrientAmount(amount(match), nutrient);
      if (read !== null) found[nutrient] = read;
    }
    return found;
  };
  const unit = "(?:[ \\t]*(?:kcal|calories|calorie|cal|kj|milligrams?|mg|grams?|g|µg|mcg|iu)\\b)?";
  const paren = "(?:[ \\t]*\\((?:kcal|g|mg)\\))?";
  // "Fat: 15 grams" and "Calories 232" starting a line (or after "|", ";", ","), and
  // "Calories: 399kcal Protein: 10g" further along one, where the colon says it's a label.
  const labelFirst = collect(
    new RegExp(
      `(?:(?:^|[|;,(])[ \\t]*(${LABEL_WORDS})${paren}[ \\t]*:?|[ \\t](${LABEL_WORDS})${paren}[ \\t]*:)[ \\t]*(\\d[\\d,]*(?:\\.\\d+)?${unit})`,
      "gim",
    ),
    (m) => m[1] ?? m[2] ?? "",
    (m) => m[3] ?? "",
  );
  // Taste of Home's way round: "446 calories, 26g fat (13g saturated fat), 93mg cholesterol".
  const amountFirst = collect(
    /(\d[\d,]*(?:\.\d+)?)[ \t]*(kcal|mg|g|grams?|milligrams?)?[ \t]+(saturated fat|fat|calories|cholesterol|sodium|carbohydrates?|carbs|sugars?|fiber|fibre|protein)\b/gi,
    (m) => m[3] ?? "",
    (m) => `${m[1]} ${m[2] ?? ""}`,
  );
  // Whichever way the text is written reads more of it; the other fills in what it missed.
  const [more, less] =
    Object.keys(amountFirst).length > Object.keys(labelFirst).length
      ? [amountFirst, labelFirst]
      : [labelFirst, amountFirst];
  const perServing = { ...less, ...more };
  // "399 kcal" on a line of its own.
  if (!("calories" in perServing)) {
    const kcal = /^(\d[\d,]*(?:\.\d+)?)\s*kcal$/im.exec(text);
    if (kcal) perServing.calories = Number((kcal[1] ?? "").replace(/,/g, ""));
  }
  return {
    perServing,
    text: text.slice(0, RECIPE_RULES.notesLength),
    source: "paprika",
  };
}

/** Paprika's "2015-06-18 17:58:22", as an ISO date. */
function readCreated(value: unknown): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(str(value).trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Bytes a base64 string holds. */
const base64Bytes = (data: string) => Math.floor((data.replace(/=+$/, "").length * 3) / 4);

const isBase64 = (data: unknown): data is string =>
  typeof data === "string" && data.length > 0 && /^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 200));

/**
 * The recipe's photos, the cover first. `photo_data` is Paprika's small copy of the cover
 * (usually 280 px); when the full-size cover is among `photos` (named by `photo_large`), that one
 * is used instead. The other photos follow in Paprika's order.
 */
function readPhotos(r: Record<string, unknown>): PaprikaPhoto[] {
  const extra = (Array.isArray(r.photos) ? r.photos : [])
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .filter((p) => isBase64(p.data))
    .map((p, i) => ({
      name: str(p.filename) || str(p.name) || `photo-${i + 1}.jpg`,
      hash: str(p.hash) || `${str(r.uid)}:${i}`,
      order: Number.parseFloat(str(p.name)) || i + 1,
      data: p.data as string,
    }))
    .sort((a, b) => a.order - b.order);
  const large = str(r.photo_large);
  const coverAt = large ? extra.findIndex((p) => p.name === large) : -1;
  const photos: { name: string; hash: string; data: string }[] = [];
  if (coverAt >= 0) {
    const [cover] = extra.splice(coverAt, 1);
    if (cover) photos.push(cover);
  } else if (isBase64(r.photo_data)) {
    photos.push({
      name: str(r.photo) || "photo.jpg",
      hash: str(r.photo_hash) || `${str(r.uid)}:cover`,
      data: r.photo_data,
    });
  }
  photos.push(...extra);
  const seen = new Set<string>();
  return photos
    .filter((p) => !seen.has(p.hash) && seen.add(p.hash))
    .map((p) => ({
      name: p.name,
      hash: p.hash,
      bytes: base64Bytes(p.data.replace(/\s+/g, "")),
      data: p.data.replace(/\s+/g, ""),
    }));
}

/**
 * Reads one recipe of a Paprika export (its JSON, already unpacked). A recipe needs Paprika's id,
 * a title, and ingredients or directions; anything else missing is simply left empty.
 */
export function readPaprikaRecipe(
  json: unknown,
  entryName: string | null = null,
): PaprikaRecipe | { problem: PaprikaProblem } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { problem: "not_json" };
  }
  const r = json as Record<string, unknown>;
  const uid = oneLine(r.uid);
  if (!uid || uid.length > RECIPE_RULES.urlLength) return { problem: "no_id" };
  const title = oneLine(r.name).slice(0, RECIPE_RULES.titleLength);
  if (!title) return { problem: "no_title" };
  const ingredientsText = plain(r.ingredients);
  const directionsText = plain(r.directions);
  if (!ingredientsText && !directionsText) return { problem: "no_ingredients_or_directions" };

  const photos = readPhotos(r);
  const inputs: DraftInput[] = [
    { kind: "paprika", name: entryName ?? `${title}.paprikarecipe`, url: null, imageHash: null },
    ...photos.map((p): DraftInput => ({ kind: "image", name: p.name, url: null, imageHash: null })),
  ];
  const value = <T>(v: T, detail: string, confidence: Confidence = "high"): DraftValue<T> => ({
    value: v,
    confidence,
    from: [{ kind: "paprika", input: 0, detail }],
  });

  const fields: DraftFields = { title: value(title, "name") };
  const description = plain(r.description);
  if (description) fields.description = value(description, "description");
  const ingredients = ingredientsFromText(ingredientsText);
  if (ingredients.length) fields.ingredients = value(ingredients, "ingredients");
  const directions = directionsFromText(directionsText);
  if (directions.length) fields.directions = value(directions, "directions");

  const none: RecipeTime = { minutes: null, text: null };
  const prep = readTime(r.prep_time);
  const cook = readTime(r.cook_time);
  const total = readTime(r.total_time);
  if (prep || cook || total) {
    fields.times = value(
      { prep: prep ?? none, cook: cook ?? none, total: total ?? none },
      "prep_time, cook_time, total_time",
    );
  }
  const servingsText = oneLine(r.servings).slice(0, RECIPE_RULES.shortTextLength);
  const servings = readYield(servingsText);
  if (servings.count !== null || servings.yield !== null) {
    fields.servings = value(servings, "servings");
  }

  const sourceName = oneLine(r.source).slice(0, RECIPE_RULES.shortTextLength) || null;
  const rawUrl = oneLine(r.source_url);
  const sourceUrl =
    /^https?:\/\//i.test(rawUrl) && rawUrl.length <= RECIPE_RULES.urlLength ? rawUrl : null;
  if (sourceName || sourceUrl) {
    const source: RecipeSource = {
      kind: sourceUrl ? "website" : "other",
      name: sourceName,
      url: sourceUrl,
      author: null,
      page: null,
    };
    fields.source = value(source, "source, source_url");
  }

  const difficulty = readDifficulty(r.difficulty);
  if (difficulty.difficulty) fields.difficulty = value(difficulty.difficulty, "difficulty");
  if (difficulty.text) fields.difficultyText = value(difficulty.text, "difficulty");

  const nutrition = readPaprikaNutrition(r.nutritional_info);
  if (nutrition) fields.nutrition = value(nutrition, "nutritional_info");

  const rating = typeof r.rating === "number" ? r.rating : Number(r.rating);
  const categories = (Array.isArray(r.categories) ? r.categories : [])
    .map((name) => oneLine(name).slice(0, RECIPE_RULES.categoryNameLength))
    .filter(Boolean)
    .filter((name, i, all) => all.findIndex((n) => n.toLowerCase() === name.toLowerCase()) === i);

  const draft: RecipeDraft = {
    version: DRAFT_VERSION,
    source: "paprika",
    externalId: uid,
    externalHash: oneLine(r.hash) || null,
    inputs,
    fields,
    lineConfidence: {
      ingredients: ingredients.length ? ingredients.map(() => "high") : null,
      directions: directions.length ? directions.map(() => "high") : null,
    },
    categories: categories.length ? value(categories, "categories") : null,
    photos: photos.map((_, i) => ({ input: i + 1, role: "photo" })),
    warnings: [],
    producer: { importer: PAPRIKA_IMPORTER, model: null },
  };
  return {
    uid,
    hash: draft.externalHash,
    draft,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    note: plain(r.notes).slice(0, RECIPE_RULES.notesLength),
    categories: categories.map((name) => [name]),
    createdAt: readCreated(r.created),
    photos,
  };
}

/** The problem in words, for the preview. */
export function paprikaProblemText(problem: PaprikaProblem | "too_large" | "same_recipe"): string {
  switch (problem) {
    case "not_json":
    case "damaged":
      return "it's damaged and couldn't be read";
    case "no_id":
      return "it has no Paprika id";
    case "no_title":
      return "it has no title";
    case "no_ingredients_or_directions":
      return "it has no ingredients or directions";
    case "too_large":
      return "it's larger than a Paprika recipe can be";
    case "same_recipe":
      return "the same recipe is in the file twice; the first was read";
  }
}
