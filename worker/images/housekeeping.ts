import type { Database } from "../db/client";

// Photo housekeeping (phase D3), run by the hourly scheduled job (worker/index.ts):
//
// 1. markUnusedImages: a photo nothing has shown for a week is removed (image.deleted_at), so it
//    stops counting towards the quota. Removed from a recipe, from a recipe deleted for good, or
//    uploaded and never added to one.
// 2. purgeDeletedImages: removed photos' R2 objects (the photo and its small copy) are deleted.
// 3. reconcileImages (once a day): image rows are compared with what is really in R2.
//
// Photos are never deleted for being over quota (CLAUDE.md, "R2 and image rules").

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * How long a photo is kept once nothing shows it, so "Undo", a device catching up, or an import
 * still being reviewed (phase E) can still use it. Decided 2026-10-09 (spec.md D3).
 */
export const UNUSED_DAYS = 7;

/** Rows per run for each step, so one run stays well within a scheduled Worker's limits. */
const ROWS_PER_RUN = 500;

/**
 * Removes photos nothing has shown for UNUSED_DAYS: no recipe photo uses them, and none stopped
 * using them in that time. One statement, so a photo added to a recipe at the same moment either
 * keeps it or (if this ran first) is turned away and can be uploaded again. Returns how many.
 *
 * Anything else that comes to hold on to a photo (version history, import drafts) must be added
 * to the "in use" test here.
 */
export async function markUnusedImages(db: Database, now = Date.now()): Promise<number> {
  const cutoff = now - UNUSED_DAYS * DAY;
  const result = await db.$client
    .prepare(
      `update image set deleted_at = ?1
      where rowid in (
        select i.rowid from image i
        where i.deleted_at is null and i.created_at < ?2
          and not exists (
            select 1 from recipe_photo p
            where p.owner_user_id = i.owner_user_id and p.image_hash = i.hash
              and (p.deleted_at is null or p.updated_at >= ?2))
        limit ?3)
      returning hash`,
    )
    .bind(now, cutoff, ROWS_PER_RUN)
    .all();
  return result.results.length;
}

const keysOf = (rows: { owner: string; hash: string }[]) =>
  rows.flatMap((r) => [`${r.owner}/${r.hash}`, `${r.owner}/${r.hash}.thumb`]);

/**
 * Deletes removed photos' R2 objects. Each is claimed first (purged_at), which keeps the same
 * photo from being added again until the deletion is over (countImage), so a new copy is never
 * deleted with the old one (PURGE_WINDOW_MS in images.ts). If R2 fails, the claims are let go and the next run tries again.
 * Returns how many photos' objects were deleted.
 */
export async function purgeDeletedImages(
  db: Database,
  bucket: R2Bucket,
  now = Date.now(),
): Promise<number> {
  const claimed = await db.$client
    .prepare(
      `update image set purged_at = ?1
      where rowid in (
        select rowid from image where deleted_at is not null and purged_at is null limit ?2)
      returning owner_user_id as owner, hash`,
    )
    .bind(now, ROWS_PER_RUN)
    .all<{ owner: string; hash: string }>();
  const rows = claimed.results;
  if (rows.length === 0) return 0;
  try {
    // Two keys per photo; R2 deletes up to 1000 at once.
    const keys = keysOf(rows);
    for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
  } catch (error) {
    await db.$client
      .prepare("update image set purged_at = null where purged_at = ?1")
      .bind(now)
      .run();
    throw error;
  }
  return rows.length;
}

/** What a reconcile found and did. Keys are R2 keys. */
export interface ReconcileReport {
  /** Objects in R2, and image rows, looked at. */
  objects: number;
  rows: number;
  /** Whether every object was listed (missing photos are only judged then). */
  complete: boolean;
  /** Objects no photo row accounts for, deleted. */
  removed: string[];
  /** Photos counted for someone whose object isn't in R2. Can't be repaired; logged. */
  missing: string[];
  /** Rows whose size didn't match the object, corrected to the object's. */
  fixedSizes: string[];
  /** Rows whose small copy was recorded wrongly (present, missing, or another size), corrected. */
  fixedThumbs: string[];
  /** Objects whose name isn't a photo's, left alone. */
  unknown: string[];
}

