import { Hono } from "hono";
import { ABSOLUTE_MAX_IMAGE_BYTES, detectImageType, isImageHash } from "../../shared/images";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import {
  countImage,
  householdImageUsage,
  imageForHousehold,
  imageKey,
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

// POST /api/images/upload: the photo's bytes as the request body. Answers with its hash, which
// is its name from then on.
imageRoutes.post("/api/images/upload", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.images_enabled) return c.json({ error: "images_not_included" }, 403);

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
  const key = imageKey(userId, hash);
  const now = new Date();
  const result = await countImage(
    db,
    {
      ownerUserId: userId,
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
    if (result.status === "stored") await uncountImage(db, userId, hash, now);
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

// GET /api/images/:hash: a photo owned by someone in the caller's household. Allowed whatever the
// plan, so a lapsed account can still see and download its photos during the 90-day grace period
// (CLAUDE.md, "Lapsed subscriptions"). Anyone else's photo, and any photo that doesn't exist,
// look the same: not found.
imageRoutes.get("/api/images/:hash", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const hash = c.req.param("hash");
  if (!isImageHash(hash)) return c.json({ error: "not_found" }, 404);
  const found = await imageForHousehold(db, household.householdId, userId, hash);
  if (!found) return c.json({ error: "not_found" }, 404);

  // A photo never changes (its name is its content), so it can be kept for a year. "private":
  // shared caches must not keep it, since only its household may see it.
  const headers = {
    "cache-control": "private, max-age=31536000, immutable",
    etag: `"${hash}"`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  if (c.req.header("if-none-match") === `"${hash}"`) {
    return new Response(null, { status: 304, headers });
  }
  const object = await c.env.IMAGES.get(imageKey(found.ownerUserId, hash));
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      ...headers,
      "content-type": found.contentType,
      "content-length": String(found.bytes),
    },
  });
});
