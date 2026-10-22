import {
  RECIPE_FIELDS,
  type RecipeContent,
  type RecipeField,
  type RecipeOpinion,
} from "../../shared/recipe";
import { servingsText, sourceLine, timeText } from "../../shared/recipeText";
import type { SyncChange } from "../../shared/sync";
import type { RecipeVersion } from "../../shared/versions";
import { FIELD_NAMES } from "../import/review";

// Comparing a recipe with its earlier version, and putting the earlier one back (phase E13; the
// banner on the recipe page). Apart from the page so they can be tested.

export interface VersionDifference {
  /** A recipe field, or the person's own stars or note. */
  key: RecipeField | "rating" | "note";
  name: string;
  now: string;
  before: string;
}

/** A field as people read it, whole: lines one per line, headings as they are. */
function fieldText(content: RecipeContent, field: RecipeField): string {
  switch (field) {
    case "ingredients":
    case "directions":
      return content[field].map((line) => line.text).join("\n");
    case "times":
      return (["prep", "cook", "total"] as const)
        .map((k) => {
          const t = timeText(content.times[k]);
          return t ? `${k[0]?.toUpperCase()}${k.slice(1)}: ${t}` : null;
        })
        .filter(Boolean)
        .join("\n");
    case "servings":
      return servingsText(content.servings) ?? "";
    case "source": {
      const s = content.source;
      return [s.kind === "person" ? s.name : sourceLine(s), s.url].filter(Boolean).join("\n");
    }
    case "nutrition":
      return content.nutrition?.text ?? (content.nutrition ? "Per serving" : "");
    case "difficulty":
      return content.difficulty ?? "";
    default:
      return String(content[field] ?? "");
  }
}

/** What differs between the recipe now and its earlier version, field by field. */
export function versionDifferences(
  now: RecipeContent,
  version: RecipeVersion,
  mine: RecipeOpinion | null,
  me: string,
): VersionDifference[] {
  const before = version.snapshot.content;
  const found: VersionDifference[] = [];
  for (const field of RECIPE_FIELDS) {
    if (JSON.stringify(now[field]) === JSON.stringify(before[field])) continue;
    const a = fieldText(now, field);
    const b = fieldText(before, field);
    // A difference only in line ids or similar bookkeeping isn't one people can see.
    if (a === b) continue;
    found.push({ key: field, name: FIELD_NAMES[field], now: a || "None", before: b || "None" });
  }
  const theirs = version.snapshot.opinion;
  if (theirs && theirs.userId === me) {
    if ((mine?.rating ?? null) !== theirs.rating) {
      found.push({
        key: "rating",
        name: "Your stars",
        now: mine?.rating ? `${mine.rating} of 5` : "None",
        before: theirs.rating ? `${theirs.rating} of 5` : "None",
      });
    }
    if ((mine?.note ?? "") !== theirs.note) {
      found.push({
        key: "note",
        name: "Your note",
        now: mine?.note || "None",
        before: theirs.note || "None",
      });
    }
  }
  return found;
}

/**
 * The changes that put the earlier version back: every field that differs, as it was (its lines
 * with the ids they had), and the person's own stars and note when the version kept them.
 */
export function restoreChanges(
  recipeId: string,
  now: RecipeContent,
  version: RecipeVersion,
  mine: RecipeOpinion | null,
  me: string,
  at: number,
): SyncChange[] {
  const before = version.snapshot.content;
  const fields: Partial<RecipeContent> = {};
  for (const field of RECIPE_FIELDS) {
    if (JSON.stringify(now[field]) !== JSON.stringify(before[field])) {
      (fields as Record<string, unknown>)[field] = before[field];
    }
  }
  const changes: SyncChange[] = [];
  if (Object.keys(fields).length > 0) {
    changes.push({ kind: "recipe", id: recipeId, fields, changedAt: at });
  }
  const theirs = version.snapshot.opinion;
  if (theirs && theirs.userId === me) {
    const opinion: { rating?: number | null; note?: string } = {};
    if ((mine?.rating ?? null) !== theirs.rating) opinion.rating = theirs.rating;
    if ((mine?.note ?? "") !== theirs.note) opinion.note = theirs.note;
    if (Object.keys(opinion).length > 0) {
      changes.push({ kind: "opinion", recipeId, fields: opinion, changedAt: at });
    }
  }
  return changes;
}
