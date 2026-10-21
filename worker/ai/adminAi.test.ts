import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminAiOutcomes, AdminAiOverview, AdminAiSettings } from "../../shared/adminAi";
import type { PlanLimitRow } from "../../shared/adminAccounts";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { adminAuditLog, aiOutcome, session, user } from "../db/schema";
import { householdEntitlements } from "../entitlements/entitlements";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";
import { DEFAULT_MODELS } from "./config";
import { fakeAi } from "./fake";
import { readWithAi } from "./read";

// Phase E7: the admin console's AI imports section.

const db = () => database(env.DB);
let admin: Visitor;

async function freshAdmin() {
  await db()
    .update(session)
    .set({ authMethod: "passkey", createdAt: new Date(), lastActiveAt: new Date() })
    .where(eq(session.id, (await admin.session())!.session.id));
}

beforeAll(async () => {
  await setUpDatabase();
  admin = await signUpConfirmed("ai-admin@example.com", "Admin");
  const id = (await admin.session())!.user.id;
  await db().update(user).set({ role: "admin" }).where(eq(user.id, id));
});

beforeEach(async () => {
  await freshAdmin();
  fakeAi.reset();
});

const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const res = await admin.request(path, init);
  return { status: res.status, body: (await res.json()) as unknown };
};

