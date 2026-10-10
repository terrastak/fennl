import {
  IMPORT_SOURCES,
  PHOTO_ROLES,
  emptyRecipeContent,
  recipeIssues,
  type ImportSource,
  type PhotoRole,
  type RecipeContent,
  type RecipeIssue,
} from "./recipe";

/**
 * The recipe draft (phase E1): what every importer produces, whatever it reads (a web page's
 * structured data, a photo of a card read by the AI, a Paprika file). Nothing is saved from a
 * draft without the person reviewing it (CLAUDE.md, "Import sources"), so each field says how
 * sure the importer is and where it came from, for the review screen (E4) to point at.
 *
 * The content is the recipe's own shape (shared/recipe.ts), so a reviewed draft becomes a recipe
 * without translation. Fields the importer found nothing for are left out.
 */

/** Raise when the shape changes; drafts are stored (import_job.draft) and must still be read. */
export const DRAFT_VERSION = 1;

export const CONFIDENCES = ["high", "medium", "low"] as const;
/**
 * How sure the importer is. "high": read directly (structured data, a Paprika field). "medium":
 * worked out (from page text, or the AI reading clear print). "low": a guess the person should
 * check (hard-to-read handwriting, a time inferred from the steps).
 */
export type Confidence = (typeof CONFIDENCES)[number];

