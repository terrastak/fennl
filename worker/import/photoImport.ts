import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DraftInput } from "../../shared/importDraft";
import { IMPORT_RULES, type ImportPhotosError } from "../../shared/importJobs";
import { isImageHash } from "../../shared/images";
import { PDF_LABELS } from "../../shared/pdfImport";
import { createAiImport, type AiCaller, type AiReadProblem } from "../ai/read";
import type { AiPart } from "../ai/provider";
import { image } from "../db/schema";
import { imageKey } from "../images/images";

// Photos of a recipe's pages, read by the AI (phase E9; CLAUDE.md, "Import sources"). The app
// prepares each page on the device (at most 3000 px, WebP about 90: spec.md D2) and uploads it to
// the person's photos first (POST /api/images/upload), so every check and the quota apply to
// it like any photo, and it's stored once: the draft reads it from there, "Read again" too, and
// saving the recipe keeps it as an import original (CLAUDE.md: original photos are always kept).
// E11: screenshots come the same way; the app says when every page is one (a PNG it was given,
// not a photo it took), so the AI reads them as screenshots (worker/ai/prompt.ts).

const AI_ERRORS: Record<
  AiReadProblem,
  { error: ImportPhotosError; status: 403 | 422 | 429 | 503 }
> = {
  import_not_included: { error: "ai_import_not_included", status: 403 },
  monthly_limit: { error: "monthly_limit", status: 429 },
  paused: { error: "paused", status: 503 },
  unavailable: { error: "ai_unavailable", status: 503 },
  no_recipe: { error: "no_recipe", status: 422 },
};

/** Formats the AI reads (not AVIF, which the app never makes for a page). */
const READABLE = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type Readable = (typeof READABLE)[number];

export type PhotoImportResult =
  | { ok: true; jobIds: string[] }
  | { ok: false; error: ImportPhotosError; status: 400 | 403 | 404 | 413 | 422 | 429 | 503 };

/**
 * One recipe's pages of a PDF (phase E12): which recipe, the pages' numbers in the PDF, and each
 * page's own text where it was read from its text (null where it's a scanned page).
 */
export interface PdfPages {
  title: string;
  pageNumbers: number[];
  texts: (string | null)[];
  fileName: string;
  batchId: string;
}

/**
 * Reads the pages (photo hashes, in order) into drafts waiting for review. `screenshots`: every
 * page is a screenshot (phase E11). `pdf`: they're one recipe's pages of a PDF (phase E12),
 * read for that recipe only, with the pages' own text, into one draft.
 */
export async function importPhotos(
  caller: AiCaller,
  pages: unknown,
  screenshots: unknown = false,
  pdf?: PdfPages,
): Promise<PhotoImportResult> {
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(isImageHash)) {
    return { ok: false, error: "invalid_request", status: 400 };
  }
  if (pages.length > IMPORT_RULES.photoPages) {
    return { ok: false, error: "too_many_pages", status: 413 };
  }
  if (!caller.plan.import_ai_enabled) return { ok: false, ...AI_ERRORS.import_not_included };

  // Only the person's own photos, still kept.
  const rows = await caller.db
    .select({ hash: image.hash, bytes: image.bytes, contentType: image.contentType })
    .from(image)
    .where(
      and(
        eq(image.ownerUserId, caller.userId),
        inArray(image.hash, [...new Set(pages)]),
        isNull(image.deletedAt),
      ),
    )
    .all();
  const byHash = new Map(rows.map((row) => [row.hash, row]));
  const found = pages.map((hash) => byHash.get(hash));
  if (found.some((row) => !row || !(READABLE as readonly string[]).includes(row.contentType))) {
    return { ok: false, error: "page_missing", status: 404 };
  }
  const total = found.reduce((sum, row) => sum + (row?.bytes ?? 0), 0);
  if (total > IMPORT_RULES.photoBytes) return { ok: false, error: "pages_too_large", status: 413 };

  const what = pdf ? "Page" : screenshots === true ? "Screenshot" : "Photo";
  const pageName = (n: number) =>
    pdf ? `Page ${pdf.pageNumbers[n]}` : pages.length === 1 ? what : `${what} ${n + 1}`;
  const parts: AiPart[] = [];
  const storedAt: string[] = [];
  for (const [n, hash] of pages.entries()) {
    const key = imageKey(caller.userId, hash);
    const object = await caller.env.IMAGES.get(key);
    if (!object) return { ok: false, error: "page_missing", status: 404 };
    const label = pdf
      ? PDF_LABELS.readPicture(pdf.pageNumbers[n] ?? n + 1)
      : pages.length === 1
        ? `The ${what.toLowerCase()}`
        : `${what} ${n + 1} of ${pages.length}`;
    parts.push({
      kind: "image",
      mediaType: byHash.get(hash)?.contentType as Readable,
      bytes: new Uint8Array(await object.arrayBuffer()),
      label,
    });
    storedAt.push(key);
  }
  // A PDF page's own text follows the pictures (exact for a PDF made on a computer).
  for (const [n, text] of (pdf?.texts ?? []).entries()) {
    if (text) {
      parts.push({ kind: "text", text, label: PDF_LABELS.readText(pdf?.pageNumbers[n] ?? n + 1) });
    }
  }
  const inputs: DraftInput[] = pages.map((hash, n) => ({
    kind: "image",
    name: pdf ? `${pdf.fileName}, ${pageName(n).toLowerCase()}` : pageName(n),
    url: null,
    imageHash: hash,
  }));
  const created = await createAiImport(
    caller,
    {
      source: pdf ? "pdf" : screenshots === true ? "screenshot" : "photo",
      parts,
      inputs,
      // Every page is kept with the recipe, out of its gallery.
      photos: pages.map((_, n) => ({ input: n, role: "import_original" })),
      storedAt,
      ...(pdf ? { focus: pdf.title } : {}),
    },
    pdf ? { batchId: pdf.batchId, limit: 1 } : {},
  );
  if (!created.ok) return { ok: false, ...AI_ERRORS[created.problem] };
  return { ok: true, jobIds: created.jobIds };
}
