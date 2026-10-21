import { eq } from "drizzle-orm";
import { DOCUMENT_RULES } from "../../shared/documentText";
import { draftIssues, type RecipeDraft } from "../../shared/importDraft";
import { IMPORT_RULES, type ImportTextError, type PastedProvenance } from "../../shared/importJobs";
import {
  MIN_PASTED_CHARS,
  PASTED_SOURCE_NAME,
  PASTED_TEXT_CHARS,
  readPastedText,
} from "../../shared/pastedText";
import { importJob } from "../db/schema";
import { createAiImport, type AiCaller, type AiReadProblem } from "../ai/read";
import { withinRateLimit } from "../rateLimit";

// Recipe text pasted into Fennl (phase E15; CLAUDE.md, "Import sources"). Text that is clearly
// laid out is read by Fennl's own rules, which cost nothing, so Free can use it. Anything else
// is read by the AI (Premium), through the same layer as every AI import: the cheaper model
// first, a second look when needed, metered and limited (worker/ai/read.ts). Nothing is fetched:
// a web address on its own is turned away, and the text is kept with the draft only until it is
// saved or removed.
//
// A document (phase E18) comes the same way: its text, taken out on the person's device
// (shared/documentText.ts), with its file name, and on Premium the number of pictures in it,
// which each draft offers as photos to keep, like a web page's (owner's choices 2026-10-21).

const DAY = 24 * 60 * 60 * 1000;

const AI_ERRORS: Record<AiReadProblem, { error: ImportTextError; status: 403 | 422 | 429 | 503 }> =
  {
    import_not_included: { error: "ai_import_not_included", status: 403 },
    monthly_limit: { error: "monthly_limit", status: 429 },
    paused: { error: "paused", status: 503 },
    unavailable: { error: "ai_unavailable", status: 503 },
    no_recipe: { error: "no_recipe", status: 422 },
  };

export type PastedImportResult =
  | { ok: true; jobIds: string[]; pictures: { job: string; inputs: number[] }[] }
  | { ok: false; error: ImportTextError; status: 400 | 403 | 413 | 422 | 429 | 503 };

/** The document the text came from (phase E18), and how many pictures it offers. */
export interface FromDocument {
  fileName: string;
  pictures: number;
}

/** Reads pasted text, or a document's text, into drafts waiting for review. */
export async function importPastedText(
  caller: AiCaller,
  raw: unknown,
  document?: FromDocument,
): Promise<PastedImportResult> {
  if (typeof raw !== "string") return { ok: false, error: "invalid_request", status: 400 };
  if (raw.length > PASTED_TEXT_CHARS) return { ok: false, error: "text_too_large", status: 413 };
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) return { ok: false, error: "invalid_request", status: 400 };
  if (text.length < MIN_PASTED_CHARS) return { ok: false, error: "no_recipe", status: 422 };

  const read = readPastedText(text);
  if (read.kind === "web_address") return { ok: false, error: "web_address", status: 422 };

  const provenance: PastedProvenance = {
    pasted: document ? { text, fileName: document.fileName } : { text },
  };
  const sourceName = document?.fileName ?? PASTED_SOURCE_NAME;
  const done = async (jobIds: string[]): Promise<PastedImportResult> => ({
    ok: true,
    jobIds,
    pictures: await offerPictures(caller, jobIds, document),
  });

  if (read.kind === "recipe" && caller.plan.import_structured_enabled) {
    const draft: RecipeDraft = {
      ...read.draft,
      inputs: read.draft.inputs.map((input) => ({ ...input, name: sourceName })),
    };
    if (draftIssues(draft).length === 0) {
      // The plan's daily number (structured_imports_per_day; none by default), counted only once
      // there is a recipe, like a web page's.
      const perDay = caller.plan.structured_imports_per_day;
      if (
        perDay !== null &&
        !(await withinRateLimit(caller.db, `import-structured:day:${caller.userId}`, {
          max: perDay,
          windowMs: DAY,
        }))
      ) {
        return { ok: false, error: "daily_limit", status: 429 };
      }
      const id = crypto.randomUUID();
      const now = new Date();
      await caller.db.insert(importJob).values({
        id,
        householdId: caller.householdId,
        userId: caller.userId,
        batchId: null,
        source: draft.source,
        status: "ready",
        draft: JSON.stringify(draft),
        provenance: JSON.stringify(provenance),
        error: null,
        recipeId: null,
        createdAt: now,
        updatedAt: now,
      });
      return done([id]);
    }
  }

  // Not clearly laid out (or not allowed to read it for free): the AI reads it, if the plan has it.
  if (!caller.plan.import_ai_enabled) {
    return {
      ok: false,
      error: caller.plan.import_structured_enabled
        ? "ai_import_not_included"
        : "import_not_included",
      status: 403,
    };
  }
  const created = await createAiImport(
    caller,
    {
      source: "text",
      parts: [
        {
          kind: "text",
          label: document ? `The text of a document, ${document.fileName}` : "The pasted text",
          text,
        },
      ],
      inputs: [{ kind: "text", name: sourceName, url: null, imageHash: null }],
      photos: [],
    },
    {
      provenance: provenance as unknown as Record<string, unknown>,
      limit: IMPORT_RULES.recipesPerPage,
    },
  );
  if (!created.ok) return { ok: false, ...AI_ERRORS[created.problem] };
  return done(created.jobIds);
}

/**
 * A document's pictures, offered on each draft as photos to keep (Premium): photo inputs added
 * after the draft's own, filled in when the app hands each picture over
 * (POST /api/import/jobs/:id/inputs/:n, kept until the draft is saved or removed).
 */
async function offerPictures(
  caller: AiCaller,
  jobIds: string[],
  document: FromDocument | undefined,
): Promise<{ job: string; inputs: number[] }[]> {
  const count = Math.min(document?.pictures ?? 0, DOCUMENT_RULES.pictures);
  if (!document || count <= 0 || !caller.plan.images_enabled) return [];
  const offered: { job: string; inputs: number[] }[] = [];
  for (const id of jobIds) {
    const row = await caller.db
      .select({ draft: importJob.draft })
      .from(importJob)
      .where(eq(importJob.id, id))
      .get();
    if (!row?.draft) continue;
    const draft = JSON.parse(row.draft) as RecipeDraft;
    const first = draft.inputs.length;
    const inputs = Array.from({ length: count }, (_, n) => first + n);
    draft.inputs.push(
      ...inputs.map((_, n) => ({
        kind: "image" as const,
        name: `${document.fileName}, picture ${n + 1}`,
        url: null,
        imageHash: null,
      })),
    );
    draft.photos.push(...inputs.map((input) => ({ input, role: "photo" as const })));
    await caller.db
      .update(importJob)
      .set({ draft: JSON.stringify(draft), updatedAt: new Date() })
      .where(eq(importJob.id, id));
    offered.push({ job: id, inputs });
  }
  return offered;
}