const KEY = /^([^/]+)\/([0-9a-f]{64})(\.thumb)?$/;

interface Row {
  owner: string;
  hash: string;
  bytes: number;
  thumbBytes: number | null;
  createdAt: number;
  deletedAt: number | null;
  purgedAt: number | null;
}

/**
 * Compares image rows with what's in R2 (spec.md D3): the quota counts rows, so they must match
 * the stored objects. Objects nothing accounts for are deleted; sizes are corrected to the
 * objects'; photos whose object has gone are reported. Anything changed in the last hour is left
 * alone, as an upload may be half done.
 *
 * It reads every row and lists the whole bucket, which suits the beta's size. With many more
 * photos it should work through one owner ("<owner>/" prefix) at a time instead.
 */
export async function reconcileImages(
  db: Database,
  bucket: R2Bucket,
  now = Date.now(),
  maxPages = 200,
): Promise<ReconcileReport> {
  const found = await db.$client
    .prepare(
      `select owner_user_id as owner, hash, bytes, thumb_bytes as thumbBytes,
        created_at as createdAt, deleted_at as deletedAt, purged_at as purgedAt
      from image`,
    )
    .all<Row>();
  const rows = new Map(found.results.map((r) => [`${r.owner}/${r.hash}`, r]));
  const settled = (time: number) => time < now - HOUR;

  const report: ReconcileReport = {
    objects: 0,
    rows: rows.size,
    complete: false,
    removed: [],
    missing: [],
    fixedSizes: [],
    fixedThumbs: [],
    unknown: [],
  };
  const fixes: { sql: string; params: unknown[] }[] = [];
  const photos = new Set<string>();
  const thumbs = new Set<string>();

  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const listed = await bucket.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const object of listed.objects) {
      report.objects += 1;
      const match = KEY.exec(object.key);
      if (!match) {
        report.unknown.push(object.key);
        continue;
      }
      const base = `${match[1]}/${match[2]}`;
      const small = Boolean(match[3]);
      const row = rows.get(base);
      if (!row || row.purgedAt !== null) {
        // Nobody's photo, or one already deleted: left over.
        if (settled(object.uploaded.getTime())) report.removed.push(object.key);
        continue;
      }
      // Removed and waiting for purgeDeletedImages, or too new to judge.
      if (row.deletedAt !== null || !settled(row.createdAt)) continue;
      const where = "where owner_user_id = ?2 and hash = ?3 and deleted_at is null";
      if (small) {
        thumbs.add(base);
        if (row.thumbBytes !== object.size) {
          report.fixedThumbs.push(object.key);
          fixes.push({
            sql: `update image set thumb_bytes = ?1 ${where}`,
            params: [object.size, row.owner, row.hash],
          });
        }
      } else {
        photos.add(base);
        if (row.bytes !== object.size) {
          report.fixedSizes.push(object.key);
          fixes.push({
            sql: `update image set bytes = ?1 ${where}`,
            params: [object.size, row.owner, row.hash],
          });
        }
      }
    }
    if (!listed.truncated) {
      report.complete = true;
      break;
    }
    cursor = listed.cursor;
  }

  if (report.complete) {
    for (const [base, row] of rows) {
      if (row.deletedAt !== null || !settled(row.createdAt)) continue;
      if (!photos.has(base)) report.missing.push(base);
      if (row.thumbBytes !== null && !thumbs.has(base)) {
        // The list shows the photo itself until a small copy is sent again.
        report.fixedThumbs.push(`${base}.thumb`);
        fixes.push({
          sql: "update image set thumb_bytes = null where owner_user_id = ?1 and hash = ?2",
          params: [row.owner, row.hash],
        });
      }
    }
  }

  for (let i = 0; i < report.removed.length; i += 1000) {
    await bucket.delete(report.removed.slice(i, i + 1000));
  }
  const d1 = db.$client;
  for (let i = 0; i < fixes.length; i += 50) {
    await d1.batch(fixes.slice(i, i + 50).map((f) => d1.prepare(f.sql).bind(...f.params)));
  }
  return report;
}

/** Whether a scheduled run is the day's reconcile (once a day, at 03:xx UTC). */
export function isReconcileRun(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCHours() === 3;
}
