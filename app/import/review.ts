import { CATEGORY_SEPARATOR, RECIPE_FIELDS, emptyRecipeContent } from "../../shared/recipe";
import type {
  DirectionStep,
  IngredientLine,
  RecipeContent,
  RecipeField,
  RecipeImport,
} from "../../shared/recipe";
import type { Confidence, RecipeDraft } from "../../shared/importDraft";
import type { ImportJobDetail } from "../../shared/importJobs";
import { directionsFromText, ingredientsFromText, textFromLines } from "../../shared/recipeLines";
import type { RecipeChange } from "../../shared/sync";
import { tidyText } from "../../shared/tidy";
import { timeText } from "../recipes/format";

/**
 * The import review screen's rules (phase E4), apart from the screen so they can be tested:
 * what to point out, what "Update the existing recipe" would change, and the changes that save
 * a reviewed draft.
 */

/** Field names as the review screen says them. */
export const FIELD_NAMES: Record<RecipeField, string> = {
  title: "Title",
  description: "About this recipe",
  ingredients: "Ingredients",
  directions: "Method",
  times: "Times",
  servings: "Servings",
  source: "Where it's from",
  notes: "Notes",
  difficulty: "Difficulty",
  difficultyText: "Difficulty",
  nutrition: "Nutrition",
};

const CHECK: Record<Exclude<Confidence, "high">, string> = {
  medium: "Worth a look",
  low: "Check this",
};

/** The fields the importer wasn't sure of, to check first, with how unsure it was. */
export function fieldsToCheck(draft: RecipeDraft): { field: RecipeField; note: string }[] {
  const found: { field: RecipeField; note: string }[] = [];
  for (const field of RECIPE_FIELDS) {
    const value = draft.fields[field];
    if (field === "difficultyText" || !value || value.confidence === "high") continue;
    found.push({ field, note: CHECK[value.confidence] });
  }
  return found;
}

/**
 * Lines the importer wasn't sure of (a section heading found on the page, a line it read less
 * well), by line ID, so the mark stays on the line while the person edits around it.
 */
export function lineMarks(draft: RecipeDraft, content: RecipeContent): Map<string, string> {
  const marks = new Map<string, string>();
  for (const list of ["ingredients", "directions"] as const) {
    const confidence = draft.lineConfidence[list];
    content[list].forEach((line, i) => {
      const c = confidence?.[i];
      if (c && c !== "high") marks.set(line.id, CHECK[c]);
    });
  }
  return marks;
}

/** The draft's lists with fractions and temperatures tidied (shared/tidy.ts), as box text. */
export function tidiedBoxes(content: RecipeContent): { ingredients: string; directions: string } {
  const tidy = (lines: (IngredientLine | DirectionStep)[]) =>
    textFromLines(lines.map((line) => ({ ...line, text: tidyText(line.text) })));
  return { ingredients: tidy(content.ingredients), directions: tidy(content.directions) };
}

/**
 * The line the cursor is on, moved to the end of the other list ("Move to method"). Null when
 * there's no such line.
 */
export function moveLineTo(
  content: RecipeContent,
  from: "ingredients" | "directions",
  index: number,
): { ingredients: string; directions: string } | null {
  const line = content[from][index];
  if (!line) return null;
  const to = from === "ingredients" ? "directions" : "ingredients";
  const kept = content[from].filter((_, i) => i !== index);
  const moved = [...content[to], { ...line, id: crypto.randomUUID() }];
  const boxes = { [from]: textFromLines(kept), [to]: textFromLines(moved) } as {
    ingredients: string;
    directions: string;
  };
  return boxes;
}

/** Whether a value says nothing (an import with no notes mustn't wipe the recipe's notes). */
function isEmpty(value: unknown): boolean {
  if (value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isEmpty);
  return false;
}

/** A field's value for comparing: lists by what they say, not by their lines' IDs. */
function comparable(content: RecipeContent, field: RecipeField): string {
  const value = content[field];
  if (field === "ingredients" || field === "directions") {
    return JSON.stringify(
      (value as (IngredientLine | DirectionStep)[]).map((l) => [l.text, l.heading]),
    );
  }
  return JSON.stringify(value);
}

export interface FieldUpdate {
  field: RecipeField;
  name: string;
  /** In words, short: the value now and the import's. */
  before: string;
  after: string;
}

