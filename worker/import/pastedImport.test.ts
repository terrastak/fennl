import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RecipeDraft } from "../../shared/importDraft";
import type {
  AiProvenance,
  ImportJobDetail,
  ImportTextResponse,
  PastedProvenance,
} from "../../shared/importJobs";
import { PASTED_TEXT_CHARS } from "../../shared/pastedText";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "../../shared/recipe";
import type { ChangeResult } from "../../shared/sync";
import { FAKE_TOKENS, fakeAi } from "../ai/fake";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { aiOutcome, aiUsage, importJob } from "../db/schema";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";

// Phase E15: recipe text pasted into the Import page. Clearly laid out text is read without the
// AI (so Free can use it); anything else is read by the AI on a plan that includes it. The text
// is kept with the draft until it is saved or removed.

const db = () => database(env.DB);

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
  const v = await signUpConfirmed(`pasted-${++counter}@example.com`);
  if (premium) {
    const code = await createCode(
      db(),
      {
        code: `PASTE-${counter}`,
        label: "Pasted text tests",
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

const LAID_OUT = `Grandma's Banana Bread

Serves 8

Ingredients
3 ripe bananas
1/2 cup butter, melted
3/4 cup sugar
2 cups flour

Directions
Mash the bananas and stir in the butter and sugar.
Fold in the flour and bake at 350°F for 60 minutes.`;

const MESSY = `Hi! Here's that cookie thing I told you about. You mix a cup of butter with half a cup of
powdered sugar, work in two cups of flour, roll them into balls and bake about 15 minutes at 350.
Love, Aunt June`;

const paste = (p: Person, text: unknown) => p.v.request("/api/import/text", { body: { text } });
const jobRow = async (id: string) =>
  (await db().select().from(importJob).where(eq(importJob.id, id)).get())!;
const aiCalls = async () => (await db().select().from(aiUsage).all()).length;

describe("pasting a clearly laid out recipe", () => {
  it("is read without the AI, on Free too", async () => {
    const free = await person(false);
    const before = await aiCalls();
    const res = await paste(free, LAID_OUT);
    expect(res.status).toBe(201);
    const { jobs } = (await res.json()) as ImportTextResponse;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe("Grandma's Banana Bread");

    const job = await jobRow(jobs[0]!.id);
    expect(job.source).toBe("text");
    expect(job.status).toBe("ready");
    const draft = JSON.parse(job.draft!) as RecipeDraft;
    expect(draft.producer.importer).toBe("pasted-text");
    expect(draft.fields.ingredients?.value).toHaveLength(4);
    expect(draft.fields.servings?.value.count).toBe(8);
    expect(JSON.parse(job.provenance)).toEqual({ pasted: { text: LAID_OUT } });
    expect(fakeAi.requests).toHaveLength(0);
    expect(await aiCalls()).toBe(before);
  });

  it("shows the pasted text on the draft, to its owner only", async () => {
    const p = await person();
    const other = await person();
    const { jobs } = (await (await paste(p, LAID_OUT)).json()) as ImportTextResponse;
    const res = await p.v.request(`/api/import/jobs/${jobs[0]!.id}`);
    const detail = (await res.json()) as ImportJobDetail;
    expect(detail.pastedText).toBe(LAID_OUT);
    expect(detail.ai).toBeNull();
    expect((await other.v.request(`/api/import/jobs/${jobs[0]!.id}`)).status).toBe(404);
  });

  it("removes the pasted text once the recipe is saved", async () => {
    const p = await person(false);
    const { jobs } = (await (await paste(p, LAID_OUT)).json()) as ImportTextResponse;
    const line = (text: string) => ({ id: crypto.randomUUID(), text, heading: false });
    const res = await p.v.request("/api/sync/push", {
      body: {
        deviceId: p.deviceId,
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
                source: "text",
                importJobId: jobs[0]!.id,
                externalId: null,
                externalHash: null,
                importedAt: new Date().toISOString(),
              },
            },
            fields: {
              ...emptyRecipeContent(),
              title: "Grandma's Banana Bread",
              ingredients: [line("3 ripe bananas")],
              directions: [line("Bake.")],
            },
          },
        ],
      },
    });
    expect(((await res.json()) as { results: ChangeResult[] }).results).toEqual([
      { status: "applied" },
    ]);
    const job = await jobRow(jobs[0]!.id);
    expect(job.status).toBe("saved");
    expect(job.provenance).not.toContain("Banana");
    expect(job.draft).toBeTruthy();
  });

  it("is gone with the draft when discarded", async () => {
    const p = await person(false);
    const { jobs } = (await (await paste(p, LAID_OUT)).json()) as ImportTextResponse;
    expect(
      (await p.v.request(`/api/import/jobs/${jobs[0]!.id}/discard`, { body: {} })).status,
    ).toBe(200);
    expect(
      await db().select().from(importJob).where(eq(importJob.id, jobs[0]!.id)).get(),
    ).toBeUndefined();
  });
});

