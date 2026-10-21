import { detectImageType, isImageHash } from "../../shared/images";
import {
  PDF_LABELS,
  PDF_RULES,
  type PdfFindPage,
  type PdfReadRequest,
} from "../../shared/pdfImport";
import type { AiPart } from "../ai/provider";
import type { PdfPages } from "./photoImport";

// The checks on the two PDF requests (phase E12; shared/pdfImport.ts). The PDF itself never
// reaches the server: the app sends each page's own text, or a small picture of a scanned page,
// to find the recipes, then each recipe's pages as photos (uploaded like any photo) to read it.

/** The largest request to find the recipes: the pictures travel as base64 text. */
export const FIND_BODY_BYTES = Math.ceil((PDF_RULES.findImageBytes * 4) / 3) + 2 * 1024 * 1024;

const fromBase64 = (text: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

/**
 * The pages to find the recipes in, as the AI reads them; or why not. Pages come in order, each
 * once, numbered from 1 to `pageCount` (at most PDF_RULES.pages).
 */
export function findParts(
  body: { pages?: unknown; pageCount?: unknown } | null,
):
  | { ok: true; parts: AiPart[]; pageCount: number }
  | { ok: false; error: "invalid_request" | "too_many_pages" | "pages_too_large" } {
  const pages = body?.pages;
  const pageCount = body?.pageCount;
  if (!Array.isArray(pages) || pages.length === 0 || !Number.isInteger(pageCount)) {
    return { ok: false, error: "invalid_request" };
  }
  if ((pageCount as number) > PDF_RULES.pages || pages.length > PDF_RULES.pages) {
    return { ok: false, error: "too_many_pages" };
  }
  const parts: AiPart[] = [];
  let imageBytes = 0;
  let before = 0;
  for (const raw of pages as PdfFindPage[]) {
    const page = raw?.page;
    if (!Number.isInteger(page) || page <= before || page > (pageCount as number)) {
      return { ok: false, error: "invalid_request" };
    }
    before = page;
    if ("text" in raw && typeof raw.text === "string") {
      const text = raw.text.slice(0, PDF_RULES.pageTextChars);
      parts.push({ kind: "text", text: text || "(no text)", label: PDF_LABELS.findText(page) });
      continue;
    }
    if (!("image" in raw) || typeof raw.image !== "string") {
      return { ok: false, error: "invalid_request" };
    }
    const bytes = fromBase64(raw.image);
    const type = bytes ? detectImageType(bytes) : null;
    if (!bytes || (type !== "image/jpeg" && type !== "image/webp" && type !== "image/png")) {
      return { ok: false, error: "invalid_request" };
    }
    imageBytes += bytes.byteLength;
    if (imageBytes > PDF_RULES.findImageBytes) return { ok: false, error: "pages_too_large" };
    parts.push({ kind: "image", mediaType: type, bytes, label: PDF_LABELS.findPicture(page) });
  }
  return { ok: true, parts, pageCount: pageCount as number };
}

/** One recipe's pages to read, checked; or null when the request isn't valid. */
export function pdfPages(
  body: Partial<PdfReadRequest> | null,
): { pages: string[]; pdf: PdfPages } | null {
  if (!body) return null;
  const { title, pages, pageNumbers, texts, fileName, batchId } = body;
  if (typeof title !== "string" || !title.trim() || title.length > 200) return null;
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(isImageHash)) return null;
  if (pages.length > PDF_RULES.recipePages) return null;
  if (!Array.isArray(pageNumbers) || pageNumbers.length !== pages.length) return null;
  if (!pageNumbers.every((n) => Number.isInteger(n) && n >= 1 && n <= PDF_RULES.pages)) {
    return null;
  }
  if (!Array.isArray(texts) || texts.length !== pages.length) return null;
  if (!texts.every((t) => t === null || typeof t === "string")) return null;
  if (typeof fileName !== "string" || fileName.length > 200) return null;
  if (typeof batchId !== "string" || !/^[0-9a-f-]{36}$/.test(batchId)) return null;
  return {
    pages,
    pdf: {
      title: title.trim(),
      pageNumbers,
      texts: texts.map((t) => (t === null ? null : t.slice(0, PDF_RULES.pageTextChars))),
      fileName: fileName.trim() || "PDF",
      batchId,
    },
  };
}
