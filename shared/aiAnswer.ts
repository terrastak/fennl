import {
  DRAFT_VERSION,
  draftIssues,
  type Confidence,
  type DraftFields,
  type DraftInput,
  type DraftPhoto,
  type Evidence,
  type RecipeDraft,
} from "./importDraft";
import {
  amountsWithin,
  readIngredient,
  standardIngredient,
  standardUnits,
  unitNamed,
} from "./ingredients";
import {
  SOURCE_KINDS,
  type DirectionStep,
  type ImportSource,
  type IngredientLine,
  type RecipeTime,
  type SourceKind,
} from "./recipe";

/**
 * What the AI answers when it reads a recipe (phase E7; CLAUDE.md, "AI import"), and how that
 * becomes a recipe draft (shared/importDraft.ts). The same for every model and vendor: the
 * provider layer (worker/ai/) asks for exactly this shape, and everything after it, from the
 * checks below to the review screen, only ever sees drafts.
 *
 * Also here, the checks that decide whether a read needs a second look by a stronger model
 * (decided by the owner 2026-10-12: the cheaper model first, the stronger one when the first is
 * unsure or its answer doesn't add up).
 */

/** How sure the AI is of a part, in the draft's own words. */
export interface AiText {
  text: string;
  confidence: Confidence;
}

export interface AiLine extends AiText {
  /** A section heading ("For the frosting") rather than an ingredient or a step. */
  heading: boolean;
  /**
   * Words or numbers in the text the AI couldn't read for certain, as written there (phase E10).
   * Missing from answers saved before E10.
   */
  unsure?: string[];
}

export interface AiTimes {
  prep: RecipeTime;
  cook: RecipeTime;
  total: RecipeTime;
  confidence: Confidence;
}

export interface AiServings {
  count: number | null;
  yield: string | null;
  confidence: Confidence;
}

export interface AiSource {
  kind: SourceKind | null;
  name: string | null;
  author: string | null;
  page: string | null;
  url: string | null;
  confidence: Confidence;
}

export interface AiRecipe {
  title: AiText;
  /** The headnote, the story before the recipe; empty when there is none. */
  description: AiText;
  ingredients: AiLine[];
  directions: AiLine[];
  /** Footnotes, tips and variations; empty when there are none. */
  notes: AiText;
  times: AiTimes;
  servings: AiServings;
  source: AiSource;
  /** What couldn't be read, in a few words each ("the oven temperature is smudged"). */
  unclear: string[];
}

export interface AiAnswer {
  /** Every recipe on the input, in order (a card can hold two). */
  recipes: AiRecipe[];
}

const confidence = { type: "string", enum: ["high", "medium", "low"] } as const;
const text = {
  type: "object",
  properties: { text: { type: "string" }, confidence },
  required: ["text", "confidence"],
  additionalProperties: false,
} as const;
const line = {
  type: "object",
  properties: {
    text: { type: "string" },
    heading: { type: "boolean" },
    confidence,
    unsure: { type: "array", items: { type: "string" } },
  },
  required: ["text", "heading", "confidence", "unsure"],
  additionalProperties: false,
} as const;
const nullable = (type: "string" | "integer" | "number") => ({
  anyOf: [{ type }, { type: "null" }],
});
const time = {
  type: "object",
  properties: { minutes: nullable("integer"), text: nullable("string") },
  required: ["minutes", "text"],
  additionalProperties: false,
} as const;

/** AiAnswer as a JSON schema, for the provider's structured output. */
export const AI_ANSWER_SCHEMA = {
  type: "object",
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: text,
          description: text,
          ingredients: { type: "array", items: line },
          directions: { type: "array", items: line },
          notes: text,
          times: {
            type: "object",
            properties: { prep: time, cook: time, total: time, confidence },
            required: ["prep", "cook", "total", "confidence"],
            additionalProperties: false,
          },
          servings: {
            type: "object",
            properties: { count: nullable("number"), yield: nullable("string"), confidence },
            required: ["count", "yield", "confidence"],
            additionalProperties: false,
          },
          source: {
            type: "object",
            properties: {
              kind: { anyOf: [{ type: "string", enum: [...SOURCE_KINDS] }, { type: "null" }] },
              name: nullable("string"),
              author: nullable("string"),
              page: nullable("string"),
              url: nullable("string"),
              confidence,
            },
            required: ["kind", "name", "author", "page", "url", "confidence"],
            additionalProperties: false,
          },
          unclear: { type: "array", items: { type: "string" } },
        },
        required: [
          "title",
          "description",
          "ingredients",
          "directions",
          "notes",
          "times",
          "servings",
          "source",
          "unclear",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["recipes"],
  additionalProperties: false,
} as const;

