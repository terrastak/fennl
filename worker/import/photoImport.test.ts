import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RecipeDraft } from "../../shared/importDraft";
import {
  IMPORT_RULES,
  type AiProvenance,
  type ImportPhotosResponse,
} from "../../shared/importJobs";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "../../shared/recipe";
import type { ChangeResult } from "../../shared/sync";
import { FAKE_TOKENS, fakeAi } from "../ai/fake";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { image, importJob } from "../db/schema";
import { markUnusedImages } from "../images/housekeeping";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";

// Phase E9: photos of a recipe's pages, uploaded to the person's photos, then read by the AI
// into a draft. The pages are stored once: the draft reads them from the person's photos, and
// they stay while the draft waits for review.

const db = () => database(env.DB);
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await setUpDatabase();
});

afterEach(() => {
  fakeAi.reset();
});

let counter = 0;

interface Person {
  v: Visitor;
  userId: string;
  deviceId: string;
}

async function person(premium = true): Promise<Person> {
  const v = await signUpConfirmed(`pages-${++counter}@example.com`);
  if (premium) {
    const code = await createCode(
      db(),
      {
        code: `PAGES-${counter}`,
        label: "Photo import tests",
        tier: "individual",
        access: { forever: true },
        allowsSignUp: true,
        maxUses: null,
        redeemBy: null,
      },
      null,
    );
    expect((await v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(200);
  }
  const deviceId = crypto.randomUUID();
  expect((await v.request("/api/devices/register", { body: { deviceId } })).status).toBe(200);
  return { v, userId: (await v.session())!.user.id, deviceId };
}

/** Bytes that start like a WebP and differ each time. */
function page(size = 256): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([...new TextEncoder().encode("RIFF")], 0);
  bytes.set([...new TextEncoder().encode("WEBP")], 8);
  const seed = ++counter;
  for (let i = 12; i < size; i++) bytes[i] = (seed * 31 + i * 7) % 251;
  return bytes;
}

async function upload(p: Person, bytes = page()): Promise<string> {
  const res = await p.v.request(`/api/images/upload?owner=${p.userId}`, { bytes });
  expect(res.status).toBe(201);
  return ((await res.json()) as { hash: string }).hash;
}

const importPages = (p: Person, pages: unknown, screenshots?: boolean) =>
  p.v.request("/api/import/photos", { body: { pages, screenshots } });

async function jobRow(id: string) {
  return (await db().select().from(importJob).where(eq(importJob.id, id)).get())!;
}

describe("importing photos of a recipe", () => {
  it("reads the pages, in order, into a draft that keeps them as import originals", async () => {
    const p = await person();
    const front = await upload(p);
    const back = await upload(p);
    const res = await importPages(p, [front, back]);
    expect(res.status).toBe(201);
    const { jobs } = (await res.json()) as ImportPhotosResponse;
    expect(jobs).toHaveLength(1);

    const job = await jobRow(jobs[0]!.id);
    expect(job.source).toBe("photo");
    const draft = JSON.parse(job.draft!) as RecipeDraft;
    expect(draft.inputs.map((i) => [i.kind, i.imageHash])).toEqual([
      ["image", front],
      ["image", back],
    ]);
    expect(draft.photos).toEqual([
      { input: 0, role: "import_original" },
      { input: 1, role: "import_original" },
    ]);
    // Read from the person's photos, not copied.
    const { ai } = JSON.parse(job.provenance) as AiProvenance;
    expect(ai.parts.map((part) => ("key" in part ? part.key : null))).toEqual([
      `${p.userId}/${front}`,
      `${p.userId}/${back}`,
    ]);
    expect(ai.parts.map((part) => part.label)).toEqual(["Photo 1 of 2", "Photo 2 of 2"]);
    expect((await env.IMAGES.list({ prefix: `imports/${job.id}/` })).objects).toHaveLength(0);

    // "Read again" reads them from there too.
    const again = await p.v.request(`/api/import/jobs/${job.id}/read-again`, { body: {} });
    expect(again.status).toBe(200);
  });

  it("reads screenshots as screenshots, when the app says every page is one (phase E11)", async () => {
    const p = await person();
    const first = await upload(p);
    const second = await upload(p);
    const { jobs } = (await (
      await importPages(p, [first, second], true)
    ).json()) as ImportPhotosResponse;
    const job = await jobRow(jobs[0]!.id);
    expect(job.source).toBe("screenshot");
    const draft = JSON.parse(job.draft!) as RecipeDraft;
    expect(draft.source).toBe("screenshot");
    expect(draft.inputs.map((i) => i.name)).toEqual(["Screenshot 1", "Screenshot 2"]);
    const { ai } = JSON.parse(job.provenance) as AiProvenance;
    expect(ai.parts.map((part) => part.label)).toEqual(["Screenshot 1 of 2", "Screenshot 2 of 2"]);
    // Told what screenshots hold, and to leave out the app around the recipe.
    const asked = fakeAi.requests[0]!;
    expect(asked.instruction).toContain("These are screenshots of a recipe");
    expect(asked.instruction).toContain("likes, views, comments");
    expect(asked.instruction).toContain("give it once");
    // Kept as originals, as photos are.
    expect(draft.photos).toEqual([
      { input: 0, role: "import_original" },
      { input: 1, role: "import_original" },
    ]);
    // Anything but true reads them as photos.
    const { jobs: photoJobs } = (await (
      await importPages(p, [first], "yes" as unknown as boolean)
    ).json()) as ImportPhotosResponse;
    expect((await jobRow(photoJobs[0]!.id)).source).toBe("photo");
  });

  it("is part of Premium", async () => {
    const free = await person(false);
    const res = await importPages(free, ["a".repeat(64)]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_included" });
  });

  it("takes only the person's own photos, a few pages at a time", async () => {
    const p = await person();
    const other = await person();
    const theirs = await upload(other);
    const missing = await importPages(p, [theirs]);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "page_missing" });

    expect((await importPages(p, [])).status).toBe(400);
    expect((await importPages(p, ["not a hash"])).status).toBe(400);
    const tooMany = await importPages(
      p,
      Array.from({ length: IMPORT_RULES.photoPages + 1 }, () => theirs),
    );
    expect(tooMany.status).toBe(413);
    expect(await tooMany.json()).toEqual({ error: "too_many_pages" });
  });

  it("says when the AI found no recipe", async () => {
    const p = await person();
    const hash = await upload(p);
    fakeAi.reply = () => ({ ok: true, output: { recipes: [] }, tokens: FAKE_TOKENS });
    const res = await importPages(p, [hash]);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_recipe" });
    // Read with the photo itself, then once more by the stronger model, as no recipe found is a
    // reason for the automatic second look (on unless turned off, decided 2026-10-21).
    expect(fakeAi.requests).toHaveLength(2);
    for (const request of fakeAi.requests) {
      expect(request.parts[0]).toMatchObject({ kind: "image", mediaType: "image/webp" });
    }
  });
});

