import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { draftIssues, type RecipeDraft } from "../../shared/importDraft";
import {
  IMPORT_RULES,
  fetchableImageUrl,
  importPhotoKey,
  savedFromUrl,
  type AiProvenance,
  type ImportJobDetail,
  type ReadAgainError,
  type ImportJobSummary,
  type ImportPhotoSource,
  type ImportPhotosResponse,
  type ImportTextResponse,
  type PastedProvenance,
  type ImportWebError,
  type ImportWebResponse,
  type WebProvenance,
} from "../../shared/importJobs";
import { PASTED_TEXT_CHARS } from "../../shared/pastedText";
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
import { aiConfig } from "../ai/config";
import { canReadAgain, readAgain } from "../ai/read";
import { fillFromPage, importPageWithAi } from "./aiWeb";
import { markImportsSaved, recordDiscarded, removeJobPhotos } from "./jobs";
import { importPastedText } from "./pastedImport";
import { importPhotos } from "./photoImport";

// Importing recipes (phase E4; CLAUDE.md, "Import sources"). The server reads what's sent into
// drafts and keeps them in the account until the person reviews them: nothing becomes a recipe
// here. Saving is an ordinary recipe change through sync (POST /api/sync/push), which marks the
// draft saved. Each person sees only their own drafts.

type ImportEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const importRoutes = new Hono<ImportEnv>();

/** What the Chrome extension may do with its key: send a page, and send or get a draft's photos. */
const PHOTO_PATH = /^\/api\/import\/jobs\/[^/]+\/inputs\/\d+$/;
const extensionPath = (method: string, path: string) =>
  (method === "POST" && (path === "/api/import/web" || PHOTO_PATH.test(path))) ||
  (method === "GET" && PHOTO_PATH.test(path));

