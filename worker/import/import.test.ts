import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ImportJobDetail, ImportWebResponse } from "../../shared/importJobs";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "../../shared/recipe";
import type { ChangeResult } from "../../shared/sync";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { importJob } from "../db/schema";
import { overrideLimit, setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";
import { removeOldImportJobs } from "./jobs";

// Phase E4: reading web pages into drafts, the drafts' routes, their photos, and saving.

const db = () => database(env.DB);
let counter = 0;

beforeAll(async () => {
  await setUpDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Person {
  v: Visitor;
  userId: string;
  deviceId: string;
}

async function person(name = "June Lee"): Promise<Person> {
  const v = await signUpConfirmed(`import-${++counter}@example.com`, name);
  const deviceId = crypto.randomUUID();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(res.status).toBe(200);
  return { v, userId: (await v.session())!.user.id, deviceId };
}

let codes = 0;
async function premiumPerson(): Promise<Person> {
  const p = await person();
  const code = await createCode(
    db(),
    {
      code: `IMPORT-${++codes}`,
      label: "Import tests",
      tier: "individual",
      access: { forever: true },
      allowsSignUp: true,
      maxUses: null,
      redeemBy: null,
    },
    null,
  );
  const res = await p.v.request("/api/codes/redeem", { body: { code: code.code } });
  expect(res.status).toBe(200);
  return p;
}

const recipeData = (name: string, image = "https://photos.example.com/cake.jpg") => ({
  "@context": "https://schema.org",
  "@type": "Recipe",
  name,
  image,
  recipeYield: "8 servings",
  recipeIngredient: ["2 cups flour", "1 cup sugar"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Mix and bake." }],
});

function page(data: unknown[], extra = "") {
  return `<!DOCTYPE html><html><head><title>Cakes &amp; more</title>
${data.map((d) => `<script type="application/ld+json">${JSON.stringify(d)}</script>`).join("\n")}
<script>alert("hi")</script></head><body>
<div class="recipe-card"><h2>${(data[0] as { name?: string })?.name ?? ""}</h2>
<ul><li>2 cups flour</li><li>1 cup sugar</li></ul><ol><li>Mix and bake.</li></ol>
<img src="x" onerror="alert(1)"></div>${extra}</body></html>`;
}

async function importPage(
  p: Person,
  html: string,
  url: string | null = "https://cakes.example.com/sponge",
) {
  const res = await p.v.request("/api/import/web", { body: { html, url } });
  return { status: res.status, body: (await res.json()) as ImportWebResponse & { error?: string } };
}

async function job(p: Person, id: string) {
  const res = await p.v.request(`/api/import/jobs/${id}`);
  return { status: res.status, body: (await res.json()) as ImportJobDetail };
}

describe("reading a web page", () => {
  it("makes a draft for review, on any plan", async () => {
    const june = await person();
    const { status, body } = await importPage(june, page([recipeData("Sponge Cake")]));
    expect(status).toBe(201);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({
      title: "Sponge Cake",
      url: "https://cakes.example.com/sponge",
    });

    const list = await june.v.request("/api/import/jobs");
    expect(((await list.json()) as ImportWebResponse).jobs.map((j) => j.id)).toEqual([
      body.jobs[0]!.id,
    ]);

    const detail = await job(june, body.jobs[0]!.id);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe("ready");
    expect(detail.body.draft.fields.title?.value).toBe("Sponge Cake");
    expect(detail.body.page).toEqual({
      url: "https://cakes.example.com/sponge",
      title: "Cakes & more",
    });
    // The page's recipe card, without its scripts or anything that runs.
    expect(detail.body.snapshot).toContain("2 cups flour");
    expect(detail.body.snapshot).not.toMatch(/<script|onerror|alert/i);
    expect(detail.body.recipeId).toBeNull();
  });

  it("makes one draft per recipe on a page, in one batch", async () => {
    const june = await person();
    const { body } = await importPage(
      june,
      page([recipeData("Sponge Cake"), recipeData("Lemon Cake")]),
    );
    expect(body.jobs.map((j) => j.title)).toEqual(["Sponge Cake", "Lemon Cake"]);
    const rows = await db().select().from(importJob).where(eq(importJob.userId, june.userId)).all();
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
    expect(rows[0]!.batchId).not.toBeNull();
  });

  it("uses the address a saved page recorded when none is given", async () => {
    const june = await person();
    const html = `<!-- saved from url=(0035)https://cakes.example.com/saved -->\n${page([
      { ...recipeData("Saved Cake"), url: undefined },
    ])}`;
    const { status, body } = await importPage(june, html, null);
    expect(status).toBe(201);
    expect(body.jobs[0]!.url).toBe("https://cakes.example.com/saved");
  });

  it("says when a page has no recipe data, or is too large, or isn't a page", async () => {
    const june = await person();
    expect(await importPage(june, "<html><body><p>Just a story</p></body></html>")).toEqual({
      status: 422,
      body: { error: "no_recipe" },
    });
    const huge = page([recipeData("Big Cake")], "x".repeat(8 * 1024 * 1024 + 1));
    expect((await importPage(june, huge)).status).toBe(413);
    const res = await june.v.request("/api/import/web", { body: { html: 5 } });
    expect(res.status).toBe(400);
  });

  it("needs a signed-in person", async () => {
    const { visitor } = await import("../test/visitor");
    const res = await visitor().request("/api/import/web", { body: { html: page([]) } });
    expect(res.status).toBe(401);
  });
});

describe("the plan's import limit", () => {
  it("turns imports off at 0, and counts only pages with a recipe", async () => {
    const june = await person();
    await overrideLimit(june.v, "structured_imports_per_day", 0);
    expect(await importPage(june, page([recipeData("Sponge Cake")]))).toEqual({
      status: 403,
      body: { error: "import_not_included" },
    });

    await overrideLimit(june.v, "structured_imports_per_day", 1);
    expect((await importPage(june, "<html><body>No recipe</body></html>")).status).toBe(422);
    expect((await importPage(june, page([recipeData("Sponge Cake")]))).status).toBe(201);
    expect(await importPage(june, page([recipeData("Lemon Cake")]))).toEqual({
      status: 429,
      body: { error: "daily_limit" },
    });
  });
});

describe("drafts belong to the person who imported them", () => {
  it("can't be seen, discarded or used by anyone else", async () => {
    const june = await person();
    const sam = await person("Sam Park");
    const { body } = await importPage(june, page([recipeData("Sponge Cake")]));
    const id = body.jobs[0]!.id;
    expect((await job(sam, id)).status).toBe(404);
    expect((await sam.v.request(`/api/import/jobs/${id}/discard`, { method: "POST" })).status).toBe(
      404,
    );
    expect(
      ((await (await sam.v.request("/api/import/jobs")).json()) as ImportWebResponse).jobs,
    ).toEqual([]);
  });

  it("are removed when discarded", async () => {
    const june = await person();
    const { body } = await importPage(june, page([recipeData("Sponge Cake")]));
    const id = body.jobs[0]!.id;
    const res = await june.v.request(`/api/import/jobs/${id}/discard`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await job(june, id)).status).toBe(404);
    expect(await db().select().from(importJob).where(eq(importJob.id, id)).get()).toBeUndefined();
  });

  it("are removed when nobody reviews them for 30 days", async () => {
    const june = await person();
    const { body } = await importPage(june, page([recipeData("Sponge Cake")]));
    const id = body.jobs[0]!.id;
    expect(await removeOldImportJobs(db(), Date.now() + 29 * 86_400_000)).toBe(0);
    expect(await removeOldImportJobs(db(), Date.now() + 31 * 86_400_000)).toBeGreaterThan(0);
    expect((await job(june, id)).status).toBe(404);
  });
});

describe("saving a draft", () => {
  async function pushCreate(p: Person, recipeId: string, importJobId: string) {
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
                source: "website",
                importJobId,
                externalId: "https://cakes.example.com/sponge",
                externalHash: null,
                importedAt: new Date().toISOString(),
              },
            },
            fields: { ...emptyRecipeContent(), title: "Sponge Cake" },
          },
        ],
      },
    });
    return ((await res.json()) as { results: ChangeResult[] }).results;
  }

  it("is marked saved when the recipe made from it is synced", async () => {
    const june = await person();
    const { body } = await importPage(june, page([recipeData("Sponge Cake")]));
    const id = body.jobs[0]!.id;
    const recipeId = crypto.randomUUID();
    expect(await pushCreate(june, recipeId, id)).toEqual([{ status: "applied" }]);

    const detail = await job(june, id);
    expect(detail.body).toMatchObject({ status: "saved", recipeId, snapshot: null });
    expect(
      ((await (await june.v.request("/api/import/jobs")).json()) as ImportWebResponse).jobs,
    ).toEqual([]);
    // Saved drafts stay as the record of where the recipe came from.
    expect(await removeOldImportJobs(db(), Date.now() + 31 * 86_400_000)).toBe(0);
  });

  it("only marks the person's own draft", async () => {
    const june = await person();
    const sam = await person("Sam Park");
    const { body } = await importPage(june, page([recipeData("Sponge Cake")]));
    const id = body.jobs[0]!.id;
    expect(await pushCreate(sam, crypto.randomUUID(), id)).toEqual([{ status: "applied" }]);
    expect((await job(june, id)).body.status).toBe("ready");
  });

  it("can update a recipe the household already has", async () => {
    const june = await person();
    const sam = await person("Sam Park");
    const { body } = await importPage(june, page([recipeData("Sponge Cake")]));
    const first = body.jobs[0]!.id;
    const recipeId = crypto.randomUUID();
    const second = (await importPage(june, page([recipeData("Sponge Cake")]))).body.jobs[0]!.id;
    await pushCreate(june, recipeId, first);

    // Someone else's recipe isn't the household's.
    const samRecipe = crypto.randomUUID();
    await pushCreate(sam, samRecipe, crypto.randomUUID());
    const refused = await june.v.request(`/api/import/jobs/${second}/saved`, {
      body: { recipeId: samRecipe },
    });
    expect(refused.status).toBe(404);

    const res = await june.v.request(`/api/import/jobs/${second}/saved`, { body: { recipeId } });
    expect(res.status).toBe(200);
    expect((await job(june, second)).body).toMatchObject({ status: "saved", recipeId });
  });
});

