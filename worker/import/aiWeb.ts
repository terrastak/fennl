import { fillMissingLists, missingLists } from "../../shared/aiAnswer";
import type { DraftInput, RecipeDraft } from "../../shared/importDraft";
import { IMPORT_RULES, type ImportWebError, type WebProvenance } from "../../shared/importJobs";
import { pageForAi, type PageForAi } from "../../shared/pageText";
import { createAiImport, readWithAi, type AiCaller, type AiReadProblem } from "../ai/read";
import { MIN_PAGE_TEXT, pageAiPart } from "./aiPage";

// Web pages without recipe data, read by the AI (phase E8; CLAUDE.md, "Import sources": the
// page's structured data first, then the AI for pages without it). The page's article text goes
// to the AI layer (worker/ai/read.ts), which reads it as it reads a card: the cheaper model, a
// second look when its answer looks wrong, and "Read again" once on the review screen.

/** How an AI problem reaches the Import page and the Chrome extension. */
export const AI_WEB_ERRORS: Record<
  AiReadProblem,
  { error: ImportWebError; status: 403 | 422 | 429 | 503 }
> = {
  import_not_included: { error: "ai_import_not_included", status: 403 },
  monthly_limit: { error: "monthly_limit", status: 429 },
  paused: { error: "paused", status: 503 },
  unavailable: { error: "ai_unavailable", status: 503 },
  no_recipe: { error: "no_recipe", status: 422 },
};

/**
 * Reads a page without recipe data with the AI and makes a draft for each recipe in it, kept with
 * the page's address and a copy of its article for the review screen.
 */
export async function importPageWithAi(
  caller: AiCaller,
  html: string,
  pageUrl: string | null,
  bytes: number,
): Promise<
  { ok: true; jobIds: string[] } | ({ ok: false } & (typeof AI_WEB_ERRORS)[AiReadProblem])
> {
  const page = pageForAi(html, pageUrl);
  if (page.text.length < MIN_PAGE_TEXT) return { ok: false, ...AI_WEB_ERRORS.no_recipe };
  if (!caller.plan.import_ai_enabled) return { ok: false, ...AI_WEB_ERRORS.import_not_included };

  const inputs: DraftInput[] = [
    { kind: "page", name: page.title, url: pageUrl, imageHash: null },
    ...page.photos.map((url): DraftInput => ({ kind: "image", name: null, url, imageHash: null })),
  ];
  const snapshot =
    page.snapshot.trim() &&
    new TextEncoder().encode(page.snapshot).byteLength <= IMPORT_RULES.snapshotBytes
      ? page.snapshot
      : null;
  const provenance: WebProvenance = {
    page: { url: pageUrl, title: page.title?.slice(0, 300) ?? null },
    snapshot,
    bytes,
  };
  const created = await createAiImport(
    caller,
    {
      source: "website",
      parts: [pageAiPart(page, pageUrl)],
      inputs,
      photos: page.photos.map((_, i) => ({ input: i + 1, role: "photo" })),
    },
    {
      provenance: provenance as unknown as Record<string, unknown>,
      finish: (draft) => asFromPage(draft, page, pageUrl),
      limit: IMPORT_RULES.recipesPerPage,
    },
  );
  return created.ok
    ? { ok: true, jobIds: created.jobIds }
    : { ok: false, ...AI_WEB_ERRORS[created.problem] };
}

/**
 * The page's address as the draft's own ID, and the page as its source, as for a page with recipe
 * data: the site's name (or its address's), and the author when the AI found one ("by June Lee",
 * or a person the recipe is from).
 */
function asFromPage(draft: RecipeDraft, page: PageForAi, url: string | null): RecipeDraft {
  const read = draft.fields.source?.value;
  const host = URL.canParse(url ?? "")
    ? new URL(url as string).hostname.replace(/^www\./, "")
    : null;
  const fields = { ...draft.fields };
  fields.source = {
    value: {
      kind: "website",
      name: page.site ?? (read?.kind === "website" ? read.name : null) ?? host,
      url: url ?? read?.url ?? null,
      author: read?.author ?? (read?.kind === "person" ? read.name : null),
      page: null,
    },
    confidence: "high",
    from: [{ kind: "page_text", input: 0, detail: "the page's address and site name" }],
  };
  return {
    ...draft,
    externalId: url,
    fields,
    warnings: page.cut
      ? [...draft.warnings, "The page was very long, so Fennl read only the first part of it."]
      : draft.warnings,
  };
}

/**
 * Pages whose recipe data has no ingredients or no method (phase E8): on a plan with AI import,
 * the AI reads the page and only the missing lists are taken from it. Without AI import, or if
 * the read doesn't work out, the drafts stay as the data has them (the review screen says what's
 * missing).
 */
export async function fillFromPage(
  caller: AiCaller,
  html: string,
  pageUrl: string | null,
  drafts: RecipeDraft[],
): Promise<RecipeDraft[]> {
  if (!caller.plan.import_ai_enabled || !drafts.some(missingLists)) return drafts;
  const page = pageForAi(html, pageUrl);
  if (page.text.length < MIN_PAGE_TEXT) return drafts;
  const read = await readWithAi(caller, {
    source: "website",
    parts: [pageAiPart(page, pageUrl)],
    inputs: [],
    photos: [],
  });
  if (!read.ok) return drafts;
  const title = (d: RecipeDraft) => d.fields.title?.value.trim().toLowerCase() ?? "";
  return drafts.map((draft, i) => {
    if (!missingLists(draft)) return draft;
    const match =
      read.drafts.find((r) => title(r) && title(r) === title(draft)) ??
      (read.drafts.length === drafts.length ? read.drafts[i] : read.drafts[0]);
    return match ? fillMissingLists(draft, match) : draft;
  });
}
