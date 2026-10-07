/**
 * What a recipe is (phase C1). The plain-English description is docs/design/recipe-model.md;
 * this file is the same thing as types and validation rules, shared by the app and the Worker.
 *
 * Shape in short:
 * - A recipe is one record. Its ingredient and direction lists live inside it, and every line
 *   has its own ID, so links, cook mode and (later) line-by-line merging can refer to it.
 * - People edit ingredients and directions as one text box each; shared/recipeLines.ts turns the
 *   text into lines and back, keeping IDs stable across edits.
 * - What belongs to one person (rating, favorite, their signed note) is a RecipeOpinion, one per
 *   person per recipe. "Made it" dates are RecipeMade rows, shared by the household.
 * - Photos and categories are their own records, linked to the recipe (see the types below).
 *
 * Dates are ISO strings. IDs are UUIDs made by the client (CLAUDE.md, "Data model rules").
 */

/**
 * The version of this shape. The sync protocol carries it, so the server can refuse an app
 * that's too old (CLAUDE.md, "Data model rules"). Raise it when the shape changes.
 */
export const RECIPE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Ingredients and directions
// ---------------------------------------------------------------------------------------------

/**
 * How the ingredient reader (phase E2) understood a line. The text stays the master copy; this
 * is used only for scaling and converting, and is cleared whenever the text changes (it's read
 * again). E2 may add fields; it won't remove these.
 */
export interface ParsedIngredient {
  /** "1-2 cups": low 1, high 2. "a pinch": null. */
  quantity: { low: number; high: number | null } | null;
  /** As a standard unit name ("cup", "tablespoon", "gram"), or null ("2 eggs"). */
  unit: string | null;
  /** "flour". */
  item: string | null;
  /** "sifted", "(or more)". */
  note: string | null;
}

/** One line of the ingredient list. */
export interface IngredientLine {
  /** Stable across edits while the line is recognisably the same (shared/recipeLines.ts). */
  id: string;
  /** As written ("1 ½ cups (190 g) flour, sifted"), with pasted bullets cleaned off. */
  text: string;
  /** A section heading ("For the crust:") rather than an ingredient. */
  heading: boolean;
  /** The heading setting was chosen with the heading button, not worked out from the text. */
  headingByHand?: boolean;
  /** A linked sub-recipe ("1 cup BBQ sauce" → the BBQ sauce recipe). */
  linkedRecipeId?: string | null;
  /** Null until the ingredient reader has read it, and after the text changes. */
  parsed?: ParsedIngredient | null;
}

/** One step of the directions. Timers and the ingredients a step uses are worked out on display. */
export interface DirectionStep {
  id: string;
  text: string;
  heading: boolean;
  headingByHand?: boolean;
}

// ---------------------------------------------------------------------------------------------
// The other parts of a recipe
// ---------------------------------------------------------------------------------------------

/** A time as minutes (for sorting and "under 30 minutes"), plus words when that isn't enough. */
export interface RecipeTime {
  minutes: number | null;
  /** "plus overnight rest", or the original wording when it couldn't be read as minutes. */
  text: string | null;
}

export interface RecipeTimes {
  prep: RecipeTime;
  cook: RecipeTime;
  total: RecipeTime;
}

/** Kept apart: the number drives scaling, the words say what you get. */
export interface RecipeServings {
  /** 8. For "8-12", the low end. Null when there's no sensible number ("1/2 cup"). */
  count: number | null;
  /** "2 loaves", "about 24 cookies", or the original wording ("Serves 8 to 10"). */
  yield: string | null;
}