describe("the AI imports section", () => {
  it("is for admins only", async () => {
    const someone = await signUpConfirmed("ai-curious@example.com");
    expect((await someone.request("/api/admin/ai")).status).toBe(403);
  });

  it("starts with the decided limits", async () => {
    const rows = (await call("/api/admin/limits")).body as PlanLimitRow[];
    const value = (tier: string, key: string) =>
      rows.find((r) => r.tier === tier && r.key === key)?.value;
    expect(value("individual", "ai_imports_per_month")).toBe(300);
    expect(value("household", "ai_imports_per_month")).toBe(300);
    expect(value("free", "ai_imports_per_month")).toBe(0);
    expect(value("individual", "ai_cost_cents_per_month")).toBe(1500);
    const { settings } = (await call("/api/admin/ai")).body as AdminAiOverview;
    expect(settings).toEqual({
      alertCents: 5000,
      pauseCents: 15000,
      models: DEFAULT_MODELS,
      // On unless turned off (decided 2026-10-21, with the rules narrowed to amounts).
      secondLook: true,
      missingAmounts: 2,
      oddAmount: 24,
    });
  });

  it("shows this month's cost, by model and by household", async () => {
    const v = await signUpConfirmed("ai-household@example.com", "Rosa Diaz");
    const code = await createCode(
      db(),
      {
        code: "AI-ADMIN-1",
        label: "AI admin tests",
        tier: "individual",
        access: { forever: true },
        allowsSignUp: true,
        maxUses: null,
        redeemBy: null,
      },
      null,
    );
    await v.request("/api/codes/redeem", { body: { code: code.code } });
    const s = (await v.session())!;
    const householdId = s.session.activeOrganizationId!;
    const caller = {
      env,
      db: db(),
      householdId,
      userId: s.user.id,
      plan: await householdEntitlements(db(), householdId),
    };
    const input = {
      source: "photo" as const,
      parts: [{ kind: "text" as const, text: "a recipe", label: "Card" }],
      inputs: [{ kind: "text" as const, name: null, url: null, imageHash: null }],
      photos: [],
    };
    expect((await readWithAi(caller, input)).ok).toBe(true);

    const overview = (await call("/api/admin/ai")).body as AdminAiOverview;
    expect(overview.provider).toBe("fake");
    expect(overview.month).toBe(new Date().toISOString().slice(0, 7));
    expect(overview.reads).toBe(1);
    expect(overview.secondLooks).toBe(0);
    expect(overview.spentMicroUsd).toBe(1600);
    expect(overview.byModel).toEqual([{ model: DEFAULT_MODELS[0], calls: 1, costMicroUsd: 1600 }]);
    expect(overview.households).toEqual([
      { householdId, name: expect.any(String), imports: 1, costMicroUsd: 1600 },
    ]);
    expect(overview.paused).toBe(false);
  });

  it("changes the settings, with the passkey again, recorded first", async () => {
    const changed = await call("/api/admin/ai/settings", {
      method: "PUT",
      body: {
        alertCents: 2500,
        models: "claude-haiku-5-5, claude-sonnet-5-5",
        secondLook: false,
      },
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      alertCents: 2500,
      pauseCents: 15000,
      models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
      secondLook: false,
    } satisfies Partial<AdminAiSettings>);
    const audit = await db()
      .select()
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(3)
      .all();
    expect(audit.map((a) => [a.action, JSON.parse(a.details!).key]).sort()).toEqual([
      ["setting.changed", "ai_alert_cents_per_month"],
      ["setting.changed", "ai_models"],
      ["setting.changed", "ai_second_look"],
    ]);
    const on = await call("/api/admin/ai/settings", {
      method: "PUT",
      body: { secondLook: true },
    });
    expect((on.body as AdminAiSettings).secondLook).toBe(true);
    const bad = await call("/api/admin/ai/settings", { method: "PUT", body: { secondLook: "on" } });
    expect(bad.status).toBe(400);

    for (const body of [
      { models: "gpt-9" },
      { models: "" },
      { alertCents: -1 },
      { pauseCents: 1.5 },
      { oddAmount: "lots" },
    ]) {
      const res = await call("/api/admin/ai/settings", { method: "PUT", body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    // An old passkey sign-in asks for the passkey again, and changes nothing.
    await db()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(session.id, (await admin.session())!.session.id));
    const stale = await call("/api/admin/ai/settings", {
      method: "PUT",
      body: { alertCents: 1 },
    });
    expect(stale.body).toMatchObject({ error: "passkey_reconfirm" });
    await freshAdmin();
    await call("/api/admin/ai/settings", {
      method: "PUT",
      body: { alertCents: 5000, models: DEFAULT_MODELS.join(",") },
    });
    const { settings } = (await call("/api/admin/ai")).body as AdminAiOverview;
    expect(settings.alertCents).toBe(5000);
  });
});

describe("how AI reads turned out (decided 2026-10-19)", () => {
  const outcome = (
    over: Partial<typeof aiOutcome.$inferInsert>,
  ): typeof aiOutcome.$inferInsert => ({
    id: crypto.randomUUID(),
    importJobId: crypto.randomUUID(),
    source: "photo",
    outcome: "saved",
    path: "read+second_look",
    setup: "abc12345",
    reads: JSON.stringify([
      {
        purpose: "read",
        model: "claude-haiku-5-5",
        shown: false,
        ingredients: { exact: 1, saved: 3 },
        directions: { exact: 2, saved: 2 },
        closeness: 0.6,
      },
      {
        purpose: "second_look",
        model: "claude-sonnet-5-5",
        shown: true,
        ingredients: { exact: 3, saved: 3 },
        directions: { exact: 2, saved: 2 },
        closeness: 1,
      },
    ]),
    linesFixed: 0,
    createdAt: new Date(Date.UTC(2026, 9, 5)),
    decidedAt: new Date(Date.UTC(2026, 9, 5)),
    ...over,
  });

  it("are summed up for a month, a quarter or a year, by model", async () => {
    await db()
      .insert(aiOutcome)
      .values([
        outcome({}),
        outcome({ source: "website", decidedAt: new Date(Date.UTC(2026, 7, 20)) }),
        outcome({
          outcome: "discarded",
          path: "read",
          reads: JSON.stringify([{ purpose: "read", model: "claude-haiku-5-5", shown: true }]),
          linesFixed: null,
          decidedAt: new Date(Date.UTC(2026, 9, 6)),
        }),
      ]);
    const october = (await call("/api/admin/ai/outcomes?period=2026-10")).body as AdminAiOutcomes;
    expect(october.label).toBe("October 2026");
    expect(october.summary).toMatchObject({ drafts: 2, saved: 1, discarded: 1 });
    expect(october.summary.secondLook).toEqual({ count: 1, better: 1, same: 0, worse: 0 });
    expect(october.summary.byModel.map((m) => [m.model, m.shown, m.untouched]).sort()).toEqual([
      ["claude-haiku-5-5", 1, 0],
      ["claude-sonnet-5-5", 1, 1],
    ]);
    const quarter = (await call("/api/admin/ai/outcomes?period=2026-Q3")).body as AdminAiOutcomes;
    expect(quarter.summary.drafts).toBe(1);
    expect(quarter.summary.bySource[0]?.source).toBe("website");
    const year = (await call("/api/admin/ai/outcomes?period=2026")).body as AdminAiOutcomes;
    expect(year.summary.drafts).toBe(3);
    expect(year.periods.month.map((p) => p.key)).toContain("2026-08");
    expect(year.periods.quarter.map((p) => p.key)).toContain("2026-Q3");
    expect((await call("/api/admin/ai/outcomes?period=last-week")).status).toBe(400);
  });
});
