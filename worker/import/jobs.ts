import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { IMPORT_RULES } from "../../shared/importJobs";
import type { Database } from "../db/client";
import { importJob } from "../db/schema";

// Import jobs (phase E4): a draft waiting for review, until it's saved as a recipe or discarded.

const DAY = 24 * 60 * 60 * 1000;

/**
 * Marks drafts saved once the recipes made from them reach the server (the push that creates a
 * recipe names its import job). Only the person's own drafts still waiting; the page's copy is
 * no longer needed, so it's dropped from the record.
 */
export async function markImportsSaved(
  db: Database,
  userId: string,
  saved: { importJobId: string; recipeId: string }[],
  now = new Date(),
): Promise<void> {
  if (saved.length === 0) return;
  const statements = saved.map(({ importJobId, recipeId }) =>
    db
      .update(importJob)
      .set({
        status: "saved",
        recipeId,
        provenance: sql`json_remove(${importJob.provenance}, '$.snapshot')`,
        updatedAt: now,
      })
      .where(
        and(
          eq(importJob.id, importJobId),
          eq(importJob.userId, userId),
          eq(importJob.status, "ready"),
        ),
      ),
  );
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

/**
 * Removes drafts nobody saved or discarded within IMPORT_RULES.keepDays (a discarded draft is
 * removed at once). Saved ones stay, as the record of where a recipe came from. Run hourly
 * (worker/index.ts).
 */
export async function removeOldImportJobs(db: Database, now = Date.now()): Promise<number> {
  const removed = await db
    .delete(importJob)
    .where(
      and(
        inArray(importJob.status, ["reading", "ready", "failed"]),
        lt(importJob.updatedAt, new Date(now - IMPORT_RULES.keepDays * DAY)),
      ),
    )
    .returning({ id: importJob.id })
    .all();
  return removed.length;
}
