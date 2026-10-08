import {
  CATEGORY_SEPARATOR,
  RECIPE_FIELDS,
  isCategoryName,
  isRating,
  recipeIssues,
  type RecipeContent,
  type RecipeImport,
} from "./recipe";
import { isDay, type SyncChange } from "./sync";

/**
 * Fennl's own export file (phase C10): every recipe in the library, with its categories, the
 * household's ratings, notes and "made it" days. It goes in the export .zip as
 * `fennl-recipes.json`, next to a web page per recipe (worker/export/).
 *
 * It's written for keeping and for moving: plain JSON, recipes as they're stored
 * (shared/recipe.ts), categories as paths ("Desserts › Cakes"), people by name. Fennl can read it
 * back (importChanges) into any account.
 */

export const EXPORT_FORMAT = "fennl-export";
export const EXPORT_VERSION = 1;

export interface ExportPerson {
  userId: string;
  name: string;
}

export interface ExportOpinion {
  userId: string;
  rating: number | null;
  favorite: boolean;
  note: string;
}

export interface ExportRecipe extends RecipeContent {
  id: string;
  /** Who added it (one of `people`). */
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  copiedFrom: string | null;
  import: RecipeImport | null;
  /** Category paths ("Desserts › Cakes"), sorted. */
  categories: string[];
  /** Each person's rating, favorite and note, when they gave one. */
  opinions: ExportOpinion[];
  /** "Made it" days, newest first. */
  made: { userId: string; madeOn: string }[];
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  /** The person who exported it. */
  exportedBy: ExportPerson;
  /** The household when it was exported. */
  people: ExportPerson[];
  /** Every category path, including empty ones. */
  categories: string[];
  recipes: ExportRecipe[];
}

/** Reads an export file, or null if it isn't one this version of Fennl understands. */
export function readExportFile(value: unknown): ExportFile | null {
  if (typeof value !== "object" || value === null) return null;
  const file = value as Partial<ExportFile>;
  if (file.format !== EXPORT_FORMAT || typeof file.version !== "number") return null;
  if (file.version > EXPORT_VERSION) return null;
  if (!Array.isArray(file.recipes) || !Array.isArray(file.categories)) return null;
  if (typeof file.exportedBy?.userId !== "string") return null;
  return file as ExportFile;
}

export interface ImportPlan {
  changes: SyncChange[];
  /** Recipes it adds. */
  recipes: number;
  /** Titles of recipes left out because they couldn't be read. */
  skipped: string[];
}

/**
 * The changes that add an export's recipes to the signed-in person's library (phase C10's
 * round trip; Stage E's import reviews them first). Everything gets new IDs, so the same file can
 * go into any account. The exporter's own ratings, notes and "made it" days come along as the
 * importer's; other people's can't be anyone's but theirs, so they stay behind.
 */
export function importChanges(
  file: ExportFile,
  options: { now: number; newId?: () => string },
): ImportPlan {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const changedAt = options.now;
  const changes: SyncChange[] = [];

  // Categories: every path, parents first.
  const categoryIds = new Map<string, string>();
  const category = (path: string): string | null => {
    const key = path.toLocaleLowerCase();
    const known = categoryIds.get(key);
    if (known) return known;
    const names = path.split(CATEGORY_SEPARATOR).map((n) => n.trim());
    const name = names[names.length - 1] ?? "";
    if (!names.every(isCategoryName)) return null;
    const parentId =
      names.length > 1 ? category(names.slice(0, -1).join(CATEGORY_SEPARATOR)) : null;
    if (names.length > 1 && !parentId) return null;
    const id = newId();
    categoryIds.set(key, id);
    changes.push({
      kind: "category",
      id,
      create: {},
      fields: { name, parentId, sortOrder: 0 },
      changedAt,
    });
    return id;
  };
  for (const path of file.categories) if (typeof path === "string") category(path);

  const me = file.exportedBy.userId;
  const skipped: string[] = [];
  let recipes = 0;
  for (const r of file.recipes) {
    const content = Object.fromEntries(
      RECIPE_FIELDS.map((field) => [field, r[field]]),
    ) as unknown as RecipeContent;
    if (recipeIssues(content, null).length > 0 || typeof r.createdAt !== "string") {
      skipped.push(typeof r.title === "string" && r.title ? r.title : "Untitled");
      continue;
    }
    const recipeId = newId();
    recipes += 1;
    changes.push({
      kind: "recipe",
      id: recipeId,
      create: { createdAt: r.createdAt, import: r.import ?? null },
      fields: content,
      changedAt,
    });
    for (const path of r.categories ?? []) {
      const categoryId = category(path);
      if (categoryId) {
        changes.push({ kind: "recipeCategory", recipeId, categoryId, deleted: false, changedAt });
      }
    }
    const mine = (r.opinions ?? []).find((o) => o.userId === me);
    if (mine && (mine.rating !== null || mine.favorite || mine.note)) {
      changes.push({
        kind: "opinion",
        recipeId,
        fields: {
          rating: isRating(mine.rating) ? mine.rating : null,
          favorite: Boolean(mine.favorite),
          note: typeof mine.note === "string" ? mine.note : "",
        },
        changedAt,
      });
    }
    for (const made of r.made ?? []) {
      if (made.userId === me && isDay(made.madeOn)) {
        changes.push({ kind: "made", id: newId(), recipeId, madeOn: made.madeOn, changedAt });
      }
    }
  }
  return { changes, recipes, skipped };
}