const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

/** The least sure of several. */
export function lowest(values: Confidence[]): Confidence {
  return values.reduce<Confidence>((a, b) => (RANK[b] < RANK[a] ? b : a), "high");
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Whether something is shaped like an AiAnswer (the provider's output is checked, not trusted). */
export function isAiAnswer(value: unknown): value is AiAnswer {
  if (!isObject(value) || !Array.isArray(value.recipes)) return false;
  const isConfidence = (c: unknown) => c === "high" || c === "medium" || c === "low";
  const isText = (t: unknown) =>
    isObject(t) && typeof t.text === "string" && isConfidence(t.confidence);
  const isLine = (l: unknown) =>
    isText(l) &&
    isObject(l) &&
    typeof l.heading === "boolean" &&
    (l.unsure === undefined ||
      (Array.isArray(l.unsure) && l.unsure.every((w: unknown) => typeof w === "string")));
  const isTime = (t: unknown) =>
    isObject(t) &&
    (t.minutes === null || Number.isInteger(t.minutes)) &&
    (t.text === null || typeof t.text === "string");
  const isStringOrNull = (v: unknown) => v === null || typeof v === "string";
  return value.recipes.every(
    (r: unknown) =>
      isObject(r) &&
      isText(r.title) &&
      isText(r.description) &&
      isText(r.notes) &&
      Array.isArray(r.ingredients) &&
      r.ingredients.every(isLine) &&
      Array.isArray(r.directions) &&
      r.directions.every(isLine) &&
      isObject(r.times) &&
      isTime(r.times.prep) &&
      isTime(r.times.cook) &&
      isTime(r.times.total) &&
      isConfidence(r.times.confidence) &&
      isObject(r.servings) &&
      (r.servings.count === null || typeof r.servings.count === "number") &&
      isStringOrNull(r.servings.yield) &&
      isConfidence(r.servings.confidence) &&
      isObject(r.source) &&
      (r.source.kind === null || (SOURCE_KINDS as readonly unknown[]).includes(r.source.kind)) &&
      isStringOrNull(r.source.name) &&
      isStringOrNull(r.source.author) &&
      isStringOrNull(r.source.page) &&
      isStringOrNull(r.source.url) &&
      isConfidence(r.source.confidence) &&
      Array.isArray(r.unclear) &&
      r.unclear.every((u: unknown) => typeof u === "string"),
  );
}

/** What the draft records about what it was read from and by. */
export interface AnswerContext {
  source: ImportSource;
  inputs: DraftInput[];
  /** Inputs to keep with the recipe (the card itself, as an import original). */
  photos: DraftPhoto[];
  /** The model, from configuration (never shown as a vendor's name). */
  model: string;
  newId?: () => string;
}

/** The importer's name in a draft's `producer`. */
export const AI_IMPORTER = "ai";

const AI_EVIDENCE: Evidence[] = [{ kind: "ai", input: null, detail: null }];

/**
 * A source address as a full web address: "instagram.com/june" (as a photo of a screen shows
 * it) gains "https://"; anything that isn't one ("@june", "Grandma's blog") is left out. An
 * address the draft can't keep would otherwise lose the whole recipe (found by the model
 * comparison, 2026-10-14).
 */
export function webAddress(text: string | null): string | null {
  const t = text?.trim();
  if (!t || /\s/.test(t)) return null;
  const candidate = /^https?:\/\//i.test(t)
    ? t
    : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t)
      ? `https://${t}`
      : null;
  if (!candidate || candidate.length > 2000) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A draft with any part that breaks the recipe rules left out, rather than losing the whole
 * recipe to one odd part. Null when it still breaks them (nothing usable left).
 */
export function withoutBadParts(
  draft: RecipeDraft,
  maxRecipeBytes: number | null,
): RecipeDraft | null {
  const issues = draftIssues(draft, maxRecipeBytes);
  if (issues.length === 0) return draft;
  const bad = new Set(
    issues.flatMap((i) => {
      const m = /^fields\.(\w+)/.exec(i.path);
      return m ? [m[1] as keyof DraftFields] : [];
    }),
  );
  if (bad.size === 0) return null;
  const fields = Object.fromEntries(
    Object.entries(draft.fields).filter(([key]) => !bad.has(key as keyof DraftFields)),
  ) as DraftFields;
  const lineConfidence = {
    ingredients: bad.has("ingredients") ? null : draft.lineConfidence.ingredients,
    directions: bad.has("directions") ? null : draft.lineConfidence.directions,
  };
  const repaired: RecipeDraft = { ...draft, fields, lineConfidence };
  return draftIssues(repaired, maxRecipeBytes).length === 0 ? repaired : null;
}

/** Unsure words kept for a line: at most this many, each this long at most. */
const UNSURE_WORDS = { perLine: 10, length: 60 };

/**
 * The words the AI wasn't sure of that really are in the line (it's asked to copy them exactly,
 * so one it reworded can't be highlighted and is left out), once each.
 */
export function wordsIn(text: string, words: string[]): string[] {
  const found = new Set<string>();
  for (const word of words) {
    const w = word.trim();
    if (w && w.length <= UNSURE_WORDS.length && text.includes(w)) found.add(w);
  }
  return [...found].slice(0, UNSURE_WORDS.perLine);
}

/**
 * Whether lines read from this kind of input get standard units ("1/2 teas" as "1/2 tsp") and
 * "baking soda" for "soda" (owner's choice 2026-10-21): what people wrote or typed themselves.
 * A web page keeps the wording its site published.
 */
const standardizes = (source: ImportSource) => source !== "website" && source !== "paprika";

/** An AI answer as recipe drafts, one per recipe it found. Empty: nothing was a recipe. */
export function answerToDrafts(answer: AiAnswer, context: AnswerContext): RecipeDraft[] {
  const newId = context.newId ?? (() => crypto.randomUUID());
  const standard = standardizes(context.source);
  return answer.recipes
    .filter((r) => r.title.text.trim() || r.ingredients.length || r.directions.length)
    .map((r): RecipeDraft => {
      const fields: DraftFields = {};
      const put = <K extends keyof DraftFields>(key: K, value: unknown, sure: Confidence) => {
        (fields as Record<string, unknown>)[key] = { value, confidence: sure, from: AI_EVIDENCE };
      };
      const clean = (s: string) => s.trim();
      if (clean(r.title.text)) put("title", clean(r.title.text), r.title.confidence);
      if (clean(r.description.text)) {
        put("description", clean(r.description.text), r.description.confidence);
      }
      const unsureWords: Record<string, string[]> = {};
      /** A line for the draft, noting the words in it the AI wasn't sure of. */
      const draftLine =
        (kind: "ingredient" | "step") =>
        (l: AiLine): IngredientLine & DirectionStep => {
          const tidy = (t: string) =>
            !standard || l.heading
              ? t
              : kind === "ingredient"
                ? standardIngredient(t)
                : standardUnits(t, "step");
          const line = { id: newId(), text: tidy(clean(l.text)), heading: l.heading };
          // An unsure "1/2 teas" is highlighted as the "1/2 tsp" it became, and "lbs" as "lb".
          const unsure = l.unsure ?? [];
          const unit = (w: string) => {
            const one = tidy(`1 ${w}`);
            return one.startsWith("1 ") ? one.slice(2) : w;
          };
          const words = wordsIn(line.text, [...unsure, ...unsure.map(tidy), ...unsure.map(unit)]);
          if (words.length) unsureWords[line.id] = words;
          return line;
        };
      const ingredientLines = r.ingredients.filter((l) => clean(l.text));
      if (ingredientLines.length) {
        put(
          "ingredients",
          ingredientLines.map(draftLine("ingredient")),
          lowest(ingredientLines.map((l) => l.confidence)),
        );
      }
      const directionLines = r.directions.filter((l) => clean(l.text));
      if (directionLines.length) {
        put(
          "directions",
          directionLines.map(draftLine("step")),
          lowest(directionLines.map((l) => l.confidence)),
        );
      }
      if (clean(r.notes.text)) put("notes", clean(r.notes.text), r.notes.confidence);
      const { prep, cook, total } = r.times;
      const hasTime = (t: RecipeTime) => t.minutes !== null || Boolean(t.text?.trim());
      if (hasTime(prep) || hasTime(cook) || hasTime(total)) {
        put("times", { prep, cook, total }, r.times.confidence);
      }
      if (r.servings.count !== null || r.servings.yield?.trim()) {
        put(
          "servings",
          { count: r.servings.count, yield: r.servings.yield },
          r.servings.confidence,
        );
      }
      const s = r.source;
      const url = webAddress(s.url);
      if (s.name || s.author || s.page || url) {
        put(
          "source",
          { kind: s.kind, name: s.name, url, author: s.author, page: s.page },
          s.confidence,
        );
      }
      return {
        version: DRAFT_VERSION,
        source: context.source,
        externalId: null,
        externalHash: null,
        inputs: context.inputs,
        fields,
        lineConfidence: {
          ingredients: ingredientLines.length ? ingredientLines.map((l) => l.confidence) : null,
          directions: directionLines.length ? directionLines.map((l) => l.confidence) : null,
        },
        ...(Object.keys(unsureWords).length ? { unsureWords } : {}),
        categories: null,
        photos: context.photos,
        warnings: r.unclear.map(clean).filter(Boolean),
        producer: { importer: AI_IMPORTER, model: context.model },
      };
    });
}

// ---------------------------------------------------------------------------------------------
// A second look
// ---------------------------------------------------------------------------------------------

/**
 * Why a read gets a second look by the next stronger model. The thresholds are settings the
 * admin console changes without a deploy (worker/ai/config.ts).
 */
export type SecondLookReason =
  /** No answer, an answer of the wrong shape, or one that isn't a valid recipe. */
  | "no_answer"
  /** No title, no ingredients, or no directions. */
  | "missing_part"
  /**
   * The model wasn't sure of an amount: a number or unit in a line ("1/3", "Tbs"), the times or
   * the servings. A word it wasn't sure of is only highlighted for the person (2026-10-21).
   */
  | "unsure_amount"
  /**
   * The amounts of an ingredient the method names don't add up to the list's ("1 C walnuts",
   * then "1/4 C walnuts" and "1/4 C walnuts"): one of them is likely misread.
   */
  | "amounts_differ"
  /** Several ingredient lines with no amount ("flour", where "2 cups flour" was likely). */
  | "missing_amounts"
  /** An amount no recipe uses ("35 cups"), usually a misread number. */
  | "odd_amount";

export interface SecondLookRules {
  /**
   * How many ingredient lines without an amount (other than "to taste", "a pinch" and the like)
   * make a read look wrong. 0 turns this check off.
   */
  missingAmounts: number;
  /** Cups, tablespoons and the like above this look misread. 0 turns this check off. */
  oddAmount: number;
}

export const SECOND_LOOK_DEFAULTS: SecondLookRules = { missingAmounts: 2, oddAmount: 24 };

/** Lines that rightly have no amount. */
const NO_AMOUNT_NEEDED = new RegExp(
  [
    String.raw`\b(to taste|as needed|as desired|pinch|dash|optional|some|a little|few)\b`,
    // "Butter, for the muffins", "Oil for frying".
    String.raw`(^|,|\s)for\s`,
    // Seasoning and frying oil, rarely measured: "Kosher salt", "salt and pepper", "Vegetable oil".
    String.raw`^\s*((kosher|sea|table|flaky|coarse|fine|freshly|ground|cracked|black|white)\s+)*(salt|pepper)\b`,
    String.raw`^\s*([\w-]+\s+)?oil\s*$`,
  ].join("|"),
  "i",
);

/** Units where a big number is a misreading (volumes people measure by hand). */
const HAND_MEASURES = new Set([
  "teaspoon",
  "tablespoon",
  "cup",
  "pint",
  "quart",
  "gallon",
  "liter",
]);

/** Amounts outside the lists, as a part: when the AI wasn't sure of them, a second look. */
const AMOUNT_FIELDS = ["times", "servings"] as const;

/** An unsure word that is an amount: it has a number ("1/3", "1lb"), or is a unit ("Tbs"). */
function isAmount(word: string): boolean {
  return /[\d¼-¾⅐-⅞]/u.test(word) || readIngredient(`1 ${word.trim()} x`).unit !== null;
}

/** Kinds of input the AI reads from a picture, where a number can be misread. */
const READ_FROM_PICTURES = new Set<string>(["photo", "screenshot", "pdf"]);

/** Words too common to tell ingredients apart ("2 cups of the flour"). */
const COMMON_WORDS = new Set(["the", "and", "for", "with", "into", "some", "more", "rest"]);

/** The words naming an ingredient, without plural endings: "walnut", "special", "cereal". */
const nameWords = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3 && !COMMON_WORDS.has(w))
    .map((w) => w.replace(/(?:es|s)$/, ""));

/**
 * Ingredients whose amounts in the method don't add up to the list's: more than the list
 * gives, or two or more amounts that add up to something else ("1 C walnuts": "1/4 C walnuts"
 * and "1/4 C walnuts", where the card says 1/4 and 3/4). One amount less than the list is
 * usual ("reserve the rest"), so it doesn't count.
 */
function amountsThatDiffer(
  ingredients: readonly IngredientLine[],
  directions: readonly DirectionStep[],
): string[] {
  const found: string[] = [];
  const reads = ingredients.map((line) => ({ line, read: readIngredient(line.text) }));
  // Words naming more than one ingredient ("sugar" in "1 cup sugar" and "2 Tbsp sugar",
  // "powder" in garlic and onion powder) can't tell which one the method means.
  const seen = new Map<string, number>();
  for (const { read } of reads) {
    for (const w of new Set(nameWords(read.item ?? ""))) seen.set(w, (seen.get(w) ?? 0) + 1);
  }
  for (const { line, read } of reads) {
    const unit = read.unit ? unitNamed(read.unit) : undefined;
    if (!read.quantity || !read.item || !unit?.base) continue;
    const names = new Set(nameWords(read.item).filter((w) => seen.get(w) === 1));
    if (names.size === 0) continue;
    const listed = read.quantity.high ?? read.quantity.low;
    let total = 0;
    let uses = 0;
    for (const step of directions) {
      for (const a of amountsWithin(step.text)) {
        const used = a.unit ? unitNamed(a.unit) : undefined;
        if (!used?.base || used.kind !== unit.kind) continue;
        // The words naming what's measured: up to the next comma or full stop ("1 cup (112 g)
        // cornstarch, 2½ tsp. garlic powder" is cornstarch), past a weight in brackets.
        const after = step.text.slice(a.end).replace(/^[\s)\]]*(?:\([^)]*\)\s*)?(?:of\s+)?/iu, "");
        const next = nameWords(after.split(/[,.;:()]|\s(?:and|or)\s/u)[0] ?? "").slice(0, 3);
        if (!next.some((w) => names.has(w))) continue;
        total += ((a.high ?? a.low) * used.base) / unit.base;
        uses += 1;
      }
    }
    const off = Math.abs(total - listed) > listed * 0.05;
    if (uses > 0 && (total > listed * 1.05 || (uses >= 2 && off))) found.push(line.text);
  }
  return found;
}

