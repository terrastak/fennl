import { Hono, type Context } from "hono";
import { ABSOLUTE_MAX_IMAGE_BYTES, detectImageType, isImageHash } from "../../shared/images";
import { and, eq } from "drizzle-orm";
import { image } from "../db/schema";
import { householdEntitlements } from "../entitlements/entitlements";
import { householdMembers } from "../sync/push";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import {
  countImage,
  householdImageUsage,
  imageForHousehold,
  imageKey,
  thumbKey,
  uncountImage,
} from "./images";

// Photo upload and serving (phase D1; CLAUDE.md, "R2 and image rules"). Photos reach R2 only
// through here, only after the plan, rate limit, size, file type and quota checks, and leave it
// only to the household that owns them. Clients never get R2 addresses or credentials.

export const imageRoutes = new Hono<{ Bindings: Env; Variables: { signedIn: SignedIn } }>();

imageRoutes.use("/api/images/*", requireHousehold);

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** The request body, or null as soon as it is more than `max` bytes. Never holds more than that. */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Whose photo it will be: ?owner=, someone in the caller's household (a photo on a recipe belongs
 * to the recipe's owner, phase D2), or the caller. Null for anyone else.
 */
async function ownerFrom(signedIn: SignedIn, asked: string | undefined): Promise<string | null> {
  if (!asked || asked === signedIn.userId) return signedIn.userId;
  const people = await householdMembers(signedIn.db, signedIn.household.householdId);
  return people.includes(asked) ? asked : null;
}

/** Thumbnails are small (about 480 px); anything bigger isn't one. A format bound, not a plan limit. */
const THUMB_MAX_BYTES = 512 * 1024;