describe("a draft's photos", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);

  async function draftWithPhoto(p: Person, image = "https://photos.example.com/cake.jpg") {
    const { body } = await importPage(p, page([recipeData("Sponge Cake", image)]));
    const detail = await job(p, body.jobs[0]!.id);
    const index = detail.body.draft.inputs.findIndex((i) => i.kind === "image");
    expect(index).toBeGreaterThan(0);
    return { id: body.jobs[0]!.id, index };
  }

  it("are part of Premium", async () => {
    const june = await person();
    const { id, index } = await draftWithPhoto(june);
    const res = await june.v.request(`/api/import/jobs/${id}/inputs/${index}`);
    expect(res.status).toBe(403);
  });

  it("are fetched by the server and checked to be images", async () => {
    const june = await premiumPerson();
    const { id, index } = await draftWithPhoto(june);
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JPEG, { headers: { "content-type": "image/jpeg" } }));
    const res = await june.v.request(`/api/import/jobs/${id}/inputs/${index}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(String(fetched.mock.calls[0]![0])).toBe("https://photos.example.com/cake.jpg");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>not a photo</html>", { headers: { "content-type": "image/jpeg" } }),
    );
    expect((await june.v.request(`/api/import/jobs/${id}/inputs/${index}`)).status).toBe(415);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("gone", { status: 404 }));
    expect((await june.v.request(`/api/import/jobs/${id}/inputs/${index}`)).status).toBe(502);
  });

  it("are only the draft's own, from the public web, never this app", async () => {
    const june = await premiumPerson();
    const fetched = vi.spyOn(globalThis, "fetch");
    const { id, index } = await draftWithPhoto(june);
    // Not an image input (the page itself), or no such input.
    expect((await june.v.request(`/api/import/jobs/${id}/inputs/0`)).status).toBe(404);
    expect((await june.v.request(`/api/import/jobs/${id}/inputs/99`)).status).toBe(404);

    for (const image of [
      "http://localhost/api/images/abc",
      "http://127.0.0.1/cake.jpg",
      "http://[::1]/cake.jpg",
      "https://router.local/cake.jpg",
    ]) {
      const local = await draftWithPhoto(june, image).catch(() => null);
      if (!local) continue; // The reader may not even keep it.
      expect(
        (await june.v.request(`/api/import/jobs/${local.id}/inputs/${local.index}`)).status,
      ).toBe(404);
    }
    expect(fetched).not.toHaveBeenCalled();

    // A redirect to somewhere refused is refused too.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://localhost/api/images/x" } }),
    );
    expect((await june.v.request(`/api/import/jobs/${id}/inputs/${index}`)).status).toBe(502);
  });
});