/** One thing that set off a second look, with what it was ("ingredient line: Salt"). */
export interface SecondLookFinding {
  reason: SecondLookReason;
  detail: string;
}

/**
 * Why a read's answer looks wrong enough for a second look, each with what set it off (for the
 * model comparison, which counts how often each catches a real mistake). Empty: it looks right.
 */
export function secondLookFindings(
  drafts: RecipeDraft[],
  rules: SecondLookRules = SECOND_LOOK_DEFAULTS,
): SecondLookFinding[] {
  if (drafts.length === 0) return [{ reason: "no_answer", detail: "no recipe" }];
  const found: SecondLookFinding[] = [];
  const add = (reason: SecondLookReason, detail: string) => found.push({ reason, detail });
  for (const draft of drafts) {
    const f = draft.fields;
    const ingredients = (f.ingredients?.value ?? []).filter((l) => !l.heading);
    const directions = (f.directions?.value ?? []).filter((l) => !l.heading);
    if (!f.title?.value.trim()) add("missing_part", "no title");
    if (ingredients.length === 0) add("missing_part", "no ingredients");
    if (directions.length === 0) add("missing_part", "no method");
    // Only amounts the AI wasn't sure of call for a second look: a wrong amount ruins a dish, and
    // an unsure word is highlighted for the person anyway. Marking whole lines unsure set off
    // second looks mostly on answers already right (comparison runs, 2026-10-21). Nor do the
    // AI's own notes ("the page gives no prep time"): in the model comparison (2026-10-19) they
    // set off 32 of 37 second looks, 24 on answers already right.
    for (const key of AMOUNT_FIELDS) {
      if (f[key]?.confidence === "low") add("unsure_amount", `${key} marked unsure`);
    }
    // Only a guess ("low"): an amount the AI was fairly sure of ("medium") was nearly always
    // right in the comparison runs (2026-10-21), but a guessed one was often wrong ("2 lbs
    // butter" for "2 Tbs", "1lb 0z" for "1lb 5oz").
    for (const list of ["ingredients", "directions"] as const) {
      (f[list]?.value ?? []).forEach((line, i) => {
        if (line.heading || draft.lineConfidence[list]?.[i] !== "low") return;
        const words = (draft.unsureWords?.[line.id] ?? []).filter(isAmount);
        if (words.length) add("unsure_amount", `${line.text} (${words.join(", ")})`);
      });
    }
    // Only where the AI reads a picture of the writing: text (a web page, pasted text) can't be
    // misread, and printed recipes often name amounts the list doesn't ("3/4 cup water" to
    // deglaze). Comparison runs, 2026-10-21.
    if (READ_FROM_PICTURES.has(draft.source)) {
      for (const text of amountsThatDiffer(ingredients, directions)) add("amounts_differ", text);
    }

    const noAmount: string[] = [];
    for (const line of ingredients) {
      const read = readIngredient(line.text);
      if (!read.quantity && !NO_AMOUNT_NEEDED.test(line.text)) noAmount.push(line.text);
      const unit = read.unit ? unitNamed(read.unit) : undefined;
      const most = read.quantity ? Math.max(read.quantity.low, read.quantity.high ?? 0) : 0;
      if (rules.oddAmount > 0 && unit && HAND_MEASURES.has(unit.name) && most > rules.oddAmount) {
        add("odd_amount", line.text);
      }
    }
    if (rules.missingAmounts > 0 && noAmount.length >= rules.missingAmounts) {
      add("missing_amounts", noAmount.join(" · "));
    }
  }
  return found;
}

