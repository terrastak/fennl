import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DraftInput } from "../../shared/importDraft";
import { IMPORT_RULES, type ImportPhotosError } from "../../shared/importJobs";
import { isImageHash } from "../../shared/images";
import { createAiImport, type AiCaller, type AiReadProblem } from "../ai/read";
import type { AiPart } from "../ai/provider";
import { image } from "../db/schema";
import { imageKey } from "../images/images";

// Photos of a recipe's pages, read by the AI (phase E9; CLAUDE.md, "Import sources"). The app
// prepares each page on the device (at most 3000 px, WebP about 90: spec.md D2) and uploads it to
// the person's photos first (POST /api/images/upload), so every check and the quota apply to
// it like any photo, and it's stored once: the draft reads it from there, "Read again" too, and
// saving the recipe keeps it as an import original (CLAUDE.md: original photos are always kept).

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

/** Reads the pages (photo hashes, in order) into drafts waiting for review. */
export async function importPhotos(caller: AiCaller, pages: unknown): Promise<PhotoImportResult> {
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

  const parts: AiPart[] = [];
  const storedAt: string[] = [];
  for (const [n, hash] of pages.entries()) {
    const key = imageKey(caller.userId, hash);
    const object = await caller.env.IMAGES.get(key);
    if (!object) return { ok: false, error: "page_missing", status: 404 };
    const label = pages.length === 1 ? "The photo" : `Photo ${n + 1} of ${pages.length}`;
    parts.push({
      kind: "image",
      mediaType: byHash.get(hash)?.contentType as Readable,
      bytes: new Uint8Array(await object.arrayBuffer()),
      label,
    });
    storedAt.push(key);
  }
  const inputs: DraftInput[] = pages.map((hash, n) => ({
    kind: "image",
    name: pages.length === 1 ? "Photo" : `Photo ${n + 1}`,
    url: null,
    imageHash: hash,
  }));
  const created = await createAiImport(caller, {
    source: "photo",
    parts,
    inputs,
    // Every page is kept with the recipe, out of its gallery.
    photos: pages.map((_, n) => ({ input: n, role: "import_original" })),
    storedAt,
  });
  if (!created.ok) return { ok: false, ...AI_ERRORS[created.problem] };
  return { ok: true, jobIds: created.jobIds };
}
