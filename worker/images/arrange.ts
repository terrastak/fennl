import { Hono } from "hono";
import { detectImageType } from "../../shared/images";
import {
  arrangedByHand,
  arrangedOrder,
  photosKey,
  type PhotoLabels,
  type PhotoOrderResponse,
} from "../../shared/photoOrder";
import type { DirectionStep, PhotoArranger, RecipePhoto } from "../../shared/recipe";
import { isRecipeId } from "../../shared/duplicates";
import { galleryLabels, labelPhotos } from "../ai/arrange";
import type { ImageType } from "../ai/provider";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import { imageKey } from "./images";

// POST /api/photos/arrange (phase D4; spec.md D4): Fennl's order for a recipe's photos. The AI
// looks at their small copies beside the recipe's method (once per set of photos: its answer is
// kept in photo_arrangement), and shared/photoOrder.ts turns that into an order. Without the AI
// (paused, the household's hidden cost limit, an error) the order is by when the photos were
// taken. The app saves the order through sync, as ordinary photo changes; this only answers.

type SessionEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const arrangeRoutes = new Hono<SessionEnv>();

arrangeRoutes.use("/api/photos/arrange", requireHousehold);

/** Asks per person per minute: arranging happens after photos are added, not often. */
const ARRANGES_PER_MINUTE = 30;

/** The photo types the AI reads (not AVIF). */
const READABLE: ImageType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** A full-size photo is shown to the AI only when it has no small copy, and only up to this. */
const MAX_FULL_BYTES = 5 * 1024 * 1024;

interface PhotoRow {
  id: string;
  recipe_id: string;
  owner_user_id: string;
  image_hash: string;
  role: string;
  width: number;
  height: number;
  sort_order: number;
  added_by_user_id: string;
  taken_at: number | null;
  arranged_by: string | null;
}

const toPhoto = (row: PhotoRow): RecipePhoto => ({
  id: row.id,
  recipeId: row.recipe_id,
  imageHash: row.image_hash,
  role: "photo",
  width: row.width,
  height: row.height,
  sortOrder: row.sort_order,
  addedByUserId: row.added_by_user_id,
  takenAt: row.taken_at,
  arrangedBy: (row.arranged_by as PhotoArranger | null) ?? null,
  updatedAt: "",
  deletedAt: null,
  serverSeq: 0,
});

arrangeRoutes.post("/api/photos/arrange", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  if (
    !(await withinRateLimit(db, `arrange-photos:${userId}`, {
      max: ARRANGES_PER_MINUTE,
      windowMs: 60_000,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = (await c.req.json<unknown>().catch(() => null)) as { recipeId?: unknown } | null;
  const recipeId = body?.recipeId;
  if (!isRecipeId(recipeId)) return c.json({ error: "invalid_request" }, 400);

  const d1 = db.$client;
  const recipe = await d1
    .prepare(
      `select r.id, r.title, r.directions from recipe r
        where r.id = ?1 and r.expunged_at is null
          and r.owner_user_id in (select user_id from member where organization_id = ?2)`,
    )
    .bind(recipeId, household.householdId)
    .first<{ id: string; title: string; directions: string }>();
  if (!recipe) return c.json({ error: "not_found" }, 404);
  const rows = await d1
    .prepare(
      `select id, recipe_id, owner_user_id, image_hash, role, width, height, sort_order,
          added_by_user_id, taken_at, arranged_by
        from recipe_photo
        where recipe_id = ?1 and role = 'photo' and deleted_at is null
        order by sort_order, id`,
    )
    .bind(recipeId)
    .all<PhotoRow>();
  const gallery = rows.results.map(toPhoto);
  const answer = (order: RecipePhoto[], by: PhotoOrderResponse["by"]) =>
    c.json({ order: order.map((p) => p.id), by } satisfies PhotoOrderResponse);
  if (gallery.length < 2) return answer(gallery, "unchanged");
  if (arrangedByHand(gallery)) return answer(gallery, "person");

  // The same photos as last time: the AI's answer then still stands.
  const key = photosKey(gallery.map((p) => p.imageHash));
  const kept = await d1
    .prepare("select photos_key, labels from photo_arrangement where recipe_id = ?1")
    .bind(recipeId)
    .first<{ photos_key: string; labels: string }>();
  if (kept?.photos_key === key) {
    const byHash = JSON.parse(kept.labels) as Record<string, PhotoLabels["photos"][number]> & {
      cover?: string;
    };
    const labels: PhotoLabels = {
      photos: gallery.map((p) => byHash[p.imageHash] ?? null),
      cover: Math.max(
        0,
        gallery.findIndex((p) => p.imageHash === byHash.cover),
      ),
    };
    return answer(arrangedOrder(gallery, labels), "fennl");
  }

  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.images_enabled) return answer(arrangedOrder(gallery, null), "time");

  // The photos' small copies, as the AI reads them.
  const shown: number[] = [];
  const photos: { mediaType: ImageType; bytes: Uint8Array }[] = [];
  for (const [at, photo] of gallery.entries()) {
    const owner = rows.results[at]?.owner_user_id ?? "";
    let object = await c.env.IMAGES.get(`${imageKey(owner, photo.imageHash)}.thumb`);
    if (!object) {
      const full = await c.env.IMAGES.head(imageKey(owner, photo.imageHash));
      object = full && full.size <= MAX_FULL_BYTES ? await c.env.IMAGES.get(full.key) : null;
    }
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const type = detectImageType(bytes);
    if (!type || !(READABLE as string[]).includes(type)) continue;
    shown.push(at);
    photos.push({ mediaType: type as ImageType, bytes });
  }
  if (shown.length < 2) return answer(arrangedOrder(gallery, null), "time");

  const steps = (JSON.parse(recipe.directions) as DirectionStep[])
    .filter((line) => !line.heading)
    .map((line) => line.text);
  const read = await labelPhotos(
    { env: c.env, db, householdId: household.householdId, userId, plan },
    { title: recipe.title, steps, photos },
  );
  if (!read.ok) return answer(arrangedOrder(gallery, null), "time");
  const labels = galleryLabels(gallery.length, shown, read.labels);

  // Kept by image, so the answer still applies when the photos are moved around.
  const byHash: Record<string, unknown> = { cover: gallery[labels.cover]?.imageHash ?? "" };
  gallery.forEach((p, at) => {
    byHash[p.imageHash] = labels.photos[at] ?? null;
  });
  await d1
    .prepare(
      `insert into photo_arrangement (recipe_id, photos_key, labels, created_at)
        values (?1, ?2, ?3, ?4)
        on conflict (recipe_id) do update set photos_key = ?2, labels = ?3, created_at = ?4`,
    )
    .bind(recipeId, key, JSON.stringify(byHash), Date.now())
    .run();
  return answer(arrangedOrder(gallery, labels), "fennl");
});