describe("page photos", () => {
  it("are kept while their draft waits for review, and go a week after it's discarded", async () => {
    const p = await person();
    const hash = await upload(p);
    const res = await importPages(p, [hash]);
    const { jobs } = (await res.json()) as ImportPhotosResponse;
    const removed = async () =>
      (await db().select().from(image).where(eq(image.hash, hash)).get())?.deletedAt ?? null;

    await markUnusedImages(db(), Date.now() + 8 * DAY);
    expect(await removed()).toBeNull();

    expect(
      (await p.v.request(`/api/import/jobs/${jobs[0]!.id}/discard`, { body: {} })).status,
    ).toBe(200);
    await markUnusedImages(db(), Date.now() + 8 * DAY);
    expect(await removed()).not.toBeNull();
  });

  it("go with the saved recipe, out of its gallery", async () => {
    const p = await person();
    const hash = await upload(p);
    const { jobs } = (await (await importPages(p, [hash])).json()) as ImportPhotosResponse;
    const recipeId = crypto.randomUUID();
    const line = (text: string) => ({ id: crypto.randomUUID(), text, heading: false });
    const res = await p.v.request("/api/sync/push", {
      body: {
        deviceId: p.deviceId,
        schemaVersion: RECIPE_SCHEMA_VERSION,
        sentAt: Date.now(),
        changes: [
          {
            kind: "recipe",
            id: recipeId,
            changedAt: Date.now(),
            create: {
              createdAt: new Date().toISOString(),
              import: {
                source: "photo",
                importJobId: jobs[0]!.id,
                externalId: null,
                externalHash: null,
                importedAt: new Date().toISOString(),
              },
            },
            fields: {
              ...emptyRecipeContent(),
              title: "Sugar Butter Balls",
              ingredients: [line("1 cup butter")],
              directions: [line("Mix and bake.")],
            },
          },
          {
            kind: "photo",
            id: crypto.randomUUID(),
            recipeId,
            create: { imageHash: hash, role: "import_original", width: 2000, height: 3000 },
            fields: { sortOrder: 1 },
            changedAt: Date.now(),
          },
        ],
      },
    });
    expect(((await res.json()) as { results: ChangeResult[] }).results).toEqual([
      { status: "applied" },
      { status: "applied" },
    ]);
    expect((await jobRow(jobs[0]!.id)).status).toBe("saved");
    await markUnusedImages(db(), Date.now() + 8 * DAY);
    expect(
      (await db().select().from(image).where(eq(image.hash, hash)).get())?.deletedAt,
    ).toBeNull();
  });
});