// POST /api/images/upload[?owner=]: the photo's bytes as the request body. Answers with its hash,
// which is its name from then on.
imageRoutes.post("/api/images/upload", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.images_enabled) return c.json({ error: "images_not_included" }, 403);
  const owner = await ownerFrom(c.var.signedIn, c.req.query("owner"));
  if (!owner) return c.json({ error: "not_found" }, 404);

  // Rate limits first, counting every attempt, rejected ones too (spec.md D1, step 6). A limit
  // of null means none.
  const perMinute = plan.image_uploads_per_minute;
  if (
    perMinute !== null &&
    !(await withinRateLimit(db, `image-upload:minute:${userId}`, {
      max: perMinute,
      windowMs: MINUTE,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  }
  const perDay = plan.image_uploads_per_day;
  if (
    perDay !== null &&
    !(await withinRateLimit(db, `image-upload:day:${household.householdId}`, {
      max: perDay,
      windowMs: DAY,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429, { "retry-after": String(DAY / 1000) });
  }

  const maxFileBytes = Math.min(plan.image_max_file_bytes ?? Infinity, ABSOLUTE_MAX_IMAGE_BYTES);
  const tooLarge = () => c.json({ error: "image_too_large", maxBytes: maxFileBytes }, 413);
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > maxFileBytes) return tooLarge();
  const bytes = await readCapped(c.req.raw, maxFileBytes);
  if (!bytes) return tooLarge();

  const contentType = detectImageType(bytes);
  if (!contentType) return c.json({ error: "unsupported_type" }, 415);

  const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
  const key = imageKey(owner, hash);
  const now = new Date();
  const result = await countImage(
    db,
    {
      ownerUserId: owner,
      householdId: household.householdId,
      hash,
      bytes: bytes.byteLength,
      contentType,
    },
    { maxBytes: plan.image_quota_bytes, maxCount: plan.image_quota_count },
    now,
  );
  if (result.status === "full") {
    return c.json({ error: "image_quota_full", limit: result.limit }, 403);
  }

  // The same photo again only needs its stored copy checked; otherwise store it. If storing
  // fails the photo is taken back out of the count, so nothing is counted that isn't there.
  try {
    if (result.status === "stored" || !(await c.env.IMAGES.head(key))) {
      await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
    }
  } catch (error) {
    console.error("Couldn't store a photo", error);
    if (result.status === "stored") await uncountImage(db, owner, hash, now);
    return c.json({ error: "storage_failed" }, 503);
  }

  const used = await householdImageUsage(db, household.householdId);
  return c.json(
    {
      hash,
      bytes: bytes.byteLength,
      contentType,
      url: `/api/images/${hash}`,
      usage: {
        ...used,
        maxBytes: plan.image_quota_bytes,
        maxCount: plan.image_quota_count,
      },
    },
    result.status === "stored" ? 201 : 200,
  );
});

// POST /api/images/:hash/thumb[?owner=]: the small copy of a photo already uploaded (phase D2),
// for lists. Not counted in the quota; checked like any upload, within the per-minute limit.
imageRoutes.post("/api/images/:hash/thumb", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const hash = c.req.param("hash");
  if (!isImageHash(hash)) return c.json({ error: "not_found" }, 404);
  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.images_enabled) return c.json({ error: "images_not_included" }, 403);
  const owner = await ownerFrom(c.var.signedIn, c.req.query("owner"));
  if (!owner) return c.json({ error: "not_found" }, 404);
  const perMinute = plan.image_uploads_per_minute;
  if (
    perMinute !== null &&
    !(await withinRateLimit(db, `image-thumb:minute:${userId}`, {
      max: perMinute,
      windowMs: MINUTE,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  }
  const stored = await db
    .select({ deletedAt: image.deletedAt })
    .from(image)
    .where(and(eq(image.ownerUserId, owner), eq(image.hash, hash)))
    .get();
  if (!stored || stored.deletedAt) return c.json({ error: "not_found" }, 404);
  const tooLarge = () => c.json({ error: "image_too_large", maxBytes: THUMB_MAX_BYTES }, 413);
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > THUMB_MAX_BYTES) return tooLarge();
  const bytes = await readCapped(c.req.raw, THUMB_MAX_BYTES);
  if (!bytes) return tooLarge();
  const contentType = detectImageType(bytes);
  if (!contentType) return c.json({ error: "unsupported_type" }, 415);
  await c.env.IMAGES.put(thumbKey(owner, hash), bytes, { httpMetadata: { contentType } });
  await db
    .update(image)
    .set({ thumbBytes: bytes.byteLength })
    .where(and(eq(image.ownerUserId, owner), eq(image.hash, hash)));
  return c.json({ hash, bytes: bytes.byteLength }, 201);
});

// GET /api/images/:hash: a photo owned by someone in the caller's household. Allowed whatever the
// plan, so a lapsed account can still see and download its photos during the 90-day grace period
// (CLAUDE.md, "Lapsed subscriptions"). Anyone else's photo, and any photo that doesn't exist,
// look the same: not found.
async function serveImage(
  c: Context<{ Bindings: Env; Variables: { signedIn: SignedIn } }>,
  small: boolean,
) {
  const { db, userId, household } = c.var.signedIn;
  const hash = c.req.param("hash") ?? "";
  if (!isImageHash(hash)) return c.json({ error: "not_found" }, 404);
  const found = await imageForHousehold(db, household.householdId, userId, hash);
  if (!found) return c.json({ error: "not_found" }, 404);

  // The small copy, when there is one; otherwise the photo itself, kept only an hour (so a
  // small copy uploaded later is picked up).
  const thumb = small && found.thumbBytes !== null;
  const tag = `"${hash}${thumb ? ".thumb" : small ? ".full" : ""}"`;
  // A photo never changes (its name is its content), so it can be kept for a year. "private":
  // shared caches must not keep it, since only its household may see it.
  const headers = {
    "cache-control": `private, max-age=${small && !thumb ? 3600 : 31536000}${small && !thumb ? "" : ", immutable"}`,
    etag: tag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  if (c.req.header("if-none-match") === tag) {
    return new Response(null, { status: 304, headers });
  }
  const object = await c.env.IMAGES.get(
    thumb ? thumbKey(found.ownerUserId, hash) : imageKey(found.ownerUserId, hash),
  );
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      ...headers,
      "content-type": thumb
        ? (object.httpMetadata?.contentType ?? "image/webp")
        : found.contentType,
      "content-length": String(object.size),
    },
  });
}

imageRoutes.get("/api/images/:hash", (c) => serveImage(c, false));

// GET /api/images/:hash/thumb: the small copy for lists (phase D2), or the photo if it has none.
imageRoutes.get("/api/images/:hash/thumb", (c) => serveImage(c, true));
