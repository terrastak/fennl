import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AiOutcome } from "../../shared/aiOutcome";
import type { AiProvenance } from "../../shared/importJobs";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "../../shared/recipe";
import type { ChangeResult } from "../../shared/sync";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { aiOutcome, importJob } from "../db/schema";
import { householdEntitlements } from "../entitlements/entitlements";
import { removeOldImportJobs } from "../import/jobs";
import { writeText } from "../settings/settings";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";
import { DEFAULT_MODELS } from "./config";
import { FAKE_TOKENS, fakeAi, fakeAnswer, fakeRecipe } from "./fake";
import { removeOldOutcomes } from "./outcomes";
import { createAiImport, readAgain, type AiCaller, type AiReadInput } from "./read";

// How AI-read drafts turn out in real use (decided 2026-10-19): each model's answer kept with the
// draft, then measured against what the person saved, discarded or left; scores kept two years.

const db = () => database(env.DB);
const [FIRST, SECOND] = DEFAULT_MODELS as [string, string];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);

beforeAll(async () => {
  await setUpDatabase();
  // Answers from a second look are kept too: it's off unless turned on (decided 2026-10-21).
  await writeText(db(), "ai_second_look", "on", null);
});

afterEach(() => {
  fakeAi.reset();
});

let counter = 0;

async function person(): Promise<{ v: Visitor; caller: AiCaller; deviceId: string }> {
  const v = await signUpConfirmed(`outcome-${++counter}@example.com`);
  const code = await createCode(
    db(),
    {
      code: `OUTCOME-${counter}`,
      label: "Outcome tests",
      tier: "individual",
      access: { forever: true },
      allowsSignUp: true,
      maxUses: null,
      redeemBy: null,
    },
    null,
  );
  expect((await v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(200);
  const deviceId = crypto.randomUUID();
  expect((await v.request("/api/devices/register", { body: { deviceId } })).status).toBe(200);
  const session = (await v.session())!;
  const householdId = session.session.activeOrganizationId!;
  return {
    v,
    deviceId,
    caller: {
      env,
      db: db(),
      householdId,
      userId: session.user.id,
      plan: await householdEntitlements(db(), householdId),
    },
  };
}

const card = (): AiReadInput => ({
  source: "photo",
  parts: [{ kind: "image", mediaType: "image/jpeg", bytes: JPEG, label: "Front of the card" }],
  inputs: [{ kind: "image", name: "card.jpg", url: null, imageHash: null }],
  photos: [{ input: 0, role: "import_original" }],
});

/** Haiku unsure of the flour's amount (and missing the sugar), so the next model looks again. */
function unsureThenRight() {
  fakeAi.byModel({
    [FIRST]: {
      ok: true,
      output: fakeAnswer(
        fakeRecipe({
          ingredients: [
            { text: "1 cup butter", heading: false, confidence: "high" },
            { text: "2 cups flowr", heading: false, confidence: "low", unsure: ["2"] },
          ],
        }),
      ),
      tokens: FAKE_TOKENS,
    },
  });
}

async function provenanceOf(id: string) {
  const row = await db().select().from(importJob).where(eq(importJob.id, id)).get();
  return JSON.parse(row!.provenance) as AiProvenance;
}

async function outcomeOf(id: string) {
  const row = await db().select().from(aiOutcome).where(eq(aiOutcome.importJobId, id)).get();
  return row ? { ...row, reads: JSON.parse(row.reads) as AiOutcome["reads"] } : undefined;
}

async function save(p: Awaited<ReturnType<typeof person>>, jobId: string, ingredients: string[]) {
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
              source: "photo",
              importJobId: jobId,
              externalId: null,
              externalHash: null,
              importedAt: new Date().toISOString(),
            },
          },
          fields: {
            ...emptyRecipeContent(),
            title: "Sugar Butter Balls",
            ingredients: ingredients.map(line),
            directions: [
              "Cream the butter and sugar, then work in the flour.",
              "Roll into balls and bake at 350°F for 15 minutes.",
            ].map(line),
          },
        },
      ],
    },
  });
  expect(((await res.json()) as { results: ChangeResult[] }).results).toEqual([
    { status: "applied" },
  ]);
}

