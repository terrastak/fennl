import { inArray, lt } from "drizzle-orm";
import {
  outcomeOf,
  type OutcomeKind,
  type OutcomeLists,
  type ReadAnswer,
} from "../../shared/aiOutcome";
import type { RecipeDraft } from "../../shared/importDraft";
import type { AiProvenance } from "../../shared/importJobs";
import type { Database } from "../db/client";
import { aiOutcome, recipe } from "../db/schema";
import { listsOf } from "./read";

// How AI-read drafts turn out (decided by the owner 2026-10-19; shared/aiOutcome.ts). When a
// draft the AI read is saved, discarded or removed unreviewed, one ai_outcome row records it:
// for a saved one, how close each model's answer was to what the person kept. The answers kept
// with the draft go with it; only the scores stay, for two years.

const DAY = 24 * 60 * 60 * 1000;
/** How long outcomes are kept (decided 2026-10-19). */
export const OUTCOME_KEEP_DAYS = 2 * 365;

/** What an outcome needs of a draft: an import_job row. */
export interface DecidedJob {
  id: string;
  source: string;
  draft: string | null;
  provenance: string;
  createdAt: Date;
}

/** The answers kept with a draft; for one read before they were kept, the draft itself. */
function answersOf(job: DecidedJob, ai: Partial<AiProvenance["ai"]>): ReadAnswer[] {
  if (ai.answers?.length) return ai.answers;
  const draft = job.draft ? (JSON.parse(job.draft) as RecipeDraft) : null;
  const model = ai.models?.[ai.models.length - 1];
  return draft && model ? [{ purpose: "read", model, shown: true, lists: listsOf(draft) }] : [];
}

/** Records how AI-read drafts turned out; other drafts (recipe data, no AI) are left alone. */
export async function recordOutcomes(
  db: Database,
  decided: { job: DecidedJob; outcome: OutcomeKind; saved: OutcomeLists | null }[],
  now = new Date(),
): Promise<number> {
  const rows = decided.flatMap(({ job, outcome, saved }) => {
    const ai = (JSON.parse(job.provenance) as Partial<AiProvenance>).ai;
    if (!ai) return [];
    const answers = answersOf(job, ai);
    if (answers.length === 0) return [];
    const o = outcomeOf(
      answers,
      { outcome, saved },
      {
        source: job.source,
        setup: ai.setup ?? "before-2026-10-19",
        createdAt: job.createdAt.getTime(),
        decidedAt: now.getTime(),
      },
    );
    return [
      {
        id: crypto.randomUUID(),
        importJobId: job.id,
        source: o.source,
        outcome: o.outcome,
        path: o.path,
        setup: o.setup,
        reads: JSON.stringify(o.reads),
        linesFixed: o.linesFixed,
        createdAt: new Date(o.createdAt),
        decidedAt: now,
      },
    ];
  });
  // A few at a time: D1 limits the values in one statement.
  for (let i = 0; i < rows.length; i += 10) {
    await db
      .insert(aiOutcome)
      .values(rows.slice(i, i + 10))
      .onConflictDoNothing({ target: aiOutcome.importJobId });
  }
  return rows.length;
}

/** The ingredient and method lines of saved recipes, by ID, to measure answers against. */
export async function savedLists(
  db: Database,
  recipeIds: string[],
): Promise<Map<string, OutcomeLists>> {
  const lists = new Map<string, OutcomeLists>();
  for (let i = 0; i < recipeIds.length; i += 50) {
    const rows = await db
      .select({ id: recipe.id, ingredients: recipe.ingredients, directions: recipe.directions })
      .from(recipe)
      .where(inArray(recipe.id, recipeIds.slice(i, i + 50)))
      .all();
    for (const row of rows) {
      const lines = (json: string) =>
        (JSON.parse(json) as { text: string; heading: boolean }[]).map((l) => ({
          text: l.text,
          heading: l.heading,
        }));
      lists.set(row.id, { ingredients: lines(row.ingredients), directions: lines(row.directions) });
    }
  }
  return lists;
}

/** Removes outcomes older than OUTCOME_KEEP_DAYS. Run hourly (worker/index.ts). */
export async function removeOldOutcomes(db: Database, now = Date.now()): Promise<number> {
  const removed = await db
    .delete(aiOutcome)
    .where(lt(aiOutcome.decidedAt, new Date(now - OUTCOME_KEEP_DAYS * DAY)))
    .returning({ id: aiOutcome.id })
    .all();
  return removed.length;
}
