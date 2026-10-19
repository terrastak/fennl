import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { IMPORT_PHOTO_PREFIX, IMPORT_RULES } from "../../shared/importJobs";
import type { Database } from "../db/client";
import { importJob } from "../db/schema";
import { recordOutcomes, savedLists, type DecidedJob } from "../ai/outcomes";

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
  // The drafts still waiting, as they were: an AI-read one gets its outcome recorded below.
  const waiting = await db
    .select()
    .from(importJob)
    .where(
      and(
        inArray(
          importJob.id,
          saved.map((s) => s.importJobId),
        ),
        eq(importJob.userId, userId),
        eq(importJob.status, "ready"),
      ),
    )
    .all();
  const statements = saved.map(({ importJobId, recipeId }) =>
    db
      .update(importJob)
      .set({
        status: "saved",
        recipeId,
        // The answers kept for the outcome go too; the outcome keeps only their scores.
        provenance: sql`json_remove(${importJob.provenance}, '$.snapshot', '$.ai.answers')`,
        updatedAt: now,
      })
      .where(
        and(
          eq(importJob.id, importJobId),
          eq(importJob.userId, userId),
          eq(importJob.status, "ready"),
        ),
      )
      .returning({ id: importJob.id }),
  );
  const [first, ...rest] = statements;
  if (!first) return;
  const updated = new Set((await db.batch([first, ...rest])).flat().map((row) => row.id));
  const decided = waiting.filter((job) => updated.has(job.id));
  if (decided.length === 0) return;
  // How the AI's answers compare with what was saved (worker/ai/outcomes.ts).
  const recipeOf = new Map(saved.map((s) => [s.importJobId, s.recipeId]));
  const lists = await savedLists(db, [...new Set(decided.map((j) => recipeOf.get(j.id) ?? ""))]);
  await recordOutcomes(
    db,
    decided.map((job) => ({
      job,
      outcome: "saved" as const,
      saved: lists.get(recipeOf.get(job.id) ?? "") ?? null,
    })),
    now,
  );
}

/** Records that a draft was discarded (an AI-read one's outcome), before it's removed. */
export async function recordDiscarded(db: Database, job: DecidedJob, now = new Date()) {
  await recordOutcomes(db, [{ job, outcome: "discarded", saved: null }], now);
}

/**
 * Removes drafts nobody saved or discarded within IMPORT_RULES.keepDays (a discarded draft is
 * removed at once). Saved ones stay, as the record of where a recipe came from. Run hourly
 * (worker/index.ts).
 */
export async function removeOldImportJobs(db: Database, now = Date.now()): Promise<number> {
  const old = and(
    inArray(importJob.status, ["reading", "ready", "failed"]),
    lt(importJob.updatedAt, new Date(now - IMPORT_RULES.keepDays * DAY)),
  );
  // An AI-read draft nobody reviewed is an outcome too (worker/ai/outcomes.ts).
  const unreviewed = await db.select().from(importJob).where(old).limit(500).all();
  await recordOutcomes(
    db,
    unreviewed.map((job) => ({ job, outcome: "expired" as const, saved: null })),
    new Date(now),
  );
  // Up to 500 an hour: the rest go on the next runs, each with its outcome.
  let removed = 0;
  for (let i = 0; i < unreviewed.length; i += 50) {
    const ids = unreviewed.slice(i, i + 50).map((job) => job.id);
    const rows = await db
      .delete(importJob)
      .where(and(old, inArray(importJob.id, ids)))
      .returning({ id: importJob.id })
      .all();
    removed += rows.length;
  }
  return removed;
}

/** Removes the photos the extension brought for one draft (phase E6). */
export async function removeJobPhotos(bucket: R2Bucket, jobId: string): Promise<void> {
  const listed = await bucket.list({ prefix: `${IMPORT_PHOTO_PREFIX}${jobId}/` });
  const keys = listed.objects.map((o) => o.key);
  if (keys.length > 0) await bucket.delete(keys);
}

/**
 * Removes the photos the extension brought for drafts no longer waiting for review: saved (the
 * recipe has its own copies by then), discarded, or removed for age. Run hourly (worker/index.ts).
 * Photos for a draft made in the last hour are left alone, as it may still be being saved.
 */
export async function removeImportPhotos(
  db: Database,
  bucket: R2Bucket,
  now = Date.now(),
): Promise<number> {
  const keys: { key: string; jobId: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const listed = await bucket.list({
      prefix: IMPORT_PHOTO_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const object of listed.objects) {
      const jobId = object.key.slice(IMPORT_PHOTO_PREFIX.length).split("/")[0];
      if (jobId && object.uploaded.getTime() < now - 60 * 60 * 1000) {
        keys.push({ key: object.key, jobId });
      }
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  if (keys.length === 0) return 0;
  const jobIds = [...new Set(keys.map((k) => k.jobId))];
  const waiting = new Set<string>();
  for (let i = 0; i < jobIds.length; i += 50) {
    const rows = await db
      .select({ id: importJob.id })
      .from(importJob)
      .where(and(inArray(importJob.id, jobIds.slice(i, i + 50)), eq(importJob.status, "ready")))
      .all();
    for (const row of rows) waiting.add(row.id);
  }
  const done = keys.filter((k) => !waiting.has(k.jobId)).map((k) => k.key);
  for (let i = 0; i < done.length; i += 1000) await bucket.delete(done.slice(i, i + 1000));
  return done.length;
}
