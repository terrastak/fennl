import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ImportJobDetail, ImportWebResponse } from "../../shared/importJobs";
import { DEFAULT_MODELS } from "../ai/config";
import { FAKE_TOKENS, fakeAi, fakeAnswer, fakeRecipe } from "../ai/fake";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { aiUsage } from "../db/schema";
import { overrideLimit, setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";

// Phase E8: web pages without recipe data, read by the AI (with the fake provider, AI_PROVIDER=fake
// in vitest.config.ts), and recipe data that leaves out the ingredients or the method.

const db = () => database(env.DB);
const [FIRST, SECOND] = DEFAULT_MODELS as [string, string];
const URL_ = "https://june.example.com/2026/10/sugar-butter-balls";

beforeAll(async () => {
  await setUpDatabase();
});

afterEach(() => {
  fakeAi.reset();
});

let counter = 0;

async function person(premium = true): Promise<{ v: Visitor; householdId: string }> {
  const v = await signUpConfirmed(`ai-web-${++counter}@example.com`);
  if (premium) {
    const code = await createCode(
      db(),
      {
        code: `AI-WEB-${counter}`,
        label: "AI web tests",
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
  return { v, householdId: (await v.session())!.session.activeOrganizationId! };
}

/** A recipe blog post with no recipe data: the story, the recipe, comments and a sidebar. */
const BLOG = `<!DOCTYPE html><html><head><title>Sugar Butter Balls | June Bakes</title>
<meta property="og:site_name" content="June Bakes">
<meta property="og:image" content="https://june.example.com/balls.jpg">
<script>track()</script></head><body>
<nav><a href="/">Home</a><a href="/cookies">Cookies</a></nav>
<main><article>
<h1>Sugar Butter Balls</h1>
<p>My grandmother made these every December, and the whole house smelled of butter.</p>
<h2>Ingredients</h2>
<ul><li>1 cup butter</li><li>1/2 cup powdered sugar</li><li>2 cups flour</li></ul>
<h2>Method</h2>
<ol><li>Cream the butter and sugar, then work in the flour.</li>
<li>Roll into balls and bake at 350°F for 15 minutes.</li></ol>
<section class="comments"><p>Commenter: made these, loved them!</p></section>
</article></main>
<aside class="sidebar"><p>Sign up for the newsletter</p></aside>
</body></html>`;

async function importPage(v: Visitor, html: string, url: string | null = URL_) {
  const res = await v.request("/api/import/web", { body: { html, url } });
  return { status: res.status, body: (await res.json()) as ImportWebResponse & { error?: string } };
}

async function job(v: Visitor, id: string) {
  return (await (await v.request(`/api/import/jobs/${id}`)).json()) as ImportJobDetail;
}

async function usage(householdId: string) {
  return db().select().from(aiUsage).where(eq(aiUsage.householdId, householdId)).all();
}

describe("a page without recipe data", () => {
  it("is read by the AI on Premium, into a draft kept with the page", async () => {
    const { v, householdId } = await person();
    const { status, body } = await importPage(v, BLOG);
    expect(status).toBe(201);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({
      title: "Sugar Butter Balls",
      url: URL_,
      photos: [{ input: 1, url: "https://june.example.com/balls.jpg" }],
    });

    // The AI was given the article's text, without the site around it.
    expect(fakeAi.requests.map((r) => r.model)).toEqual([FIRST]);
    const sent = fakeAi.requests[0]!.parts[0]!;
    expect(sent.kind).toBe("text");
    const text = sent.kind === "text" ? sent.text : "";
    expect(text).toContain(`Address: ${URL_}`);
    expect(text).toContain("- 1/2 cup powdered sugar");
    expect(text).not.toMatch(/Commenter|newsletter|Cookies|track/);

    const detail = await job(v, body.jobs[0]!.id);
    expect(detail.page).toEqual({ url: URL_, title: "Sugar Butter Balls | June Bakes" });
    expect(detail.snapshot).toContain("powdered sugar");
    expect(detail.snapshot).not.toContain("Commenter");
    expect(detail.draft.externalId).toBe(URL_);
    expect(detail.draft.fields.source?.value).toEqual({
      kind: "website",
      name: "June Bakes",
      url: URL_,
      author: "Grandma",
      page: null,
    });
    expect(detail.draft.photos).toEqual([{ input: 1, role: "photo" }]);
    expect(detail.ai).toEqual({ canReadAgain: true, readAgain: false });
    expect((await usage(householdId)).map((u) => u.countsAsImport)).toEqual([1]);
  });

  it("needs AI import in the plan; a page with no text needs nothing", async () => {
    const { v } = await person(false);
    expect(await importPage(v, BLOG)).toEqual({
      status: 403,
      body: { error: "ai_import_not_included" },
    });
    expect(await importPage(v, "<html><body><p>Just a story</p></body></html>")).toEqual({
      status: 422,
      body: { error: "no_recipe" },
    });
    expect(fakeAi.requests).toHaveLength(0);
  });

  it("counts against the month's AI imports", async () => {
    const { v } = await person();
    await overrideLimit(v, "ai_imports_per_month", 1);
    expect((await importPage(v, BLOG)).status).toBe(201);
    expect(await importPage(v, BLOG)).toEqual({ status: 429, body: { error: "monthly_limit" } });
  });

  it("says when the AI finds no recipe, or can't read it, and gives the import back", async () => {
    const { v, householdId } = await person();
    fakeAi.reply = () => ({ ok: true, output: { recipes: [] }, tokens: FAKE_TOKENS });
    expect(await importPage(v, BLOG)).toEqual({ status: 422, body: { error: "no_recipe" } });
    fakeAi.reply = () => ({ ok: false, problem: "failed", tokens: FAKE_TOKENS, detail: null });
    expect(await importPage(v, BLOG)).toEqual({ status: 503, body: { error: "ai_unavailable" } });
    // The empty answers were real answers; only the failed reads give their import back.
    const rows = await usage(householdId);
    expect(rows.filter((u) => u.status !== "ok").every((u) => u.countsAsImport === 0)).toBe(true);
  });

  it("can be read again, keeping the page", async () => {
    const { v } = await person();
    const { body } = await importPage(v, BLOG);
    const id = body.jobs[0]!.id;
    fakeAi.reset();
    fakeAi.byModel({
      [SECOND]: {
        ok: true,
        output: fakeAnswer(fakeRecipe({ title: { text: "Butter Balls", confidence: "high" } })),
        tokens: FAKE_TOKENS,
      },
    });
    const res = await v.request(`/api/import/jobs/${id}/read-again`, { body: {} });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as ImportJobDetail;
    expect(fakeAi.requests.map((r) => r.model)).toEqual([SECOND]);
    expect(fakeAi.requests[0]!.parts[0]).toMatchObject({ kind: "text" });
    expect(detail.draft.fields.title?.value).toBe("Butter Balls");
    expect(detail.draft.externalId).toBe(URL_);
    expect(detail.draft.fields.source?.value.url).toBe(URL_);
    expect(detail.page.url).toBe(URL_);
    expect(detail.snapshot).toContain("powdered sugar");
    expect(detail.ai).toEqual({ canReadAgain: false, readAgain: true });
  });
});

describe("recipe data without ingredients or a method", () => {
  const partial = (extra = "") => `<!DOCTYPE html><html><head><title>Sugar Butter Balls</title>
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Sugar Butter Balls",
    recipeYield: "4 dozen",
    recipeInstructions: [{ "@type": "HowToStep", text: "Mix and bake." }],
  })}</script></head>${BLOG.slice(BLOG.indexOf("<body>"))}${extra}`;

  it("has what's missing read from the page on Premium, keeping the rest", async () => {
    const { v } = await person();
    const { status, body } = await importPage(v, partial());
    expect(status).toBe(201);
    const detail = await job(v, body.jobs[0]!.id);
    expect(detail.draft.fields.ingredients?.value.map((l) => l.text)).toEqual([
      "1 cup butter",
      "1/2 cup powdered sugar",
      "2 cups flour",
    ]);
    // The method the data published stays as it is.
    expect(detail.draft.fields.directions?.value.map((l) => l.text)).toEqual(["Mix and bake."]);
    expect(detail.draft.warnings).toContain(
      "The page's recipe data has no ingredients, so Fennl read it from the page itself.",
    );
    expect(detail.ai).toBeNull();
  });

  it("stays as the data has it without AI import", async () => {
    const { v } = await person(false);
    const { status, body } = await importPage(v, partial());
    expect(status).toBe(201);
    const detail = await job(v, body.jobs[0]!.id);
    expect(detail.draft.fields.ingredients).toBeUndefined();
    expect(detail.draft.warnings).toContain("The page's recipe data has no ingredients.");
    expect(fakeAi.requests).toHaveLength(0);
  });
});