describe("each model's answer", () => {
  it("is kept with the draft, the one shown marked", async () => {
    const p = await person();
    unsureThenRight();
    const created = await createAiImport(p.caller, card());
    const id = created.ok ? created.jobIds[0]! : "";
    const { ai } = await provenanceOf(id);
    expect(ai.answers?.map((a) => [a.purpose, a.model, a.shown])).toEqual([
      ["read", FIRST, false],
      ["second_look", SECOND, true],
    ]);
    expect(ai.answers?.[0]?.lists.ingredients.map((l) => l.text)).toEqual([
      "1 cup butter",
      "2 cups flowr",
    ]);
    expect(ai.setup).toMatch(/^[0-9a-f]{8}$/);
  });

  it("gains Read again's answer, which is then the one shown", async () => {
    const p = await person();
    const created = await createAiImport(p.caller, card());
    const id = created.ok ? created.jobIds[0]! : "";
    expect((await readAgain(p.caller, id)).ok).toBe(true);
    const { ai } = await provenanceOf(id);
    expect(ai.answers?.map((a) => [a.purpose, a.model, a.shown])).toEqual([
      ["read", FIRST, false],
      ["reread", SECOND, true],
    ]);
  });
});

describe("an outcome", () => {
  it("measures each answer against what was saved, then lets the answers go", async () => {
    const p = await person();
    unsureThenRight();
    const created = await createAiImport(p.caller, card());
    const id = created.ok ? created.jobIds[0]! : "";
    // The person kept Sonnet's answer and changed one line.
    await save(p, id, ["1 cup butter", "1/2 cup powdered sugar", "2 1/4 cups flour"]);

    const o = await outcomeOf(id);
    expect(o).toMatchObject({ source: "photo", outcome: "saved", path: "read+second_look" });
    expect(o?.linesFixed).toBe(1);
    const [haiku, sonnet] = o!.reads;
    expect(haiku).toMatchObject({
      model: FIRST,
      shown: false,
      ingredients: { exact: 1, saved: 3 },
    });
    expect(sonnet).toMatchObject({
      model: SECOND,
      shown: true,
      ingredients: { exact: 2, saved: 3 },
    });
    expect(sonnet!.closeness!).toBeGreaterThan(haiku!.closeness!);
    expect(JSON.stringify(o)).not.toContain("powdered");
    expect((await provenanceOf(id)).ai.answers).toBeUndefined();
  });

  it("is recorded when a draft is discarded, or left unreviewed, without scores", async () => {
    const p = await person();
    const a = await createAiImport(p.caller, card());
    const b = await createAiImport(p.caller, card());
    const discarded = a.ok ? a.jobIds[0]! : "";
    const left = b.ok ? b.jobIds[0]! : "";
    const res = await p.v.request(`/api/import/jobs/${discarded}/discard`, { body: {} });
    expect(res.status).toBe(200);
    expect(await outcomeOf(discarded)).toMatchObject({ outcome: "discarded", linesFixed: null });

    await removeOldImportJobs(db(), Date.now() + 31 * 86_400_000);
    const expired = await outcomeOf(left);
    expect(expired).toMatchObject({ outcome: "expired", path: "read" });
    expect(expired?.reads).toEqual([{ purpose: "read", model: FIRST, shown: true }]);
  });

  it("is kept two years", async () => {
    const p = await person();
    const created = await createAiImport(p.caller, card());
    const id = created.ok ? created.jobIds[0]! : "";
    await p.v.request(`/api/import/jobs/${id}/discard`, { body: {} });
    expect(await removeOldOutcomes(db(), Date.now() + 700 * 86_400_000)).toBe(0);
    expect(await removeOldOutcomes(db(), Date.now() + 731 * 86_400_000)).toBeGreaterThan(0);
    expect(await outcomeOf(id)).toBeUndefined();
  });
});
