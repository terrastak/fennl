import { draftIssues } from "../../shared/importDraft";
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
  | { ok: true; jobIds: string[] }
  | { ok: false; error: ImportTextError; status: 400 | 403 | 413 | 422 | 429 | 503 };

/** Reads pasted text into drafts waiting for review. */
export async function importPastedText(
  caller: AiCaller,
  raw: unknown,
): Promise<PastedImportResult> {
  if (typeof raw !== "string") return { ok: false, error: "invalid_request", status: 400 };
  if (raw.length > PASTED_TEXT_CHARS) return { ok: false, error: "text_too_large", status: 413 };
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) return { ok: false, error: "invalid_request", status: 400 };
  if (text.length < MIN_PASTED_CHARS) return { ok: false, error: "no_recipe", status: 422 };

  const read = readPastedText(text);
  if (read.kind === "web_address") return { ok: false, error: "web_address", status: 422 };

  const provenance: PastedProvenance = { pasted: { text } };

  if (read.kind === "recipe" && caller.plan.import_structured_enabled) {
    const draft = read.draft;
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
      return { ok: true, jobIds: [id] };
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
      parts: [{ kind: "text", label: "The pasted text", text }],
      inputs: [{ kind: "text", name: PASTED_SOURCE_NAME, url: null, imageHash: null }],
      photos: [],
    },
    {
      provenance: provenance as unknown as Record<string, unknown>,
      limit: IMPORT_RULES.recipesPerPage,
    },
  );
  if (!created.ok) return { ok: false, ...AI_ERRORS[created.problem] };
  return { ok: true, jobIds: created.jobIds };
}
