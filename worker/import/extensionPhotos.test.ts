import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { importPhotoKey, type ImportWebResponse } from "../../shared/importJobs";
import { emptyRecipeContent, RECIPE_SCHEMA_VERSION } from "../../shared/recipe";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { importJob } from "../db/schema";
import { app } from "../index";
import { ORIGIN, setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";
import { removeImportPhotos } from "./jobs";

// Some sites (Food Network, for one) refuse photo downloads from servers, so the Chrome extension
// brings a draft's photos from the person's browser and hands them to Fennl (phase E6).

const db = () => database(env.DB);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);

beforeAll(async () => {
  await setUpDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

let counter = 0;
let codes = 0;

async function connected(premium: boolean): Promise<{ v: Visitor; key: string }> {
  const v = await signUpConfirmed(`extension-photos-${++counter}@example.com`);
  if (premium) {
    const code = await createCode(
      db(),
      {
        code: `PHOTOS-${++codes}`,
        label: "Extension photo tests",
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
  const res = await v.request("/api/extension/links", { method: "POST" });
  const { key } = (await res.json()) as { key: string };
  return { v, key };
}

function asExtension(key: string, path: string, init: { json?: unknown; bytes?: Uint8Array }) {
  return app.request(
    `${ORIGIN}${path}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": init.json === undefined ? "application/octet-stream" : "application/json",
      },
      body: init.json === undefined ? (init.bytes ?? null) : JSON.stringify(init.json),
    },
    env,
  );
}

const PAGE = `<!DOCTYPE html><html><head><title>Cookies</title><script type="application/ld+json">${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Black Cocoa Crinkle Cookies",
    image: "https://photos.example.com/crinkle.webp",
    recipeIngredient: ["1 cup flour", "1/2 cup black cocoa"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Mix, roll in sugar, bake." }],
  },
)}</script></head><body></body></html>`;

async function sendPage(key: string) {
  const res = await asExtension(key, "/api/import/web", { json: { html: PAGE, url: null } });
  expect(res.status).toBe(201);
  const [job] = ((await res.json()) as ImportWebResponse).jobs;
  return job!;
}

describe("photos the extension brings", () => {
  it("are listed for the extension, kept, and shown without asking the site", async () => {
    const { v, key } = await connected(true);
    const job = await sendPage(key);
    expect(job.photos).toEqual([{ input: 1, url: "https://photos.example.com/crinkle.webp" }]);

    const sent = await asExtension(key, `/api/import/jobs/${job.id}/inputs/1`, { bytes: JPEG });
    expect(sent.status).toBe(201);

    const fetched = vi.spyOn(globalThis, "fetch");
    const shown = await v.request(`/api/import/jobs/${job.id}/inputs/1`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(JPEG);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("must be the draft's own photos, image files, on Premium", async () => {
    const { key } = await connected(true);
    const job = await sendPage(key);
    // The page itself, and inputs that don't exist.
    for (const n of [0, 5]) {
      const res = await asExtension(key, `/api/import/jobs/${job.id}/inputs/${n}`, { bytes: JPEG });
      expect(res.status, String(n)).toBe(404);
    }
    const notImage = new TextEncoder().encode("<html>not a photo</html>");
    expect(
      (await asExtension(key, `/api/import/jobs/${job.id}/inputs/1`, { bytes: notImage })).status,
    ).toBe(415);

    // Someone else's draft.
    const other = await connected(true);
    expect(
      (await asExtension(other.key, `/api/import/jobs/${job.id}/inputs/1`, { bytes: JPEG })).status,
    ).toBe(404);

    // Free: no photos.
    const free = await connected(false);
    const freeJob = await sendPage(free.key);
    expect(
      (await asExtension(free.key, `/api/import/jobs/${freeJob.id}/inputs/1`, { bytes: JPEG }))
        .status,
    ).toBe(403);
  });

  it("are removed once the draft is discarded or saved", async () => {
    const { v, key } = await connected(true);
    const discarded = await sendPage(key);
    await asExtension(key, `/api/import/jobs/${discarded.id}/inputs/1`, { bytes: JPEG });
    await v.request(`/api/import/jobs/${discarded.id}/discard`, { method: "POST" });
    expect(await env.IMAGES.head(importPhotoKey(discarded.id, 1))).toBeNull();

    const saved = await sendPage(key);
    const waiting = await sendPage(key);
    for (const job of [saved, waiting]) {
      await asExtension(key, `/api/import/jobs/${job.id}/inputs/1`, { bytes: JPEG });
    }
    const deviceId = crypto.randomUUID();
    await v.request("/api/devices/register", { body: { deviceId } });
    const push = await v.request("/api/sync/push", {
      body: {
        deviceId,
        schemaVersion: RECIPE_SCHEMA_VERSION,
        sentAt: Date.now(),
        changes: [
          {
            kind: "recipe",
            id: crypto.randomUUID(),
            changedAt: Date.now(),
            create: {
              createdAt: new Date().toISOString(),
              import: {
                source: "website",
                importJobId: saved.id,
                externalId: null,
                externalHash: null,
                importedAt: new Date().toISOString(),
              },
            },
            fields: { ...emptyRecipeContent(), title: "Black Cocoa Crinkle Cookies" },
          },
        ],
      },
    });
    expect(push.status).toBe(200);
    expect(
      (await db().select().from(importJob).where(eq(importJob.id, saved.id)).get())?.status,
    ).toBe("saved");

    // An hour on, the hourly job removes the saved draft's photo and keeps the waiting one's.
    await removeImportPhotos(db(), env.IMAGES, Date.now() + 2 * 60 * 60 * 1000);
    expect(await env.IMAGES.head(importPhotoKey(saved.id, 1))).toBeNull();
    expect(await env.IMAGES.head(importPhotoKey(waiting.id, 1))).not.toBeNull();
  });
});
