import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { draftIssues, type RecipeDraft } from "../../shared/importDraft";
import {
  IMPORT_RULES,
  fetchableImageUrl,
  importPhotoKey,
  savedFromUrl,
  type ImportJobDetail,
  type ImportJobSummary,
  type ImportWebError,
  type ImportWebResponse,
  type WebProvenance,
} from "../../shared/importJobs";
import { ABSOLUTE_MAX_IMAGE_BYTES, detectImageType } from "../../shared/images";
import { recipeCardHtml } from "../../shared/pageSnapshot";
import { readWebRecipes } from "../../shared/webRecipe";
import { cleanText } from "../../shared/webText";
import { readCapped } from "../body";
import { importJob, recipe } from "../db/schema";
import { householdEntitlements } from "../entitlements/entitlements";
import { extensionCaller } from "../extension/routes";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import { householdMembers } from "../sync/push";
import { markImportsSaved, removeJobPhotos } from "./jobs";

// Importing recipes (phase E4; CLAUDE.md, "Import sources"). The server reads what's sent into
// drafts and keeps them in the account until the person reviews them: nothing becomes a recipe
// here. Saving is an ordinary recipe change through sync (POST /api/sync/push), which marks the
// draft saved. Each person sees only their own drafts.

type ImportEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const importRoutes = new Hono<ImportEnv>();

/** What the Chrome extension may send with its key: a page, and the photos of its drafts. */
const EXTENSION_PATHS = /^\/api\/import\/(?:web|jobs\/[^/]+\/inputs\/\d+)$/;

// Every import route needs a signed-in person. Sending a page (POST /api/import/web) and a
// draft's photos (POST /api/import/jobs/:id/inputs/:n) also take the Chrome extension's key
// instead (phase E6): the extension reads the page, and its photos, as the person's browser does,
// and sends them here. The key works on nothing else (worker/extension/routes.ts).
importRoutes.use("/api/import/*", async (c, next) => {
  const authorization = c.req.header("authorization");
  if (c.req.method === "POST" && EXTENSION_PATHS.test(c.req.path) && authorization) {
    const caller = await extensionCaller(c.env, authorization);
    if ("error" in caller) return c.json({ error: caller.error }, caller.status);
    c.set("signedIn", {
      db: caller.db,
      userId: caller.userId,
      household: caller.household,
      sessionId: "",
      impersonating: false,
    });
    return next();
  }
  return requireHousehold(c, next);
});

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** Pages read per person per minute: a guard against abuse, well past what a person does. */
const PAGES_PER_MINUTE = 30;
/** Redirects followed when fetching a draft's photo. */
const MAX_REDIRECTS = 3;
/** How long a photo's site gets to answer. */
const PHOTO_TIMEOUT_MS = 15_000;

function refuse(c: Context<ImportEnv>, error: ImportWebError, status: 400 | 403 | 413 | 422 | 429) {
  return c.json({ error }, status);
}

const summary = (row: {
  id: string;
  draft: string | null;
  provenance: string;
  createdAt: Date;
}): ImportJobSummary => {
  const draft = row.draft ? (JSON.parse(row.draft) as RecipeDraft) : null;
  const provenance = JSON.parse(row.provenance) as Partial<WebProvenance>;
  return {
    id: row.id,
    title: draft?.fields.title?.value || provenance.page?.title || "Untitled recipe",
    url: provenance.page?.url ?? null,
    createdAt: row.createdAt.toISOString(),
  };
};