// Every import route needs a signed-in person. Sending a page (POST /api/import/web) and a
// draft's photos (POST /api/import/jobs/:id/inputs/:n) also take the Chrome extension's key
// instead (phase E6): the extension reads the page, and its photos, as the person's browser does,
// and sends them here. Getting a draft's photo (GET, the same address) does too, so the extension
// can tell when a site refuses Fennl its photos and offer to bring them itself. The key works on
// nothing else (worker/extension/routes.ts).
importRoutes.use("/api/import/*", async (c, next) => {
  const authorization = c.req.header("authorization");
  if (extensionPath(c.req.method, c.req.path) && authorization) {
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
/** Recipes read from photos per person per minute (phase E9): the same kind of guard. */
const PHOTO_IMPORTS_PER_MINUTE = 10;
/** Recipes read from pasted text per person per minute (phase E15): the same kind of guard. */
const TEXT_IMPORTS_PER_MINUTE = 10;
/** Redirects followed when fetching a draft's photo. */
const MAX_REDIRECTS = 3;
/** How long a photo's site gets to answer. */
const PHOTO_TIMEOUT_MS = 15_000;

function refuse(
  c: Context<ImportEnv>,
  error: ImportWebError,
  status: 400 | 403 | 413 | 422 | 429 | 503,
) {
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

/** A draft's photos on the web, for the extension to bring when the site refuses Fennl's server. */
function draftPhotos(draft: RecipeDraft | null): ImportPhotoSource[] {
  return (draft?.photos ?? []).flatMap((photo) => {
    const url = draft?.inputs[photo.input]?.url;
    return photo.role === "photo" && url ? [{ input: photo.input, url }] : [];
  });
}

// POST /api/import/web {html, url}: a web page as the browser has it (a saved page now, the
// extension's capture in E6). One draft per recipe its structured data describes; a page with
// none is read by the AI on a plan that includes it (E8).
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

  let drafts = readWebRecipes(html, pageUrl)
    .filter((draft) => draftIssues(draft).length === 0)
    .slice(0, IMPORT_RULES.recipesPerPage);
  // Phase E8: a page without recipe data is read by the AI (Premium), and data that leaves out
  // the ingredients or the method has them filled in from the page.
  const caller = { env: c.env, db, householdId: household.householdId, userId, plan };
  if (drafts.length === 0) {
    const read = await importPageWithAi(caller, html, pageUrl, bytes);
    if (!read.ok) return refuse(c, read.error, read.status);
    const rows = await db
      .select({
        id: importJob.id,
        draft: importJob.draft,
        provenance: importJob.provenance,
        createdAt: importJob.createdAt,
      })
      .from(importJob)
      .where(inArray(importJob.id, read.jobIds))
      .all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const response: ImportWebResponse = {
      jobs: read.jobIds.flatMap((id) => {
        const row = byId.get(id);
        return row
          ? [
              {
                ...summary(row),
                photos: draftPhotos(JSON.parse(row.draft ?? "null") as RecipeDraft | null),
              },
            ]
          : [];
      }),
    };
    return c.json(response, 201);
  }
  // The plan's daily number (structured_imports_per_day; none by default). Counted here, once the
  // page has a recipe, so a page without one doesn't use up the day.
  const perDay = plan.structured_imports_per_day;
  if (
    perDay !== null &&
    !(await withinRateLimit(db, `import-structured:day:${userId}`, { max: perDay, windowMs: DAY }))
  ) {
    return refuse(c, "daily_limit", 429);
  }
  drafts = await fillFromPage(caller, html, pageUrl, drafts);

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
    jobs: rows.map((row, i) => ({ ...summary(row), photos: draftPhotos(drafts[i] ?? null) })),
  };
  return c.json(response, 201);
});

// POST /api/import/photos {pages: [hash, ...]}: photos of one recipe's pages (a card's front and
// back, a few cookbook pages), already uploaded to the person's photos, read by the AI into
// drafts (phase E9; worker/import/photoImport.ts).
importRoutes.post("/api/import/photos", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.import_ai_enabled) return c.json({ error: "ai_import_not_included" }, 403);
  if (
    !(await withinRateLimit(db, `import-photos:${userId}`, {
      max: PHOTO_IMPORTS_PER_MINUTE,
      windowMs: MINUTE,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = (await c.req.json().catch(() => null)) as { pages?: unknown } | null;
  const result = await importPhotos(
    { env: c.env, db, householdId: household.householdId, userId, plan },
    body?.pages,
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  const rows = await db
    .select({
      id: importJob.id,
      draft: importJob.draft,
      provenance: importJob.provenance,
      createdAt: importJob.createdAt,
    })
    .from(importJob)
    .where(inArray(importJob.id, result.jobIds))
    .all();
  const order = new Map(result.jobIds.map((id, i) => [id, i]));
  const response: ImportPhotosResponse = {
    jobs: rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(summary),
  };
  return c.json(response, 201);
});

// POST /api/import/text {text}: recipe text pasted into the Import page (phase E15;
// worker/import/pastedImport.ts). Text that is clearly laid out is read without the AI; anything
// else by the AI on a plan that includes it.
importRoutes.post("/api/import/text", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const plan = await householdEntitlements(db, household.householdId);
  if (!plan.import_structured_enabled && !plan.import_ai_enabled) {
    return c.json({ error: "import_not_included" }, 403);
  }
  if (
    !(await withinRateLimit(db, `import-text:${userId}`, {
      max: TEXT_IMPORTS_PER_MINUTE,
      windowMs: MINUTE,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  // Characters can take up to four bytes each, and JSON escaping adds more.
  const maxBody = PASTED_TEXT_CHARS * 8 + 1024;
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > maxBody) {
    return c.json({ error: "text_too_large" }, 413);
  }
  const raw = await readCapped(c.req.raw, maxBody);
  if (!raw) return c.json({ error: "text_too_large" }, 413);
  let body: { text?: unknown } | null;
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as { text?: unknown } | null;
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const result = await importPastedText(
    { env: c.env, db, householdId: household.householdId, userId, plan },
    body?.text,
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  const rows = await db
    .select({
      id: importJob.id,
      draft: importJob.draft,
      provenance: importJob.provenance,
      createdAt: importJob.createdAt,
    })
    .from(importJob)
    .where(inArray(importJob.id, result.jobIds))
    .all();
  const order = new Map(result.jobIds.map((id, i) => [id, i]));
  const response: ImportTextResponse = {
    jobs: rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(summary),
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

/** For a draft the AI read (phase E7): whether "Read again" is on offer, or was used. */
async function aiDetail(
  c: Context<ImportEnv>,
  provenance: Partial<AiProvenance>,
): Promise<ImportJobDetail["ai"]> {
  if (!provenance.ai) return null;
  const config = await aiConfig(c.env, c.var.signedIn.db);
  return {
    canReadAgain: canReadAgain(provenance, config),
    readAgain: provenance.ai.rereadAt !== null,
  };
}

async function jobDetail(c: Context<ImportEnv>, job: typeof importJob.$inferSelect) {
  const provenance = JSON.parse(job.provenance) as Partial<
    WebProvenance & AiProvenance & PastedProvenance
  >;
  const detail: ImportJobDetail = {
    ...summary(job),
    status: job.status as ImportJobDetail["status"],
    draft: JSON.parse(job.draft ?? "null") as RecipeDraft,
    page: provenance.page ?? { url: null, title: null },
    snapshot: provenance.snapshot ?? null,
    recipeId: job.recipeId,
    pastedText: provenance.pasted?.text ?? null,
    ai: await aiDetail(c, provenance),
  };
  return detail;
}

// GET /api/import/jobs/:id: one draft, with the copy of its page for the review screen.
importRoutes.get("/api/import/jobs/:id", async (c) => {
  const job = await ownJob(c);
  if (!job?.draft || (job.status !== "ready" && job.status !== "saved")) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(await jobDetail(c, job));
});

const READ_AGAIN_STATUS: Record<ReadAgainError, 403 | 404 | 409 | 410 | 429 | 503> = {
  not_found: 404,
  already_read_again: 409,
  none_stronger: 409,
  import_not_included: 403,
  monthly_limit: 429,
  paused: 503,
  unavailable: 503,
  inputs_gone: 410,
};

// POST /api/import/jobs/:id/read-again: a draft the AI read, read once more by the next stronger
// model (phase E7, decided 2026-10-12). Once per draft; answers with the new draft.
importRoutes.post("/api/import/jobs/:id/read-again", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const plan = await householdEntitlements(db, household.householdId);
  const result = await readAgain(
    { env: c.env, db, householdId: household.householdId, userId, plan },
    c.req.param("id"),
  );
  if (!result.ok) return c.json({ error: result.problem }, READ_AGAIN_STATUS[result.problem]);
  const job = await ownJob(c);
  return job ? c.json(await jobDetail(c, job)) : c.json({ error: "not_found" }, 404);
});

// POST /api/import/jobs/:id/discard: the person doesn't want it. Removed at once.
importRoutes.post("/api/import/jobs/:id/discard", async (c) => {
  const job = await ownJob(c);
  if (!job || job.status !== "ready") return c.json({ error: "not_found" }, 404);
  await recordDiscarded(c.var.signedIn.db, job);
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