/** Why a read gets a second look (the kinds of finding, once each). Empty: it looks right. */
export function secondLookReasons(
  drafts: RecipeDraft[],
  rules: SecondLookRules = SECOND_LOOK_DEFAULTS,
): SecondLookReason[] {
  return [...new Set(secondLookFindings(drafts, rules).map((f) => f.reason))];
}

/**
 * What the person should still check after the AI has read a recipe as carefully as it can
 * ("Read again" used, or no stronger model left): the parts it marked unsure, and what it said
 * it couldn't read. Empty: nothing left to point at.
 */
export function stillUncertain(draft: RecipeDraft): boolean {
  const f = draft.fields;
  return (
    (Object.values(f) as ({ confidence: Confidence } | undefined)[]).some(
      (v) => v?.confidence === "low",
    ) ||
    Boolean(draft.lineConfidence.ingredients?.includes("low")) ||
    Boolean(draft.lineConfidence.directions?.includes("low")) ||
    draft.warnings.length > 0
  );
}

// ---------------------------------------------------------------------------------------------
// Pages whose recipe data leaves something out (phase E8)
// ---------------------------------------------------------------------------------------------

const LISTS = [
  ["ingredients", "ingredients"],
  ["directions", "method"],
] as const;

/** A recipe's data on its page has no ingredients, or no method. */
export function missingLists(draft: RecipeDraft): boolean {
  return LISTS.some(([field]) => !draft.fields[field]?.value.length);
}