/** A field's value in a few words, for the list of what an update changes. */
function describe(content: RecipeContent, field: RecipeField): string {
  switch (field) {
    case "ingredients":
    case "directions": {
      const lines = content[field].filter((l) => !l.heading);
      if (lines.length === 0) return "None";
      const noun = field === "ingredients" ? "ingredient" : "step";
      return `${lines.length} ${noun}${lines.length === 1 ? "" : "s"}`;
    }
    case "times": {
      const parts = (["prep", "cook", "total"] as const)
        .map((k) => {
          const t = timeText(content.times[k]);
          return t ? `${k} ${t}` : null;
        })
        .filter(Boolean);
      return parts.length ? parts.join(", ") : "None";
    }
    case "servings": {
      const { count, yield: made } = content.servings;
      return [count === null ? null : `serves ${count}`, made].filter(Boolean).join(", ") || "None";
    }
    case "source": {
      const s = content.source;
      return [s.name, s.author, s.url].filter(Boolean).join(", ") || "None";
    }
    case "nutrition":
      return content.nutrition ? "Per serving" : "None";
    default: {
      const text = String(content[field] ?? "").trim();
      if (!text) return "None";
      return text.length > 80 ? `${text.slice(0, 79)}…` : text;
    }
  }
}

/** For a list: how many of the import's lines the recipe doesn't have word for word. */
function linesChanged(
  existing: RecipeContent,
  imported: RecipeContent,
  field: RecipeField,
): string {
  if (field !== "ingredients" && field !== "directions") return "";
  const had = new Set(existing[field].map((line) => line.text.trim()));
  const fresh = imported[field].filter((line) => !had.has(line.text.trim())).length;
  return fresh === 0 ? " (reordered)" : ` (${fresh} new or changed)`;
}

/**
 * What "Update the existing recipe" changes: every field the import has something for that
 * differs from the recipe as it is. Fields the import has nothing for are left as they are.
 */
export function fieldUpdates(existing: RecipeContent, imported: RecipeContent): FieldUpdate[] {
  return RECIPE_FIELDS.filter(
    (field) =>
      !isEmpty(imported[field]) && comparable(existing, field) !== comparable(imported, field),
  )
    .filter((field) => field !== "difficultyText" || imported.difficulty === null)
    .map((field) => ({
      field,
      name: FIELD_NAMES[field],
      before: describe(existing, field),
      after: describe(imported, field) + linesChanged(existing, imported, field),
    }));
}

/** The change that updates an existing recipe with the import's fields. */
export function updateChange(
  recipeId: string,
  existing: RecipeContent,
  imported: RecipeContent,
  now: number,
): RecipeChange | null {
  const updates = fieldUpdates(existing, imported);
  if (updates.length === 0) return null;
  const fields: Partial<RecipeContent> = {};
  for (const { field } of updates) {
    // Lines the recipe already had keep their IDs (and so their links and notes).
    if (field === "ingredients") {
      fields.ingredients = ingredientsFromText(
        textFromLines(imported.ingredients),
        existing.ingredients,
      );
    } else if (field === "directions") {
      fields.directions = directionsFromText(
        textFromLines(imported.directions),
        existing.directions,
      );
    } else {
      (fields as Record<string, unknown>)[field] = imported[field];
    }
  }
  return { kind: "recipe", id: recipeId, fields, changedAt: now };
}

/** Where a recipe saved from this draft came from, so importing it again can find it. */
export function importRecord(job: ImportJobDetail, now: number): RecipeImport {
  return {
    source: job.draft.source,
    importJobId: job.id,
    externalId: job.draft.externalId ?? job.page.url,
    externalHash: job.draft.externalHash,
    importedAt: new Date(now).toISOString(),
  };
}

/** The change that saves a reviewed draft as a new recipe. */
export function createChange(
  recipeId: string,
  job: ImportJobDetail,
  content: RecipeContent,
  now: number,
): RecipeChange {
  const fields = { ...emptyRecipeContent() };
  for (const field of RECIPE_FIELDS) (fields as Record<string, unknown>)[field] = content[field];
  return {
    kind: "recipe",
    id: recipeId,
    create: { createdAt: new Date(now).toISOString(), import: importRecord(job, now) },
    fields,
    changedAt: now,
  };
}

/** A category path as the draft gives it ("Diet › Vegan"), as names. */
export function pathNames(path: string): string[] {
  return path
    .split(CATEGORY_SEPARATOR.trim())
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The copy as its own document: nothing may run, and nothing is fetched (no tracking). */
export function snapshotDocument(snapshot: string, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>${css}</style></head><body>${snapshot}</body></html>`;
}
