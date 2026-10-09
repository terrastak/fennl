import { and, eq, isNull, sql } from "drizzle-orm";
import type { ImageType } from "../../shared/images";
import type { Database } from "../db/client";
import { image, member } from "../db/schema";

// Photo storage rules (phase D1). A photo is owned by one person, named by the SHA-256 of its
// bytes, and kept in R2 as "<owner>/<hash>". The image table says who owns what and what it
// counts for; a household's usage is the sum over its members (see the comment in db/schema.ts).

export interface ImageUsage {
  bytes: number;
  count: number;
}

/** The R2 key of a person's copy of a photo. */
export const imageKey = (ownerUserId: string, hash: string) => `${ownerUserId}/${hash}`;

/** Bytes and count of every photo the household's members own (not deleted). */
export async function householdImageUsage(db: Database, householdId: string): Promise<ImageUsage> {
  const row = await db.get<{ bytes: number; count: number }>(sql`
    select coalesce(sum(bytes), 0) as bytes, count(*) as count
    from image
    where deleted_at is null
      and owner_user_id in (select user_id from member where organization_id = ${householdId})`);
  return { bytes: row?.bytes ?? 0, count: row?.count ?? 0 };
}

export interface ImageLimits {
  /** Null: no limit. */
  maxBytes: number | null;
  maxCount: number | null;
}

export type StoreResult =
  /** A new photo, now counted. */
  | { status: "stored" }
  /** This person already had this exact photo: nothing changes and nothing more is counted. */
  | { status: "existing" }
  /** Over the household's quota: nothing was stored. */
  | { status: "full"; limit: "bytes" | "count" };

async function hasLiveRow(db: Database, ownerUserId: string, hash: string): Promise<boolean> {
  const row = await db
    .select({ hash: image.hash })
    .from(image)
    .where(and(eq(image.ownerUserId, ownerUserId), eq(image.hash, hash), isNull(image.deletedAt)))
    .get();
  return Boolean(row);
}

/**
 * Counts a photo for its owner, unless that would put the household over its quota. Quota and
 * insert are one SQL statement, so two uploads at once can't both slip under the limit (D1 has no
 * interactive transactions). A photo the person removed earlier is brought back the same way.
 */
export async function countImage(
  db: Database,
  input: {
    ownerUserId: string;
    householdId: string;
    hash: string;
    bytes: number;
    contentType: ImageType;
  },
  limits: ImageLimits,
  now = new Date(),
): Promise<StoreResult> {
  const { ownerUserId, householdId, hash, bytes, contentType } = input;
  if (await hasLiveRow(db, ownerUserId, hash)) return { status: "existing" };

  const inserted = await db.all(sql`
    insert into image (owner_user_id, hash, bytes, content_type, created_at, deleted_at)
    select ${ownerUserId}, ${hash}, ${bytes}, ${contentType}, ${now.getTime()}, null
    where (${limits.maxBytes} is null or ${bytes} + (
        select coalesce(sum(bytes), 0) from image
        where deleted_at is null
          and owner_user_id in (select user_id from member where organization_id = ${householdId})
      ) <= ${limits.maxBytes})
      and (${limits.maxCount} is null or 1 + (
        select count(*) from image
        where deleted_at is null
          and owner_user_id in (select user_id from member where organization_id = ${householdId})
      ) <= ${limits.maxCount})
    on conflict (owner_user_id, hash) do update
      set deleted_at = null, bytes = excluded.bytes, content_type = excluded.content_type,
        created_at = excluded.created_at
      where image.deleted_at is not null
    returning hash`);
  if (inserted.length > 0) return { status: "stored" };

  // Nothing written: either the same photo arrived twice at once, or the quota is full.
  if (await hasLiveRow(db, ownerUserId, hash)) return { status: "existing" };
  const used = await householdImageUsage(db, householdId);
  const overBytes = limits.maxBytes !== null && used.bytes + bytes > limits.maxBytes;
  return { status: "full", limit: overBytes ? "bytes" : "count" };
}

/** Takes a photo back out of the count, for when it could not be stored after all. */
export async function uncountImage(db: Database, ownerUserId: string, hash: string, now: Date) {
  await db
    .update(image)
    .set({ deletedAt: now })
    .where(and(eq(image.ownerUserId, ownerUserId), eq(image.hash, hash)));
}

/**
 * A live photo with this hash that someone in the household owns (the caller's own copy first),
 * or undefined. This is the only access check for reading a photo: owned by a current member of
 * the caller's household (CLAUDE.md, "Access rule").
 */
export async function imageForHousehold(
  db: Database,
  householdId: string,
  callerUserId: string,
  hash: string,
) {
  const rows = await db
    .select({
      ownerUserId: image.ownerUserId,
      contentType: image.contentType,
      bytes: image.bytes,
    })
    .from(image)
    .innerJoin(member, eq(member.userId, image.ownerUserId))
    .where(
      and(eq(image.hash, hash), isNull(image.deletedAt), eq(member.organizationId, householdId)),
    )
    .all();
  return rows.find((row) => row.ownerUserId === callerUserId) ?? rows[0];
}
