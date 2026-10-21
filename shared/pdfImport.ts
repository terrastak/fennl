/**
 * Importing recipes from a PDF (phase E12; spec.md E12). The PDF is opened on the person's device
 * (app/pdf/), never uploaded whole: each page's own text, where it has any, and a picture of it
 * where it's scanned, go to "find the recipes", one quick AI pass that lists the recipes and the
 * pages each is on (free: it doesn't count as an AI import). The person can change that list;
 * then each recipe is read from its pages, one at a time, like photos (E9), and counts as one AI
 * import (owner's choices 2026-10-21: at most 100 pages and 30 MB, each recipe read counts).
 */

/** Not plan limits: what a PDF import handles well (owner's choice for the beta, 2026-10-21). */
export const PDF_RULES = {
  /** The most pages a PDF may have. */
  pages: 100,
  /** The largest PDF file. */
  bytes: 30 * 1024 * 1024,
  /** A page's text sent to find the recipes; a page holding more is cut there. */
  pageTextChars: 12_000,
  /**
   * Below this many letters a page counts as scanned (a photo of the page) rather than text,
   * unless a picture covers most of it anyway (pageKind).
   */
  textPageLetters: 40,
  /** The pictures of scanned pages sent to find the recipes, together (base64 in the body). */
  findImageBytes: 16 * 1024 * 1024,
  /** Pages one recipe can be read from: as photos (IMPORT_RULES.photoPages). */
  recipePages: 10,
} as const;

/** How each page is labelled for the AI: finding the recipes, then reading one of them. */
export const PDF_LABELS = {
  findText: (page: number) => `Page ${page}, its text`,
  findPicture: (page: number) => `Page ${page}, a picture`,
  readPicture: (page: number) => `Page ${page} of the PDF, as a picture`,
  readText: (page: number) => `Page ${page} of the PDF, its text`,
} as const;

/** How a page is read: by its own text, or as a picture (a scanned page). */
export type PageKind = "text" | "picture";

/**
 * A page with real text is read from its text; one that is mostly a picture (a scan, even with
 * a text layer added by the scanner, which is often wrong) is read from its picture.
 * `pictureShare`: how much of the page its largest picture covers, 0 to 1.
 */
export function pageKind(text: string, pictureShare: number): PageKind {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (pictureShare >= 0.6) return "picture";
  return letters >= PDF_RULES.textPageLetters ? "text" : "picture";
}

/** One page as sent to find the recipes. */
export type PdfFindPage =
  | { page: number; text: string }
  | { page: number; image: string; mediaType: "image/jpeg" | "image/webp" | "image/png" };

/** A recipe found in a PDF: its title, and the first and last page it's on. */
export interface PdfRecipe {
  title: string;
  firstPage: number;
  lastPage: number;
}

/** POST /api/import/pdf/find: the recipes found, in order. */
export interface PdfFindResponse {
  recipes: PdfRecipe[];
}

export type PdfFindError =
  | "invalid_request"
  | "ai_import_not_included"
  | "too_many_pages"
  | "pages_too_large"
  | "rate_limited"
  | "paused"
  | "monthly_limit"
  | "ai_unavailable";

/** What the AI is asked for when it finds the recipes. */
export const PDF_FIND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          firstPage: { type: "integer" },
          lastPage: { type: "integer" },
        },
        required: ["title", "firstPage", "lastPage"],
      },
    },
  },
  required: ["recipes"],
} as const;

/** A title kept to a sensible length, in one line. */
const cleanTitle = (title: string) => title.replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * The AI's list of recipes, checked and tidied: pages kept within the PDF and in order (a recipe
 * starts no earlier than the one before), at most PDF_RULES.recipePages pages each, untitled ones
 * left out. Null when it isn't a list of recipes at all.
 */
export function pdfRecipes(answer: unknown, pageCount: number): PdfRecipe[] | null {
  const list = (answer as { recipes?: unknown } | null)?.recipes;
  if (!Array.isArray(list)) return null;
  const found: PdfRecipe[] = [];
  for (const item of list) {
    const r = item as Partial<PdfRecipe> | null;
    if (!r || typeof r.title !== "string") continue;
    const title = cleanTitle(r.title);
    if (!title || !Number.isInteger(r.firstPage) || !Number.isInteger(r.lastPage)) continue;
    const before = found[found.length - 1]?.firstPage ?? 1;
    const first = Math.min(pageCount, Math.max(before, r.firstPage as number));
    const last = Math.min(
      pageCount,
      Math.max(first, r.lastPage as number),
      first + PDF_RULES.recipePages - 1,
    );
    found.push({ title, firstPage: first, lastPage: last });
  }
  return found;
}

/** A person's change to the list of recipes, checked the same way (null: not a valid list). */
export function editedRecipes(recipes: PdfRecipe[], pageCount: number): PdfRecipe[] | null {
  for (const r of recipes) {
    if (!cleanTitle(r.title)) return null;
    if (r.firstPage < 1 || r.lastPage > pageCount || r.firstPage > r.lastPage) return null;
    if (r.lastPage - r.firstPage + 1 > PDF_RULES.recipePages) return null;
  }
  return recipes.map((r) => ({ ...r, title: cleanTitle(r.title) }));
}

/** POST /api/import/pdf: one recipe, read from its pages (photos already uploaded). */
export interface PdfReadRequest {
  /** The recipe's title, as found (or as the person changed it). */
  title: string;
  /** Its pages' photos, in order (hashes of the person's photos). */
  pages: string[];
  /** Each page's number in the PDF. */
  pageNumbers: number[];
  /** Each page's own text, where it was read from its text; null where it's a picture. */
  texts: (string | null)[];
  /** The PDF's file name, kept as the draft's input name. */
  fileName: string;
  /** Recipes from the same PDF share one batch. */
  batchId: string;
}