export const EVIDENCE_KINDS = [
  /** Schema.org recipe data on a web page. */
  "structured_data",
  /** The page's visible text, without structured data. */
  "page_text",
  /** A field of a Paprika recipe. */
  "paprika",
  /** Read by the AI from an image, page or PDF. */
  "ai",
  /** Worked out by Fennl's own rules (the ingredient reader, a total time from prep + cook). */
  "derived",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Where a piece of a draft came from. */
export interface Evidence {
  kind: EvidenceKind;
  /** Which of the draft's inputs (an index into `inputs`), or null for all of them. */
  input: number | null;
  /** Where in it: "recipeIngredient[3]", "page 2", "back of the card". */
  detail: string | null;
}

/** One field's value, with how sure the importer is and where it came from. */
export interface DraftValue<T> {
  value: T;
  confidence: Confidence;
  from: Evidence[];
}

export const INPUT_KINDS = ["page", "image", "pdf", "paprika", "text"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** Something the importer read. Photos and pages are kept with the recipe (as import originals). */
export interface DraftInput {
  kind: InputKind;
  /** The file's name, as the person chose it. */
  name: string | null;
  /** A web page's address. */
  url: string | null;
  /** Once uploaded (an image or page kept with the recipe), its hash (phase D1). */
  imageHash: string | null;
}

/** A photo for the recipe: one of the inputs (a dish photo from the page, the card itself). */
export interface DraftPhoto {
  input: number;
  role: PhotoRole;
}

export type DraftFields = { [K in keyof RecipeContent]?: DraftValue<RecipeContent[K]> };

export interface RecipeDraft {
  version: typeof DRAFT_VERSION;
  source: ImportSource;
  /** The source's own ID (a page's address, Paprika's uid), so importing again updates. */
  externalId: string | null;
  /** Paprika's hash, which changes when the recipe is edited there. */
  externalHash: string | null;
  inputs: DraftInput[];
  fields: DraftFields;
  /** How sure the importer is of each ingredient and direction line, in the same order. */
  lineConfidence: { ingredients: Confidence[] | null; directions: Confidence[] | null };
  /** Category paths ("Desserts › Cakes"), from Paprika or the page's own labels. */
  categories: DraftValue<string[]> | null;
  photos: DraftPhoto[];
  /** What the person should know ("The back of the card was hard to read"). */
  warnings: string[];
  /**
   * What made it: the importer, and for the AI the model, from configuration (CLAUDE.md, "AI
   * import"). For the record and for comparing models (E7), never shown as a vendor's name.
   */
  producer: { importer: string; model: string | null };
}

/** The recipe as drafted, with empty values for the fields the importer didn't find. */
export function draftContent(draft: RecipeDraft): RecipeContent {
  const content = emptyRecipeContent();
  for (const key of Object.keys(draft.fields) as (keyof RecipeContent)[]) {
    const field = draft.fields[key];
    if (field) (content as Record<keyof RecipeContent, unknown>)[key] = field.value;
  }
  return content;
}

export interface DraftIssue {
  path: string;
  problem: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStringOrNull = (v: unknown) => v === null || typeof v === "string";

function evidenceIssues(path: string, value: unknown, inputs: number): DraftIssue[] {
  if (!Array.isArray(value)) return [{ path, problem: "invalid" }];
  return value.flatMap((e: unknown, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(e)) return [{ path: at, problem: "invalid" }];
    if (!(EVIDENCE_KINDS as readonly unknown[]).includes(e.kind)) {
      return [{ path: `${at}.kind`, problem: "invalid" }];
    }
    if (
      e.input !== null &&
      !(Number.isInteger(e.input) && (e.input as number) >= 0 && (e.input as number) < inputs)
    ) {
      return [{ path: `${at}.input`, problem: "invalid" }];
    }
    return isStringOrNull(e.detail) ? [] : [{ path: `${at}.detail`, problem: "invalid" }];
  });
}

function valueIssues(path: string, value: unknown, inputs: number): DraftIssue[] {
  if (!isObject(value) || !("value" in value)) return [{ path, problem: "invalid" }];
  if (!(CONFIDENCES as readonly unknown[]).includes(value.confidence)) {
    return [{ path: `${path}.confidence`, problem: "invalid" }];
  }
  return evidenceIssues(`${path}.from`, value.from, inputs);
}

/**
 * What's wrong with something that claims to be a draft: an importer's output, the AI's answer
 * (E7), or a stored draft. The content is checked with the recipe's own rules (recipeIssues),
 * against the per-recipe size cap when given. Empty: it's a valid draft.
 */
export function draftIssues(input: unknown, maxRecipeBytes: number | null = null): DraftIssue[] {
  if (!isObject(input)) return [{ path: "", problem: "invalid" }];
  const issues: DraftIssue[] = [];
  const d = input;
  if (d.version !== DRAFT_VERSION) issues.push({ path: "version", problem: "unsupported" });
  if (!(IMPORT_SOURCES as readonly unknown[]).includes(d.source)) {
    issues.push({ path: "source", problem: "invalid" });
  }
  if (!isStringOrNull(d.externalId)) issues.push({ path: "externalId", problem: "invalid" });
  if (!isStringOrNull(d.externalHash)) issues.push({ path: "externalHash", problem: "invalid" });
  const inputs = Array.isArray(d.inputs) ? d.inputs : null;
  if (!inputs) issues.push({ path: "inputs", problem: "invalid" });
  inputs?.forEach((x: unknown, i) => {
    const ok =
      isObject(x) &&
      (INPUT_KINDS as readonly unknown[]).includes(x.kind) &&
      isStringOrNull(x.name) &&
      isStringOrNull(x.url) &&
      isStringOrNull(x.imageHash);
    if (!ok) issues.push({ path: `inputs[${i}]`, problem: "invalid" });
  });
  const count = inputs?.length ?? 0;

  if (!isObject(d.fields)) {
    issues.push({ path: "fields", problem: "invalid" });
  } else {
    const known = new Set(Object.keys(emptyRecipeContent()));
    for (const [key, value] of Object.entries(d.fields)) {
      if (!known.has(key)) {
        issues.push({ path: `fields.${key}`, problem: "unknown" });
        continue;
      }
      issues.push(...valueIssues(`fields.${key}`, value, count));
    }
    if (issues.length === 0) {
      const content = draftContent(d as unknown as RecipeDraft);
      issues.push(
        ...recipeIssues(content, maxRecipeBytes).map((i: RecipeIssue) => ({
          path: `fields.${i.path}`,
          problem: i.problem,
        })),
      );
    }
  }

  const lines = d.lineConfidence;
  if (!isObject(lines)) {
    issues.push({ path: "lineConfidence", problem: "invalid" });
  } else {
    for (const key of ["ingredients", "directions"] as const) {
      const list = lines[key];
      const ok =
        list === null ||
        (Array.isArray(list) && list.every((c) => (CONFIDENCES as readonly unknown[]).includes(c)));
      if (!ok) issues.push({ path: `lineConfidence.${key}`, problem: "invalid" });
    }
  }

  if (d.categories !== null) {
    issues.push(...valueIssues("categories", d.categories, count));
    if (
      isObject(d.categories) &&
      !(
        Array.isArray(d.categories.value) &&
        d.categories.value.every((c: unknown) => typeof c === "string")
      )
    ) {
      issues.push({ path: "categories.value", problem: "invalid" });
    }
  }
  if (!Array.isArray(d.photos)) {
    issues.push({ path: "photos", problem: "invalid" });
  } else {
    d.photos.forEach((p: unknown, i) => {
      const ok =
        isObject(p) &&
        Number.isInteger(p.input) &&
        (p.input as number) >= 0 &&
        (p.input as number) < count &&
        (PHOTO_ROLES as readonly unknown[]).includes(p.role);
      if (!ok) issues.push({ path: `photos[${i}]`, problem: "invalid" });
    });
  }
  if (!Array.isArray(d.warnings) || !d.warnings.every((w) => typeof w === "string")) {
    issues.push({ path: "warnings", problem: "invalid" });
  }
  if (
    !isObject(d.producer) ||
    typeof d.producer.importer !== "string" ||
    !isStringOrNull(d.producer.model)
  ) {
    issues.push({ path: "producer", problem: "invalid" });
  }
  return issues;
}