describe("pasting text that needs the AI", () => {
  it("reads it with the cheaper model, meters it, and keeps the text on the draft", async () => {
    const p = await person();
    const res = await paste(p, MESSY);
    expect(res.status).toBe(201);
    const { jobs } = (await res.json()) as ImportTextResponse;
    expect(fakeAi.requests).toHaveLength(1);
    expect(fakeAi.requests[0]?.parts[0]).toMatchObject({ kind: "text" });
    const job = await jobRow(jobs[0]!.id);
    expect(job.source).toBe("text");
    const provenance = JSON.parse(job.provenance) as AiProvenance & PastedProvenance;
    expect(provenance.pasted.text).toBe(MESSY);
    expect(provenance.ai.parts[0]).toMatchObject({ kind: "text", text: MESSY });
    const draft = JSON.parse(job.draft!) as RecipeDraft;
    expect(draft.inputs).toEqual([
      { kind: "text", name: "Pasted text", url: null, imageHash: null },
    ]);
    const usage = await db().select().from(aiUsage).where(eq(aiUsage.userId, p.userId)).all();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ purpose: "read", countsAsImport: 1, status: "ok" });

    // "Read again" is on offer, and reads the same text.
    const detail = (await (
      await p.v.request(`/api/import/jobs/${job.id}`)
    ).json()) as ImportJobDetail;
    expect(detail.ai?.canReadAgain).toBe(true);
    expect((await p.v.request(`/api/import/jobs/${job.id}/read-again`, { body: {} })).status).toBe(
      200,
    );
    expect(fakeAi.requests.at(-1)?.parts[0]).toMatchObject({ kind: "text", text: MESSY });
  });

  it("reads several recipes in one paste", async () => {
    const p = await person();
    fakeAi.reply = () => ({
      ok: true,
      output: {
        recipes: [{ ...fakeAnswerRecipe("Cookies") }, { ...fakeAnswerRecipe("Brownies") }],
      },
      tokens: FAKE_TOKENS,
    });
    const { jobs } = (await (
      await paste(p, `${LAID_OUT}\n\n${LAID_OUT}`)
    ).json()) as ImportTextResponse;
    expect(jobs.map((j) => j.title)).toEqual(["Cookies", "Brownies"]);
  });

  it("is Premium; Free is told so, and nothing is spent", async () => {
    const free = await person(false);
    const before = await aiCalls();
    const res = await paste(free, MESSY);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_included" });
    expect(fakeAi.requests).toHaveLength(0);
    expect(await aiCalls()).toBe(before);
  });

  it("says when the AI found no recipe", async () => {
    const p = await person();
    fakeAi.reply = () => ({ ok: true, output: { recipes: [] }, tokens: FAKE_TOKENS });
    const res = await paste(
      p,
      "Hi Sam, are we still on for Thursday? Bring the folding chairs if you can, thanks!",
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_recipe" });
  });

  it("records how an AI-read paste turned out", async () => {
    const p = await person();
    const { jobs } = (await (await paste(p, MESSY)).json()) as ImportTextResponse;
    await p.v.request(`/api/import/jobs/${jobs[0]!.id}/discard`, { body: {} });
    const outcome = await db()
      .select()
      .from(aiOutcome)
      .where(eq(aiOutcome.importJobId, jobs[0]!.id))
      .get();
    expect(outcome).toMatchObject({ source: "text", outcome: "discarded" });
  });
});

describe("text that is turned away", () => {
  it("is never fetched when it is only a web address", async () => {
    const p = await person();
    const before = await aiCalls();
    const res = await paste(p, "https://example.com/recipes/banana-bread");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "web_address" });
    expect(fakeAi.requests).toHaveLength(0);
    expect(await aiCalls()).toBe(before);
  });

  it("is too short or too long, without any AI spending", async () => {
    const p = await person();
    expect(await (await paste(p, "pasta")).json()).toEqual({ error: "no_recipe" });
    const long = await paste(p, "x".repeat(PASTED_TEXT_CHARS + 1));
    expect(long.status).toBe(413);
    expect(await long.json()).toEqual({ error: "text_too_large" });
    expect((await paste(p, "   ")).status).toBe(400);
    expect((await paste(p, 42)).status).toBe(400);
    expect(fakeAi.requests).toHaveLength(0);
  });
});

function fakeAnswerRecipe(title: string) {
  const sure = { confidence: "high" as const };
  return {
    title: { text: title, ...sure },
    description: { text: "", ...sure },
    ingredients: [
      { text: "1 cup butter", heading: false, ...sure },
      { text: "2 cups flour", heading: false, ...sure },
    ],
    directions: [{ text: "Mix and bake.", heading: false, ...sure }],
    notes: { text: "", ...sure },
    times: {
      prep: { minutes: null, text: null },
      cook: { minutes: null, text: null },
      total: { minutes: null, text: null },
      ...sure,
    },
    servings: { count: null, yield: null, ...sure },
    source: { kind: null, name: null, author: null, page: null, url: null, ...sure },
    unclear: [],
  };
}
