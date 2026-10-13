import { and, desc, eq, gte, sql, sum } from "drizzle-orm";
import { Hono } from "hono";
import type { AdminAiOverview, AdminAiSettings } from "../../shared/adminAi";
import { recordAdminAction } from "../admin/audit";
import { freshPasskeyProblem, requireAdmin, type AdminContext } from "../admin/requireAdmin";
import { aiUsage, organization } from "../db/schema";
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
