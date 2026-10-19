import { and, desc, eq, gte, lt, sql, sum } from "drizzle-orm";
import { Hono } from "hono";
import type { AdminAiOutcomes, AdminAiOverview, AdminAiSettings } from "../../shared/adminAi";
import {
  periodKey,
  periodLabel,
  periodRange,
  periodsBetween,
  summarize,
  type AiOutcome,
  type PeriodKind,
} from "../../shared/aiOutcome";
import { recordAdminAction } from "../admin/audit";
import { freshPasskeyProblem, requireAdmin, type AdminContext } from "../admin/requireAdmin";
import { aiOutcome, aiUsage, organization } from "../db/schema";
import { writeText, type TextSettingKey } from "../settings/settings";
import { knownAnthropicModel } from "./anthropic";
import { aiProvider, aiSettings, parseModels } from "./config";
import { monthKey, monthStart } from "./usage";

// The admin console's AI imports section (phase E7): this month's estimated AI cost, by model and
// by household, and the Fennl-wide settings (alert and pause amounts, models, when a read gets a
// second look). Changing them asks for the passkey again and is recorded in the audit log first,
// like limit changes (CLAUDE.md, "Admin console").

export const adminAiRoutes = new Hono<{ Bindings: Env; Variables: { admin: AdminContext } }>();

adminAiRoutes.use("/ai", requireAdmin);
adminAiRoutes.use("/ai/*", requireAdmin);

const knows = (env: Env) => {
  const provider = aiProvider(env);
  return provider ? (m: string) => provider.knows(m) : knownAnthropicModel;
};

adminAiRoutes.get("/ai", async (c) => {
  const db = c.var.admin.db;
  const now = new Date();
  const since = new Date(monthStart(now));
  const thisMonth = gte(aiUsage.createdAt, since);
  const settings = await aiSettings(db, knows(c.env));

  const purposes = await db
    .select({ purpose: aiUsage.purpose, calls: sql<number>`count(*)` })
    .from(aiUsage)
    .where(and(thisMonth, sql`${aiUsage.status} != 'pending'`))
    .groupBy(aiUsage.purpose)
    .all();
  const byModel = await db
    .select({
      model: aiUsage.model,
      calls: sql<number>`count(*)`,
      costMicroUsd: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}), 0)`,
    })
    .from(aiUsage)
    .where(thisMonth)
    .groupBy(aiUsage.model)
    .orderBy(desc(sql`coalesce(sum(${aiUsage.costMicroUsd}), 0)`))
    .all();
  const households = await db
    .select({
      householdId: aiUsage.householdId,
      name: organization.name,
      imports: sql<number>`coalesce(sum(${aiUsage.countsAsImport}), 0)`,
      costMicroUsd: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}), 0)`,
    })
    .from(aiUsage)
    .leftJoin(organization, eq(organization.id, aiUsage.householdId))
    .where(thisMonth)
    .groupBy(aiUsage.householdId)
    .orderBy(desc(sql`coalesce(sum(${aiUsage.costMicroUsd}), 0)`))
    .limit(25)
    .all();
  const spent = await db
    .select({ cost: sum(aiUsage.costMicroUsd) })
    .from(aiUsage)
    .where(thisMonth)
    .get();
  const spentMicroUsd = Number(spent?.cost ?? 0);
  const count = (purpose: string) =>
    Number(purposes.find((p) => p.purpose === purpose)?.calls ?? 0);

  const overview: AdminAiOverview = {
    provider: aiProvider(c.env)?.name ?? null,
    month: monthKey(now),
    spentMicroUsd,
    paused: spentMicroUsd >= settings.pauseCents * 10_000,
    reads: count("read"),
    secondLooks: count("second_look"),
    rereads: count("reread"),
    settings,
    byModel: byModel.map((m) => ({
      ...m,
      calls: Number(m.calls),
      costMicroUsd: Number(m.costMicroUsd),
    })),
    households: households.map((h) => ({
      householdId: h.householdId,
      name: h.name ?? "(removed)",
      imports: Number(h.imports),
      costMicroUsd: Number(h.costMicroUsd),
    })),
  };
  return c.json(overview);
});

