import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ImportJobDetail } from "../../shared/importJobs";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { aiUsage, importJob, limitOverride } from "../db/schema";
import { devOutbox } from "../email/outbox";
import { householdEntitlements } from "../entitlements/entitlements";
import { writeText } from "../settings/settings";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";
import { aiConfig, DEFAULT_MODELS } from "./config";
import { FAKE_TOKENS, fakeAi, fakeAnswer, fakeRecipe } from "./fake";
import { createAiImport, readAgain, readWithAi, type AiCaller, type AiReadInput } from "./read";
import { householdMonth } from "./usage";

// Phase E7: reading with the AI, with a fake provider (AI_PROVIDER=fake in vitest.config.ts): the
// cheaper model first and a second look when its answer looks wrong, metering, the monthly
// limits and Fennl-wide alert and pause, and "Read again", once.

const db = () => database(env.DB);
const [FIRST, SECOND] = DEFAULT_MODELS as [string, string];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);

beforeAll(async () => {
  await setUpDatabase();
  // These tests cover the automatic second look (on unless turned off, decided 2026-10-21).
  await writeText(database(env.DB), "ai_second_look", "on", null);
});

afterEach(() => {
  fakeAi.reset();
});

let counter = 0;

async function person(premium = true): Promise<{ v: Visitor; caller: AiCaller }> {
  const v = await signUpConfirmed(`ai-${++counter}@example.com`);
  if (premium) {
    const code = await createCode(
      db(),
      {
        code: `AI-${counter}`,
        label: "AI tests",
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
  const session = (await v.session())!;
  const householdId = session.session.activeOrganizationId!;
  return {
    v,
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

const unsure = fakeAnswer(
  fakeRecipe({
    ingredients: [
      { text: "1 cup butter", heading: false, confidence: "high" },
      { text: "2 1/4 cup flour", heading: false, confidence: "low", unsure: ["2 1/4"] },
    ],
  }),
);

async function usageRows(householdId: string) {
  return db().select().from(aiUsage).where(eq(aiUsage.householdId, householdId)).all();
}

describe("reading a recipe", () => {
  it("uses the cheaper model alone when its answer looks right, and meters it", async () => {
    const { caller } = await person();
    const read = await readWithAi(caller, card());
    expect(read).toMatchObject({ ok: true, level: 0, models: [FIRST], secondLook: [] });
    expect(fakeAi.requests.map((r) => r.model)).toEqual([FIRST]);
    expect(fakeAi.requests[0]?.parts).toHaveLength(1);
    if (!read.ok) return;
    expect(read.drafts[0]?.fields.title?.value).toBe("Sugar Butter Balls");
    expect(read.drafts[0]?.producer).toEqual({ importer: "ai", model: FIRST });

    const [row] = await usageRows(caller.householdId);
    expect(row).toMatchObject({
      purpose: "read",
      countsAsImport: 1,
      provider: "fake",
      model: FIRST,
      status: "ok",
      inputTokens: FAKE_TOKENS.input,
      outputTokens: FAKE_TOKENS.output,
      // Haiku 5.5: $0.10 and $0.50 per million tokens.
      costMicroUsd: 6000 * 0.1 + 2000 * 0.5,
    });
    expect(await householdMonth(db(), caller.householdId)).toEqual({
      imports: 1,
      costMicroUsd: 1600,
    });
  });

  it("gets no second look while it's turned off; Read again still uses the stronger model", async () => {
    await writeText(db(), "ai_second_look", "off", null);
    try {
      const { caller } = await person();
      fakeAi.byModel({ [FIRST]: { ok: true, output: unsure, tokens: FAKE_TOKENS } });
      const read = await readWithAi(caller, card());
      expect(read).toMatchObject({
        ok: true,
        level: 0,
        models: [FIRST],
        secondLook: ["unsure_amount"],
      });
      expect(fakeAi.requests.map((r) => r.model)).toEqual([FIRST]);
      const created = await createAiImport(caller, card());
      const again = await readAgain(caller, created.ok ? created.jobIds[0]! : "");
      expect(again.ok).toBe(true);
      expect(fakeAi.requests.map((r) => r.model)).toEqual([FIRST, FIRST, SECOND]);
    } finally {
      await writeText(db(), "ai_second_look", "on", null);
    }
  });

  it("gets a second look from the stronger model when the first is unsure", async () => {
    const { caller } = await person();
    fakeAi.byModel({ [FIRST]: { ok: true, output: unsure, tokens: FAKE_TOKENS } });
    const read = await readWithAi(caller, card());
    expect(read).toMatchObject({ ok: true, level: 1, models: [FIRST, SECOND] });
    expect(read.ok && read.secondLook).toEqual(["unsure_amount"]);
    expect(fakeAi.requests.map((r) => [r.model, r.effort])).toEqual([
      [FIRST, "medium"],
      [SECOND, "high"],
    ]);
    if (read.ok) expect(read.drafts[0]?.producer.model).toBe(SECOND);
    // The second look doesn't count as another import.
    const rows = await usageRows(caller.householdId);
    expect(rows.map((r) => [r.purpose, r.countsAsImport])).toEqual([
      ["read", 1],
      ["second_look", 0],
    ]);
    expect((await householdMonth(db(), caller.householdId)).imports).toBe(1);
  });

  it("looks again when the answer is missing parts, misread, or not an answer at all", async () => {
    const { caller } = await person();
    const cases = [
      { output: fakeAnswer(fakeRecipe({ directions: [] })), reason: "missing_part" },
      {
        output: fakeAnswer(
          fakeRecipe({
            ingredients: [{ text: "35 cups flour", heading: false, confidence: "high" }],
          }),
        ),
        reason: "odd_amount",
      },
      {
        output: fakeAnswer(
          fakeRecipe({
            ingredients: ["butter", "sugar", "flour"].map((text) => ({
              text,
              heading: false,
              confidence: "high" as const,
            })),
          }),
        ),
        reason: "missing_amounts",
      },
      { output: { recipes: "not a list" }, reason: "no_answer" },
    ];
    for (const { output, reason } of cases) {
      fakeAi.byModel({ [FIRST]: { ok: true, output, tokens: FAKE_TOKENS } });
      const read = await readWithAi(caller, card());
      expect(read.ok && read.secondLook, reason).toEqual([reason]);
    }
  });

  it("keeps the first answer when the second look finds nothing better", async () => {
    const { caller } = await person();
    fakeAi.byModel({
      [FIRST]: { ok: true, output: unsure, tokens: FAKE_TOKENS },
      [SECOND]: { ok: false, problem: "failed", tokens: FAKE_TOKENS, detail: "overloaded" },
    });
    const read = await readWithAi(caller, card());
    expect(read).toMatchObject({ ok: true, level: 0 });
    const rows = await usageRows(caller.householdId);
    expect(rows.map((r) => r.status).sort()).toEqual(["failed", "ok"]);
  });

  it("says when there's no recipe, and when nothing could be read", async () => {
    const { caller } = await person();
    fakeAi.reply = () => ({ ok: true, output: { recipes: [] }, tokens: FAKE_TOKENS });
    expect(await readWithAi(caller, card())).toEqual({ ok: false, problem: "no_recipe" });
    // The cheaper model finding no recipe gets a second look too.
    expect(fakeAi.requests.map((r) => r.model)).toEqual([FIRST, SECOND]);

    // A provider that throws gives the import back, like one that reports its failure.
    fakeAi.reply = () => {
      throw new Error("network down");
    };
    expect(await readWithAi(caller, card())).toEqual({ ok: false, problem: "unavailable" });
    const thrown = (await usageRows(caller.householdId)).filter((r) => r.status === "failed");
    expect(thrown.map((r) => r.countsAsImport)).toEqual([0, 0]);

    fakeAi.reply = () => ({ ok: false, problem: "refused", tokens: FAKE_TOKENS, detail: null });
    expect(await readWithAi(caller, card())).toEqual({ ok: false, problem: "unavailable" });
    // A read with no answer gives the import back.
    const rows = await usageRows(caller.householdId);
    expect(rows.filter((r) => r.status === "refused").every((r) => r.countsAsImport === 0)).toBe(
      true,
    );
  });

  it("is Premium only, and unavailable without a provider", async () => {
    const free = await person(false);
    expect(await readWithAi(free.caller, card())).toEqual({
      ok: false,
      problem: "import_not_included",
    });
    const { caller } = await person();
    const noAi = {
      ...caller,
      env: { ...env, AI_PROVIDER: "none" },
    };
    expect(await readWithAi(noAi, card())).toEqual({ ok: false, problem: "unavailable" });
    expect(fakeAi.requests).toHaveLength(0);
  });
});

describe("monthly limits", () => {
  async function limit(householdId: string, key: string, value: number) {
    await db()
      .insert(limitOverride)
      .values({ id: crypto.randomUUID(), householdId, key, value, createdAt: new Date() });
    return householdEntitlements(db(), householdId);
  }

  it("stops a household at its AI imports for the month; the second look never counts", async () => {
    const { caller } = await person();
    caller.plan = await limit(caller.householdId, "ai_imports_per_month", 2);
    fakeAi.byModel({ [FIRST]: { ok: true, output: unsure, tokens: FAKE_TOKENS } });
    expect((await readWithAi(caller, card())).ok).toBe(true);
    expect((await readWithAi(caller, card())).ok).toBe(true);
    expect(await readWithAi(caller, card())).toEqual({ ok: false, problem: "monthly_limit" });
    expect(fakeAi.requests).toHaveLength(4);
  });

  it("stops a household at the hidden cost backstop", async () => {
    const { caller } = await person();
    // 1 cent: one Sonnet second look (about 3 cents) passes it.
    caller.plan = await limit(caller.householdId, "ai_cost_cents_per_month", 1);
    fakeAi.byModel({ [FIRST]: { ok: true, output: unsure, tokens: FAKE_TOKENS } });
    expect((await readWithAi(caller, card())).ok).toBe(true);
    expect(await readWithAi(caller, card())).toEqual({ ok: false, problem: "monthly_limit" });
  });

  it("is off for a Premium tier whose monthly AI imports are 0", async () => {
    const { caller } = await person();
    caller.plan = await limit(caller.householdId, "ai_imports_per_month", 0);
    expect(caller.plan.import_ai_enabled).toBe(false);
  });
});

describe("Read again", () => {
  async function imported(caller: AiCaller, input = card()) {
    const created = await createAiImport(caller, input);
    expect(created.ok).toBe(true);
    return created.ok ? (created.jobIds[0] as string) : "";
  }

  it("is offered once, reads with the next stronger model, and counts as an import", async () => {
    const { v, caller } = await person();
    const id = await imported(caller);
    const job = (await (await v.request(`/api/import/jobs/${id}`)).json()) as ImportJobDetail;
    expect(job.ai).toEqual({ canReadAgain: true, readAgain: false });
    // The card's photo was kept, for the review screen and for reading again.
    const shown = await v.request(`/api/import/jobs/${id}/inputs/0`);
    expect(shown.status).toBe(200);
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(JPEG);

    fakeAi.reset();
    fakeAi.byModel({
      [SECOND]: {
        ok: true,
        output: fakeAnswer(
          fakeRecipe({ title: { text: "Sugar Butter Balls (Grandma's)", confidence: "high" } }),
        ),
        tokens: FAKE_TOKENS,
      },
    });
    const again = await v.request(`/api/import/jobs/${id}/read-again`, { method: "POST" });
    expect(again.status).toBe(200);
    const after = (await again.json()) as ImportJobDetail;
    expect(after.draft.fields.title?.value).toBe("Sugar Butter Balls (Grandma's)");
    expect(after.draft.producer.model).toBe(SECOND);
    expect(after.ai).toEqual({ canReadAgain: false, readAgain: true });
    expect(fakeAi.requests.map((r) => r.model)).toEqual([SECOND]);
    expect(fakeAi.requests[0]?.parts[0]).toMatchObject({ kind: "image", bytes: JPEG });

    // Once only.
    const twice = await v.request(`/api/import/jobs/${id}/read-again`, { method: "POST" });
    expect(twice.status).toBe(409);
    expect(await twice.json()).toEqual({ error: "already_read_again" });
    expect(fakeAi.requests).toHaveLength(1);
    expect((await householdMonth(db(), caller.householdId)).imports).toBe(2);
  });

  it("after a second look, reads with the next model up, and none after the last", async () => {
    const { v, caller } = await person();
    // Three models set up: a second look by the second, then Read again by the third.
    const three = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
    await writeText(db(), "ai_models", three.join(","), null);
    try {
      fakeAi.byModel({ [three[0]!]: { ok: true, output: unsure, tokens: FAKE_TOKENS } });
      const id = await imported(caller);
      fakeAi.reset();
      const again = await v.request(`/api/import/jobs/${id}/read-again`, { method: "POST" });
      expect(again.status).toBe(200);
      expect(fakeAi.requests.map((r) => r.model)).toEqual([three[2]]);
    } finally {
      await writeText(db(), "ai_models", DEFAULT_MODELS.join(","), null);
    }

    // With the default two, a draft from the second has none stronger to go to.
    fakeAi.byModel({ [FIRST]: { ok: true, output: unsure, tokens: FAKE_TOKENS } });
    const other = await imported(caller);
    const job = (await (await v.request(`/api/import/jobs/${other}`)).json()) as ImportJobDetail;
    expect(job.ai).toEqual({ canReadAgain: false, readAgain: false });
    const none = await v.request(`/api/import/jobs/${other}/read-again`, { method: "POST" });
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: "none_stronger" });
  });

  it("gives the one try back when the read can't happen", async () => {
    const { v, caller } = await person();
    const id = await imported(caller);
    fakeAi.reply = () => ({ ok: false, problem: "failed", tokens: FAKE_TOKENS, detail: null });
    const failed = await v.request(`/api/import/jobs/${id}/read-again`, { method: "POST" });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "unavailable" });
    const job = (await (await v.request(`/api/import/jobs/${id}`)).json()) as ImportJobDetail;
    expect(job.ai).toEqual({ canReadAgain: true, readAgain: false });

    // Photos no longer kept: said so, and nothing is spent.
    await env.IMAGES.delete(`imports/${id}/0`);
    fakeAi.reset();
    const gone = await v.request(`/api/import/jobs/${id}/read-again`, { method: "POST" });
    expect(gone.status).toBe(410);
    expect(fakeAi.requests).toHaveLength(0);
  });

  it("only for the person's own AI drafts", async () => {
    const { caller } = await person();
    const id = await imported(caller);
    const stranger = await person();
    const res = await stranger.v.request(`/api/import/jobs/${id}/read-again`, { method: "POST" });
    expect(res.status).toBe(404);
    const row = await db().select().from(importJob).where(eq(importJob.id, id)).get();
    expect(JSON.parse(row!.provenance).ai.rereadAt).toBeNull();
  });

  it("two recipes on one card become two drafts sharing the photo", async () => {
    const { v, caller } = await person();
    fakeAi.reply = () => ({
      ok: true,
      output: fakeAnswer(
        fakeRecipe(),
        fakeRecipe({ title: { text: "Lemon Bars", confidence: "high" } }),
      ),
      tokens: FAKE_TOKENS,
    });
    const created = await createAiImport(caller, card());
    expect(created.ok && created.jobIds).toHaveLength(2);
    if (!created.ok) return;
    const second = created.jobIds[1] as string;
    fakeAi.reset();
    fakeAi.reply = () => ({
      ok: true,
      output: fakeAnswer(
        fakeRecipe(),
        fakeRecipe({ title: { text: "Lemon Squares", confidence: "high" } }),
      ),
      tokens: FAKE_TOKENS,
    });
    const again = await v.request(`/api/import/jobs/${second}/read-again`, { method: "POST" });
    expect(((await again.json()) as ImportJobDetail).draft.fields.title?.value).toBe(
      "Lemon Squares",
    );
  });
});

describe("Fennl-wide spending", () => {
  it("emails the owner at the alert amount and pauses AI imports at the pause amount", async () => {
    const { caller } = await person();
    const config = (await aiConfig(env, db()))!;
    // This month's cost so far, from the tests above, puts both just ahead.
    const spent = (await db().select().from(aiUsage).all()).reduce(
      (sum, r) => sum + r.costMicroUsd,
      0,
    );
    const cents = (micro: number) => String(Math.floor(micro / 10_000));
    await writeText(db(), "ai_alert_cents_per_month", cents(spent + 1), null);
    await writeText(db(), "ai_pause_cents_per_month", cents(spent + 60_000), null);
    try {
      const before = devOutbox.list("owner@example.com").length;
      expect((await readWithAi(caller, card())).ok).toBe(true);
      const sent = devOutbox.list("owner@example.com");
      const notices = sent.slice(0, sent.length - before);
      expect(notices.map((m) => m.subject)).toEqual(["Fennl: AI cost alert"]);

      // Each read passes the pause amount sooner or later; then everyone is paused, told once.
      let read = await readWithAi(caller, card());
      for (let i = 0; i < 100 && read.ok; i++) read = await readWithAi(caller, card());
      expect(read).toEqual({ ok: false, problem: "paused" });
      expect(devOutbox.list("owner@example.com")[0]?.subject).toBe("Fennl: AI imports are paused");
      const other = await person();
      expect(await readWithAi(other.caller, card())).toEqual({ ok: false, problem: "paused" });
      expect(
        devOutbox.list("owner@example.com").filter((m) => m.subject.includes("paused")),
      ).toHaveLength(1);
      expect(config.pauseMicroUsd).toBeGreaterThan(0);
    } finally {
      await writeText(db(), "ai_alert_cents_per_month", "5000", null);
      await writeText(db(), "ai_pause_cents_per_month", "15000", null);
    }
  });
});

describe("the household's own view (Account › Usage and limits)", () => {
  it("shows this month's AI imports against the plan, never the cost", async () => {
    const { v, caller } = await person();
    expect((await createAiImport(caller, card())).ok).toBe(true);
    const res = await v.request("/api/ai/usage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const now = new Date();
    expect(body).toEqual({
      enabled: true,
      used: 1,
      max: 300,
      usedUp: false,
      paused: false,
      resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    });
  });

  it("reads as used up at the hidden cost backstop, without saying what it is", async () => {
    const { v, caller } = await person();
    // One costly import: the household's $15 backstop, long before its 300 imports.
    await db().insert(aiUsage).values({
      id: crypto.randomUUID(),
      householdId: caller.householdId,
      userId: caller.userId,
      importJobId: null,
      purpose: "read",
      countsAsImport: 1,
      provider: "fake",
      model: FIRST,
      status: "ok",
      costMicroUsd: 15_000_000,
      createdAt: new Date(),
    });
    const res = await v.request("/api/ai/usage");
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ used: 1, max: 300, usedUp: true, paused: false });
    expect(text).not.toMatch(/cost|cents|usd|15000/i);
  });

  it("says when AI imports are paused for everyone", async () => {
    const { v } = await person();
    await writeText(db(), "ai_pause_cents_per_month", "0", null);
    try {
      const body = (await (await v.request("/api/ai/usage")).json()) as Record<string, unknown>;
      expect(body).toMatchObject({ paused: true });
    } finally {
      await writeText(db(), "ai_pause_cents_per_month", "15000", null);
    }
  });

  it("says when the plan doesn't include AI imports", async () => {
    const { v } = await person(false);
    const body = (await (await v.request("/api/ai/usage")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ enabled: false, used: 0, max: 0 });
  });
});
