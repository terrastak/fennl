import {
  DRAFT_VERSION,
  type Confidence,
  type DraftFields,
  type DraftInput,
  type DraftPhoto,
  type Evidence,
  type RecipeDraft,
} from "./importDraft";
import { readIngredient, unitNamed } from "./ingredients";
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
  properties: { text: { type: "string" }, heading: { type: "boolean" }, confidence },
  required: ["text", "heading", "confidence"],
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
  const isLine = (l: unknown) => isText(l) && isObject(l) && typeof l.heading === "boolean";
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

/** An AI answer as recipe drafts, one per recipe it found. Empty: nothing was a recipe. */
export function answerToDrafts(answer: AiAnswer, context: AnswerContext): RecipeDraft[] {
  const newId = context.newId ?? (() => crypto.randomUUID());
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
      const ingredientLines = r.ingredients.filter((l) => clean(l.text));
      if (ingredientLines.length) {
        put(
          "ingredients",
          ingredientLines.map((l): IngredientLine => ({
            id: newId(),
            text: clean(l.text),
            heading: l.heading,
          })),
          lowest(ingredientLines.map((l) => l.confidence)),
        );
      }
      const directionLines = r.directions.filter((l) => clean(l.text));
      if (directionLines.length) {
        put(
          "directions",
          directionLines.map((l): DirectionStep => ({
            id: newId(),
            text: clean(l.text),
            heading: l.heading,
          })),
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
      if (s.name || s.author || s.page || s.url) {
        put(
          "source",
          { kind: s.kind, name: s.name, url: s.url, author: s.author, page: s.page },
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
  /** The model marked an important part, or a line, as unsure, or said something was unclear. */
  | "unsure"
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
const NO_AMOUNT_NEEDED =
  /\b(to taste|as needed|as desired|pinch|dash|for (serving|garnish|greasing|dusting|the pan|frying)|optional|some|a little|few)\b/i;

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

/** The fields a second look is about: what decides how the dish turns out, and its name. */
const KEY_FIELDS = ["title", "ingredients", "directions", "times", "servings"] as const;

/**
 * Why these drafts should be read again by a stronger model; empty when they look right. A
 * read that found nothing has no drafts, and always gets a second look.
 */
export function secondLookReasons(
  drafts: RecipeDraft[],
  rules: SecondLookRules = SECOND_LOOK_DEFAULTS,
): SecondLookReason[] {
  if (drafts.length === 0) return ["no_answer"];
  const reasons = new Set<SecondLookReason>();
  for (const draft of drafts) {
    const f = draft.fields;
    const ingredients = (f.ingredients?.value ?? []).filter((l) => !l.heading);
    const directions = (f.directions?.value ?? []).filter((l) => !l.heading);
    if (!f.title?.value.trim() || ingredients.length === 0 || directions.length === 0) {
      reasons.add("missing_part");
    }
    const unsure =
      KEY_FIELDS.some((key) => f[key]?.confidence === "low") ||
      draft.lineConfidence.ingredients?.includes("low") ||
      draft.lineConfidence.directions?.includes("low") ||
      draft.warnings.length > 0;
    if (unsure) reasons.add("unsure");

    let noAmount = 0;
    for (const line of ingredients) {
      const read = readIngredient(line.text);
      if (!read.quantity && !NO_AMOUNT_NEEDED.test(line.text)) noAmount += 1;
      const unit = read.unit ? unitNamed(read.unit) : undefined;
      const most = read.quantity ? Math.max(read.quantity.low, read.quantity.high ?? 0) : 0;
      if (rules.oddAmount > 0 && unit && HAND_MEASURES.has(unit.name) && most > rules.oddAmount) {
        reasons.add("odd_amount");
      }
    }
    if (rules.missingAmounts > 0 && noAmount >= rules.missingAmounts) {
      reasons.add("missing_amounts");
    }
  }
  return [...reasons];
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
  const warnings = [...published.warnings];
  let filled = false;
  for (const [field, name] of LISTS) {
    const theirs = read.fields[field];
    if (published.fields[field]?.value.length || !theirs?.value.length) continue;
    (fields as Record<string, unknown>)[field] = theirs;
    lineConfidence[field] = read.lineConfidence[field];
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
    warnings,
    producer: { ...published.producer, model: read.producer.model },
  };
}