/**
 * A page's recipe data with the lists it left out filled in from the AI's reading of the page.
 * Everything the data does say is kept as it is (it's what the site published); only a missing
 * ingredient list or method is taken from the AI, with how sure it was of each line.
 */
export function fillMissingLists(published: RecipeDraft, read: RecipeDraft): RecipeDraft {
  const fields = { ...published.fields };
  const lineConfidence = { ...published.lineConfidence };
  const unsureWords = { ...published.unsureWords };
  const warnings = [...published.warnings];
  let filled = false;
  for (const [field, name] of LISTS) {
    const theirs = read.fields[field];
    if (published.fields[field]?.value.length || !theirs?.value.length) continue;
    (fields as Record<string, unknown>)[field] = theirs;
    lineConfidence[field] = read.lineConfidence[field];
    for (const line of theirs.value) {
      const words = read.unsureWords?.[line.id];
      if (words) unsureWords[line.id] = words;
    }
    const said = warnings.indexOf(`The page's recipe data has no ${field}.`);
    if (said >= 0) warnings.splice(said, 1);
    warnings.push(`The page's recipe data has no ${name}, so Fennl read it from the page itself.`);
    filled = true;
  }
  if (!filled) return published;
  return {
    ...published,
    fields,
    lineConfidence,
    ...(Object.keys(unsureWords).length ? { unsureWords } : {}),
    warnings,
    producer: { ...published.producer, model: read.producer.model },
  };
}