export const SOURCE_KINDS = ["website", "cookbook", "person", "other"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface RecipeSource {
  kind: SourceKind | null;
  /** Site name, cookbook title, or the person ("Aunt June", shown handwritten). */
  name: string | null;
  url: string | null;
  /** The cookbook's author, or the recipe's author on a website. */
  author: string | null;
  /** Cookbook page. */
  page: string | null;
}

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Per-serving nutrition: each value in a fixed unit. */
export const NUTRIENTS = {
  calories: "kcal",
  fat: "g",
  saturatedFat: "g",
  carbohydrates: "g",
  fiber: "g",
  sugar: "g",
  protein: "g",
  sodium: "mg",
  cholesterol: "mg",
} as const;
export type Nutrient = keyof typeof NUTRIENTS;

export const NUTRITION_SOURCES = ["manual", "paprika", "website", "ai"] as const;
export type NutritionSource = (typeof NUTRITION_SOURCES)[number];

export interface RecipeNutrition {
  /** Amounts per serving, in the unit NUTRIENTS gives. Missing means not known. */
  perServing: Partial<Record<Nutrient, number>>;
  /** The original wording (Paprika keeps nutrition as free text). Shown when it says more. */
  text: string | null;
  /** Where the values came from. */
  source: NutritionSource;
}

export const IMPORT_SOURCES = ["paprika", "website", "photo", "screenshot", "pdf"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** Where an imported recipe came from, so a re-import updates instead of duplicating. */
export interface RecipeImport {
  source: ImportSource;
  /** The import_job row (phase E1). */
  importJobId: string | null;
  /** The source's own ID: Paprika's uid, a page's address. */
  externalId: string | null;
  /** Paprika's hash, which changes when the recipe is edited there. */
  externalHash: string | null;
  importedAt: string;
}

// ---------------------------------------------------------------------------------------------
// The recipe record
// ---------------------------------------------------------------------------------------------

/**
 * What a person edits. Each field is one unit for "last change wins" (CLAUDE.md, "Data model
 * rules"): two devices changing different fields both keep their change; the same field, the
 * later change wins. Ingredients and directions are one unit each for now; every line has an ID
 * so line-by-line merging can come later without changing the data.
 */
export interface RecipeContent {
  title: string;
  /** The headnote ("Grandma's Sunday rolls, doubled for holidays"). */
  description: string;
  ingredients: IngredientLine[];
  directions: DirectionStep[];
  times: RecipeTimes;
  servings: RecipeServings;
  source: RecipeSource;
  /** Notes that came with the recipe. People's own notes are signed RecipeOpinion notes. */
  notes: string;
  difficulty: Difficulty | null;
  /** Free-text difficulty from an import that isn't easy/medium/hard. */
  difficultyText: string | null;
  nutrition: RecipeNutrition | null;
}

/** The fields "last change wins" applies to, one by one. */
export const RECIPE_FIELDS = [
  "title",
  "description",
  "ingredients",
  "directions",
  "times",
  "servings",
  "source",
  "notes",
  "difficulty",
  "difficultyText",
  "nutrition",
] as const satisfies readonly (keyof RecipeContent)[];
export type RecipeField = (typeof RECIPE_FIELDS)[number];

/** Columns every synced record has (CLAUDE.md, "Data model rules"). Set by the server. */
export interface SyncColumns {
  updatedAt: string;
  /** Set when deleted (Trash); never removed, so other devices learn about it. */
  deletedAt: string | null;
  /** Assigned by the server on every accepted change; clients pull "after N". */
  serverSeq: number;
}

export interface Recipe extends RecipeContent, SyncColumns {
  id: string;
  /** The person who created it. Never changes, even when a partner edits it. */
  ownerUserId: string;
  updatedByUserId: string;
  /** For an import, when it was first created in the original app (Paprika's "created"). */
  createdAt: string;
  /** A copy kept after a household split: the recipe it was copied from. */
  copiedFrom: string | null;
  import: RecipeImport | null;
}

/**
 * One person's opinion of a recipe. Stored per person, shown to the whole household when it has
 * something in it: "★★★★ Brian · ★★★ Sarah", "Brian's favorite", and signed notes.
 */
export interface RecipeOpinion extends SyncColumns {
  recipeId: string;
  userId: string;
  /** 1 to 5 stars, or null for not rated. */
  rating: number | null;
  favorite: boolean;
  /** Their own note, shown signed with their name under the recipe's notes. */
  note: string;
}

/** "Made it": from the end of cook mode or the button on the recipe page. Shared by the household. */
export interface RecipeMade extends SyncColumns {
  id: string;
  recipeId: string;
  /** Who made it: "Last made Oct 3 by Sarah". */
  userId: string;
  /** The day, in the person's own calendar ("2026-10-03"). */
  madeOn: string;
}

/**
 * A category, owned by one person and merged by name in the household view (CLAUDE.md, "Recipe
 * ownership in households"). Nested through parentId: "Desserts › Cakes". Diet labels are
 * categories under "Diet" ("Diet › Gluten-free"); imports add them automatically.
 */
export interface Category extends SyncColumns {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
}

/** The parent category diet labels go under. */
export const DIET_CATEGORY = "Diet";

/** Between levels of a category path, in what people see ("Desserts › Cakes"). */
export const CATEGORY_SEPARATOR = " › ";

export interface RecipeCategory extends SyncColumns {
  recipeId: string;
  /** Always one of the recipe owner's categories. */
  categoryId: string;
}

export const PHOTO_ROLES = ["cover", "photo", "import_original"] as const;
export type PhotoRole = (typeof PHOTO_ROLES)[number];

/** A photo on a recipe (the image itself is stored once, by content hash: phase D1). */
export interface RecipePhoto extends SyncColumns {
  id: string;
  recipeId: string;
  imageHash: string;
  /** One cover per recipe; import originals (card scans, pages) are kept but out of the gallery. */
  role: PhotoRole;
  sortOrder: number;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/**
 * Format rules: they stop broken or absurd data, not normal use. They are not plan limits; the
 * per-recipe size limit is the max_recipe_bytes plan limit, passed in by the caller (CLAUDE.md:
 * never hard-code plan limits).
 */
export const RECIPE_RULES = {
  titleLength: 200,
  descriptionLength: 5000,
  lineLength: 2000,
  linesPerList: 500,
  notesLength: 20000,
  shortTextLength: 500,
  urlLength: 2000,
  /** A month, in minutes. */
  maxMinutes: 60 * 24 * 31,
  maxServings: 10000,
  categoryNameLength: 100,
} as const;

export type RecipeProblem =
  "missing" | "too_long" | "too_many" | "invalid" | "duplicate_id" | "too_large";

export interface RecipeIssue {
  /** Where: "title", "ingredients.3.text", "times.prep.minutes". */
  path: string;
  problem: RecipeProblem;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Bytes a recipe's content takes, the way the text limits count it (UTF-8 JSON). */
export function recipeBytes(content: RecipeContent): number {
  return new TextEncoder().encode(JSON.stringify(content)).length;
}

type Check = (path: string, problem: RecipeProblem) => void;

function text(value: unknown, path: string, max: number, issue: Check, required = false) {
  if (typeof value !== "string") return issue(path, "invalid");
  if (required && !value.trim()) return issue(path, "missing");
  if (value.length > max) issue(path, "too_long");
}

function optionalText(value: unknown, path: string, max: number, issue: Check) {
  if (value !== null) text(value, path, max, issue);
}

function number(value: unknown, path: string, min: number, max: number, issue: Check) {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    issue(path, "invalid");
  }
}

function lines(value: unknown, path: string, issue: Check, isIngredients: boolean) {
  if (!Array.isArray(value)) return issue(path, "invalid");
  if (value.length > RECIPE_RULES.linesPerList) issue(path, "too_many");
  const seen = new Set<string>();
  value.forEach((line: unknown, i) => {
    const at = `${path}.${i}`;
    if (typeof line !== "object" || line === null) return issue(at, "invalid");
    const l = line as Record<string, unknown>;
    if (!isId(l.id)) issue(`${at}.id`, "invalid");
    else if (seen.has(l.id)) issue(`${at}.id`, "duplicate_id");
    else seen.add(l.id);
    text(l.text, `${at}.text`, RECIPE_RULES.lineLength, issue, true);
    if (typeof l.heading !== "boolean") issue(`${at}.heading`, "invalid");
    if (l.headingByHand !== undefined && typeof l.headingByHand !== "boolean") {
      issue(`${at}.headingByHand`, "invalid");
    }
    if (isIngredients) {
      if (l.linkedRecipeId != null && !isId(l.linkedRecipeId)) {
        issue(`${at}.linkedRecipeId`, "invalid");
      }
      if (l.parsed != null && typeof l.parsed !== "object") issue(`${at}.parsed`, "invalid");
    }
  });
}

function url(value: unknown, path: string, issue: Check) {
  if (value === null) return;
  if (typeof value !== "string" || value.length > RECIPE_RULES.urlLength) {
    return issue(path, "invalid");
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") issue(path, "invalid");
  } catch {
    issue(path, "invalid");
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Checks a recipe's content. `maxBytes` is the household's max_recipe_bytes limit (null: no
 * limit). Returns every problem found, so an editor can show them all at once.
 */
export function recipeIssues(input: unknown, maxBytes: number | null): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  const issue: Check = (path, problem) => {
    issues.push({ path, problem });
  };
  if (typeof input !== "object" || input === null) return [{ path: "", problem: "invalid" }];
  const r = input as Record<string, unknown>;

  text(r.title, "title", RECIPE_RULES.titleLength, issue, true);
  text(r.description, "description", RECIPE_RULES.descriptionLength, issue);
  lines(r.ingredients, "ingredients", issue, true);
  lines(r.directions, "directions", issue, false);
  text(r.notes, "notes", RECIPE_RULES.notesLength, issue);

  const times = r.times as Record<string, Record<string, unknown> | undefined> | undefined;
  if (typeof times !== "object" || times === null) issue("times", "invalid");
  else {
    for (const which of ["prep", "cook", "total"] as const) {
      const t = times[which];
      if (typeof t !== "object" || t === null) {
        issue(`times.${which}`, "invalid");
        continue;
      }
      number(t.minutes, `times.${which}.minutes`, 0, RECIPE_RULES.maxMinutes, issue);
      optionalText(t.text, `times.${which}.text`, RECIPE_RULES.shortTextLength, issue);
    }
  }

  const servings = r.servings as Record<string, unknown> | undefined;
  if (typeof servings !== "object" || servings === null) issue("servings", "invalid");
  else {
    number(servings.count, "servings.count", 0, RECIPE_RULES.maxServings, issue);
    if (servings.count === 0) issue("servings.count", "invalid");
    optionalText(servings.yield, "servings.yield", RECIPE_RULES.shortTextLength, issue);
  }

  const source = r.source as Record<string, unknown> | undefined;
  if (typeof source !== "object" || source === null) issue("source", "invalid");
  else {
    if (source.kind !== null && !oneOf(source.kind, SOURCE_KINDS)) issue("source.kind", "invalid");
    for (const key of ["name", "author", "page"] as const) {
      optionalText(source[key], `source.${key}`, RECIPE_RULES.shortTextLength, issue);
    }
    url(source.url, "source.url", issue);
  }

  if (r.difficulty !== null && !oneOf(r.difficulty, DIFFICULTIES)) issue("difficulty", "invalid");
  optionalText(r.difficultyText, "difficultyText", RECIPE_RULES.shortTextLength, issue);

  if (r.nutrition !== null) {
    const n = r.nutrition as Record<string, unknown> | undefined;
    if (typeof n !== "object" || n === null) issue("nutrition", "invalid");
    else {
      if (!oneOf(n.source, NUTRITION_SOURCES)) issue("nutrition.source", "invalid");
      optionalText(n.text, "nutrition.text", RECIPE_RULES.notesLength, issue);
      const values = n.perServing as Record<string, unknown> | undefined;
      if (typeof values !== "object" || values === null) issue("nutrition.perServing", "invalid");
      else {
        for (const [key, value] of Object.entries(values)) {
          if (!(key in NUTRIENTS)) issue(`nutrition.perServing.${key}`, "invalid");
          else number(value, `nutrition.perServing.${key}`, 0, 1e6, issue);
        }
      }
    }
  }

  if (
    issues.length === 0 &&
    maxBytes !== null &&
    recipeBytes(r as unknown as RecipeContent) > maxBytes
  ) {
    issue("", "too_large");
  }
  return issues;
}

/** A person's rating: whole stars from 1 to 5, or null. */
export function isRating(value: unknown): value is number | null {
  return (
    value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5)
  );
}

/** A category name: not empty, not too long, and without the path separator. */
export function isCategoryName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= RECIPE_RULES.categoryNameLength &&
    !value.includes("›")
  );
}

/** An empty recipe, for a new one. IDs for lines come from shared/recipeLines.ts. */
export function emptyRecipeContent(): RecipeContent {
  const noTime = (): RecipeTime => ({ minutes: null, text: null });
  return {
    title: "",
    description: "",
    ingredients: [],
    directions: [],
    times: { prep: noTime(), cook: noTime(), total: noTime() },
    servings: { count: null, yield: null },
    source: { kind: null, name: null, url: null, author: null, page: null },
    notes: "",
    difficulty: null,
    difficultyText: null,
    nutrition: null,
  };
}