// POST /api/import/web {html, url}: a web page as the browser has it (a saved page now, the
// extension's capture in E6). One draft per recipe its structured data describes.
importRoutes.post("/api/import/web", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.import_structured_enabled) return refuse(c, "import_not_included", 403);
  if (
    !(await withinRateLimit(db, `import-web:${userId}`, {
      max: PAGES_PER_MINUTE,
      windowMs: MINUTE,
    }))
  ) {
    return refuse(c, "rate_limited", 429);
  }
  // The page travels as JSON, so allow for escaping on top of the page's own size.
  const maxBody = IMPORT_RULES.pageBytes * 2;
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > maxBody) return refuse(c, "page_too_large", 413);
  const raw = await readCapped(c.req.raw, maxBody);
  if (!raw) return refuse(c, "page_too_large", 413);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return refuse(c, "invalid_request", 400);
  }
  const { html, url } = (body ?? {}) as { html?: unknown; url?: unknown };
  if (typeof html !== "string" || (url !== undefined && url !== null && typeof url !== "string")) {
    return refuse(c, "invalid_request", 400);
  }
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > IMPORT_RULES.pageBytes) return refuse(c, "page_too_large", 413);
  const pageUrl =
    (typeof url === "string" && /^https?:\/\//i.test(url) ? url : null) ?? savedFromUrl(html);

  const drafts = readWebRecipes(html, pageUrl)
    .filter((draft) => draftIssues(draft).length === 0)
    .slice(0, IMPORT_RULES.recipesPerPage);
  if (drafts.length === 0) return refuse(c, "no_recipe", 422);
  // The plan's daily number (structured_imports_per_day; none by default). Counted here, once the
  // page has a recipe, so a page without one doesn't use up the day.
  const perDay = plan.structured_imports_per_day;
  if (
    perDay !== null &&
    !(await withinRateLimit(db, `import-structured:day:${userId}`, { max: perDay, windowMs: DAY }))
  ) {
    return refuse(c, "daily_limit", 429);
  }

  let snapshot: string | null = recipeCardHtml(html, pageUrl);
  if (
    !snapshot.trim() ||
    new TextEncoder().encode(snapshot).byteLength > IMPORT_RULES.snapshotBytes
  ) {
    snapshot = null;
  }
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const now = new Date();
  const batchId = drafts.length > 1 ? crypto.randomUUID() : null;
  const rows = drafts.map((draft) => {
    const provenance: WebProvenance = {
      page: {
        url: draft.externalId ?? pageUrl,
        title: cleanText(titleMatch?.[1] ?? "", true).slice(0, 300) || null,
      },
      snapshot,
      bytes,
    };
    return {
      id: crypto.randomUUID(),
      householdId: household.householdId,
      userId,
      batchId,
      source: draft.source,
      status: "ready",
      draft: JSON.stringify(draft),
      provenance: JSON.stringify(provenance),
      error: null,
      recipeId: null,
      createdAt: now,
      updatedAt: now,
    };
  });
  await db.insert(importJob).values(rows);
  const response: ImportWebResponse = {
    jobs: rows.map((row, i) => {
      const draft = drafts[i];
      const photos = (draft?.photos ?? []).flatMap((photo) => {
        const url = draft?.inputs[photo.input]?.url;
        return photo.role === "photo" && url ? [{ input: photo.input, url }] : [];
      });
      return { ...summary(row), photos };
    }),
  };
  return c.json(response, 201);
});

/** The caller's own job, in their current household. */
async function ownJob(c: Context<ImportEnv>) {
  const { db, userId, household } = c.var.signedIn;
  const id = c.req.param("id") ?? "";
  return db
    .select()
    .from(importJob)
    .where(
      and(
        eq(importJob.id, id),
        eq(importJob.userId, userId),
        eq(importJob.householdId, household.householdId),
      ),
    )
    .get();
}

// GET /api/import/jobs: the caller's drafts waiting for review, newest first.
importRoutes.get("/api/import/jobs", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const rows = await db
    .select({
      id: importJob.id,
      draft: importJob.draft,
      provenance: importJob.provenance,
      createdAt: importJob.createdAt,
    })
    .from(importJob)
    .where(
      and(
        eq(importJob.userId, userId),
        eq(importJob.householdId, household.householdId),
        eq(importJob.status, "ready"),
      ),
    )
    .orderBy(desc(importJob.createdAt))
    .limit(100)
    .all();
  return c.json({ jobs: rows.map(summary) });
});

// GET /api/import/jobs/:id: one draft, with the copy of its page for the review screen.
importRoutes.get("/api/import/jobs/:id", async (c) => {
  const job = await ownJob(c);
  if (!job?.draft || (job.status !== "ready" && job.status !== "saved")) {
    return c.json({ error: "not_found" }, 404);
  }
  const provenance = JSON.parse(job.provenance) as Partial<WebProvenance>;
  const detail: ImportJobDetail = {
    ...summary(job),
    status: job.status as ImportJobDetail["status"],
    draft: JSON.parse(job.draft) as RecipeDraft,
    page: provenance.page ?? { url: null, title: null },
    snapshot: provenance.snapshot ?? null,
    recipeId: job.recipeId,
  };
  return c.json(detail);
});

// POST /api/import/jobs/:id/discard: the person doesn't want it. Removed at once.
importRoutes.post("/api/import/jobs/:id/discard", async (c) => {
  const job = await ownJob(c);
  if (!job || job.status !== "ready") return c.json({ error: "not_found" }, 404);
  await c.var.signedIn.db.delete(importJob).where(eq(importJob.id, job.id));
  await removeJobPhotos(c.env.IMAGES, job.id);
  return c.json({ ok: true });
});

// POST /api/import/jobs/:id/saved {recipeId}: the draft went into a recipe the household already
// had ("Update the existing recipe"). A new recipe marks its draft saved through sync instead.
importRoutes.post("/api/import/jobs/:id/saved", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const job = await ownJob(c);
  if (!job || job.status !== "ready") return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json().catch(() => null)) as { recipeId?: unknown } | null;
  const recipeId = body?.recipeId;
  if (typeof recipeId !== "string") return c.json({ error: "invalid_request" }, 400);
  const found = await db
    .select({ ownerUserId: recipe.ownerUserId })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
    .get();
  const members = await householdMembers(db, household.householdId);
  if (!found || !members.includes(found.ownerUserId)) return c.json({ error: "not_found" }, 404);
  await markImportsSaved(db, userId, [{ importJobId: job.id, recipeId }]);
  return c.json({ ok: true });
});