const SETTING_KEYS: Record<Exclude<keyof AdminAiSettings, "models">, TextSettingKey> = {
  alertCents: "ai_alert_cents_per_month",
  pauseCents: "ai_pause_cents_per_month",
  missingAmounts: "ai_second_look_missing_amounts",
  oddAmount: "ai_second_look_odd_amount",
};

// PUT /api/admin/ai/settings: any of the settings; the rest are left as they are.
adminAiRoutes.put("/ai/settings", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const before = await aiSettings(admin.db, knows(c.env));

  const changes: [TextSettingKey, string, unknown, unknown][] = [];
  for (const [field, key] of Object.entries(SETTING_KEYS) as [
    keyof typeof SETTING_KEYS,
    TextSettingKey,
  ][]) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10_000_000) {
      return c.json({ error: "invalid_value", field }, 400);
    }
    if (value !== before[field]) changes.push([key, String(value), before[field], value]);
  }
  if (body.models !== undefined) {
    const models = typeof body.models === "string" ? parseModels(body.models, knows(c.env)) : null;
    if (!models) return c.json({ error: "invalid_value", field: "models" }, 400);
    if (models.join(",") !== before.models.join(",")) {
      changes.push(["ai_models", models.join(","), before.models, models]);
    }
  }

  for (const [key, value, from, to] of changes) {
    await recordAdminAction(
      c.env,
      { adminUserId: admin.userId, action: "setting.changed", details: { key, from, to } },
      c.req.raw,
    );
    await writeText(admin.db, key, value, admin.userId);
  }
  return c.json(await aiSettings(admin.db, knows(c.env)));
});

// GET /api/admin/ai/outcomes?period=2026-10 (or 2026-Q4, or 2026): how AI-read drafts decided in
// the period turned out, by model and by kind of import, and what each kind of read cost
// (decided 2026-10-19). Without a period, this month.
adminAiRoutes.get("/ai/outcomes", async (c) => {
  const db = c.var.admin.db;
  const now = Date.now();
  const period = c.req.query("period") ?? periodKey("month", now);
  const range = periodRange(period);
  if (!range) return c.json({ error: "invalid_period" }, 400);
  const inPeriod = and(
    gte(aiOutcome.decidedAt, new Date(range.from)),
    lt(aiOutcome.decidedAt, new Date(range.to)),
  );
  const rows = await db.select().from(aiOutcome).where(inPeriod).all();
  const outcomes: AiOutcome[] = rows.map((row) => ({
    source: row.source,
    outcome: row.outcome as AiOutcome["outcome"],
    path: row.path,
    setup: row.setup,
    reads: JSON.parse(row.reads) as AiOutcome["reads"],
    linesFixed: row.linesFixed,
    createdAt: row.createdAt.getTime(),
    decidedAt: row.decidedAt.getTime(),
  }));
  const costs = await db
    .select({
      purpose: aiUsage.purpose,
      cost: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}), 0)`,
    })
    .from(aiUsage)
    .where(
      and(gte(aiUsage.createdAt, new Date(range.from)), lt(aiUsage.createdAt, new Date(range.to))),
    )
    .groupBy(aiUsage.purpose)
    .all();
  const costOf = (purpose: string) => Number(costs.find((x) => x.purpose === purpose)?.cost ?? 0);
  const first = await db
    .select({ at: sql<number | null>`min(${aiOutcome.decidedAt})` })
    .from(aiOutcome)
    .get();
  const since = first?.at ?? now;
  const list = (kind: PeriodKind) =>
    periodsBetween(kind, since, now).map((key) => ({ key, label: periodLabel(key) }));
  const body: AdminAiOutcomes = {
    period,
    label: periodLabel(period),
    periods: { month: list("month"), quarter: list("quarter"), year: list("year") },
    summary: summarize(outcomes),
    cost: { read: costOf("read"), secondLook: costOf("second_look"), reread: costOf("reread") },
  };
  return c.json(body);
});