/**
 * Fetches a photo from the web, following a few redirects, each checked like the first: only
 * public web addresses, never this app's own.
 */
async function fetchPhoto(start: URL, ownHosts: string[]): Promise<Response | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const next = fetchableImageUrl(
      new URL(response.headers.get("location") ?? "", url).toString(),
      ownHosts,
    );
    await response.body?.cancel();
    if (!next) return null;
    url = next;
  }
  return null;
}

// GET /api/import/jobs/:id/inputs/:index: a photo the draft's page offered, fetched by the
// server (the browser can't read other sites' images). The app shows it on the review screen,
// and on save prepares and uploads it like any photo (POST /api/images/upload), so it's checked
// and counted like any other. Photos are part of Premium.
importRoutes.get("/api/import/jobs/:id/inputs/:index", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.images_enabled) return c.json({ error: "images_not_included" }, 403);
  const job = await ownJob(c);
  if (!job?.draft || job.status !== "ready") return c.json({ error: "not_found" }, 404);
  const draft = JSON.parse(job.draft) as RecipeDraft;
  const index = Number(c.req.param("index"));
  const input = draft.inputs[index];
  const ownHosts = [
    new URL(c.req.url).hostname,
    c.env.APP_HOSTNAME ?? "",
    c.env.ADMIN_HOSTNAME ?? "",
  ].map((h) => h.toLowerCase());
  if (input?.kind !== "image") return c.json({ error: "not_found" }, 404);
  const headers = {
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  // The photo the extension brought from the person's browser, when it could (phase E6).
  const brought = await c.env.IMAGES.get(importPhotoKey(job.id, index));
  if (brought) {
    return new Response(brought.body, {
      headers: { ...headers, "content-type": brought.httpMetadata?.contentType ?? "image/jpeg" },
    });
  }
  const url = fetchableImageUrl(input.url, ownHosts);
  if (!url) return c.json({ error: "not_found" }, 404);
  const perMinute = plan.image_uploads_per_minute;
  if (
    perMinute !== null &&
    !(await withinRateLimit(db, `import-photo:minute:${userId}`, {
      max: perMinute,
      windowMs: MINUTE,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  }

  let response: Response | null;
  try {
    response = await fetchPhoto(url, ownHosts);
  } catch {
    return c.json({ error: "photo_unavailable" }, 502);
  }
  if (!response?.ok) {
    await response?.body?.cancel();
    return c.json({ error: "photo_unavailable" }, 502);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ABSOLUTE_MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    return c.json({ error: "image_too_large" }, 413);
  }
  const bytes = await readCapped(response, ABSOLUTE_MAX_IMAGE_BYTES);
  if (!bytes) return c.json({ error: "image_too_large" }, 413);
  const contentType = detectImageType(bytes);
  if (!contentType) return c.json({ error: "unsupported_type" }, 415);
  return new Response(bytes, { headers: { ...headers, "content-type": contentType } });
});

// POST /api/import/jobs/:id/inputs/:index: one of the draft's photos, as the person's browser
// downloaded it (the Chrome extension, phase E6). Some sites refuse photo downloads from servers,
// so the extension brings them. Kept only until the draft is saved or removed (the review screen
// shows it, and saving uploads it to the recipe like any photo, with the usual checks). Photos are
// part of Premium; only the draft's own photo inputs; image files only, by their signature.
importRoutes.post("/api/import/jobs/:id/inputs/:index", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.images_enabled) return c.json({ error: "images_not_included" }, 403);
  const job = await ownJob(c);
  if (!job?.draft || job.status !== "ready") return c.json({ error: "not_found" }, 404);
  const draft = JSON.parse(job.draft) as RecipeDraft;
  const index = Number(c.req.param("index"));
  const isPhoto = draft.photos.some((p) => p.input === index && p.role === "photo");
  if (draft.inputs[index]?.kind !== "image" || !isPhoto) return c.json({ error: "not_found" }, 404);
  const perMinute = plan.image_uploads_per_minute;
  if (
    perMinute !== null &&
    !(await withinRateLimit(db, `import-photo:minute:${userId}`, {
      max: perMinute,
      windowMs: MINUTE,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  }
  const tooLarge = () => c.json({ error: "image_too_large" }, 413);
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > ABSOLUTE_MAX_IMAGE_BYTES) return tooLarge();
  const bytes = await readCapped(c.req.raw, ABSOLUTE_MAX_IMAGE_BYTES);
  if (!bytes) return tooLarge();
  const contentType = detectImageType(bytes);
  if (!contentType) return c.json({ error: "unsupported_type" }, 415);
  await c.env.IMAGES.put(importPhotoKey(job.id, index), bytes, { httpMetadata: { contentType } });
  return c.json({ ok: true }, 201);
});
