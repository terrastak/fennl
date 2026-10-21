import { and, eq, gte, sql, sum } from "drizzle-orm";
import type { Database } from "../db/client";
import { aiUsage } from "../db/schema";
import { createEmailSender } from "../email/email";
import { ownerNoticeEmail } from "../email/templates";
import { claimText } from "../settings/settings";
import type { AiConfig } from "./config";
import type { AiProblem, AiTokens } from "./provider";

// Metering every AI call (phase E7; CLAUDE.md, "AI import"). Each call gets an ai_usage row
// before it's made, in one statement that also checks the month's limits (CLAUDE.md, "Data
// model rules": no read-decide-write), so two imports at once can't both take the last one:
//
// - the household's AI imports this month (ai_imports_per_month; the automatic second look
//   doesn't count, "Read again" does);
// - the household's estimated cost this month (ai_cost_cents_per_month, a hidden backstop);
// - Fennl's estimated cost this month (the pause amount, an app setting).
//
// Months are calendar months in UTC. A call that fails gives its import back.

/**
 * "read" (a new import), "second_look" (the stronger model, automatically), "reread" ("Read
 * again"), "find" (finding the recipes in a PDF, phase E12). Only "read" and "reread" count as
 * imports.
 */
export type AiPurpose = "read" | "second_look" | "reread" | "find";

export interface AiCall {
  householdId: string;
  userId: string;
  importJobId: string | null;
  purpose: AiPurpose;
  provider: string;
  model: string;
}

export interface HouseholdAiLimits {
  /** ai_imports_per_month; null: no limit. */
  maxImports: number | null;
  /** ai_cost_cents_per_month, in millionths of a dollar; null: no limit. */
  maxCostMicroUsd: number | null;
}

/** Why a call can't be made. */
export type AiRefusal =
  /** The household has used this month's AI imports (or reached the hidden cost backstop). */
  | "monthly_limit"
  /** AI imports are paused for everyone: this month's cost reached the pause amount. */
  | "paused";

/** Midnight UTC on the first of the month. */
export function monthStart(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

/** "2026-10". */
export const monthKey = (now: Date) => now.toISOString().slice(0, 7);

/**
 * Writes the call's row if the limits allow it, and returns its ID; otherwise says which limit.
 * Only a new import ("read", "reread") counts against the monthly imports; every call counts
 * toward the costs.
 */
export async function reserveCall(
  db: Database,
  call: AiCall,
  limits: HouseholdAiLimits,
  pauseMicroUsd: number,
  now = new Date(),
): Promise<{ ok: true; id: string } | { ok: false; refusal: AiRefusal }> {
  const id = crypto.randomUUID();
  const start = monthStart(now);
  const counts = call.purpose === "read" || call.purpose === "reread" ? 1 : 0;
  const row = await db.get<{ id: string }>(sql`
    insert into ai_usage (id, household_id, user_id, import_job_id, purpose, counts_as_import,
      provider, model, status, created_at)
    select ${id}, ${call.householdId}, ${call.userId}, ${call.importJobId}, ${call.purpose},
      ${counts}, ${call.provider}, ${call.model}, 'pending', ${now.getTime()}
    where (select coalesce(sum(cost_micro_usd), 0) from ai_usage where created_at >= ${start})
        < ${pauseMicroUsd}
      and (${limits.maxCostMicroUsd} is null or (
        select coalesce(sum(cost_micro_usd), 0) from ai_usage
        where household_id = ${call.householdId} and created_at >= ${start}
      ) < ${limits.maxCostMicroUsd})
      and (${counts} = 0 or ${limits.maxImports} is null or (
        select count(*) from ai_usage
        where household_id = ${call.householdId} and created_at >= ${start} and counts_as_import = 1
      ) < ${limits.maxImports})
    returning id`);
  if (row) return { ok: true, id };
  return {
    ok: false,
    refusal: (await fennlMonthCost(db, now)) >= pauseMicroUsd ? "paused" : "monthly_limit",
  };
}

/** Records how a call went. A call with no answer doesn't use up an import. */
export async function finishCall(
  db: Database,
  id: string,
  outcome: { ok: true } | { ok: false; problem: AiProblem },
  tokens: AiTokens,
  costMicroUsd: number,
  now = new Date(),
): Promise<void> {
  await db
    .update(aiUsage)
    .set({
      status: outcome.ok ? "ok" : outcome.problem,
      ...(outcome.ok ? {} : { countsAsImport: 0 }),
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      costMicroUsd,
      finishedAt: now,
    })
    .where(eq(aiUsage.id, id));
}

/** A household's AI imports and estimated cost this month. */
export async function householdMonth(
  db: Database,
  householdId: string,
  now = new Date(),
): Promise<{ imports: number; costMicroUsd: number }> {
  const row = await db
    .select({
      imports: sum(sql`counts_as_import`),
      cost: sum(aiUsage.costMicroUsd),
    })
    .from(aiUsage)
    .where(
      and(eq(aiUsage.householdId, householdId), gte(aiUsage.createdAt, new Date(monthStart(now)))),
    )
    .get();
  return { imports: Number(row?.imports ?? 0), costMicroUsd: Number(row?.cost ?? 0) };
}

/** Fennl's estimated AI cost this month, in millionths of a dollar. */
export async function fennlMonthCost(db: Database, now = new Date()): Promise<number> {
  const row = await db
    .select({ cost: sum(aiUsage.costMicroUsd) })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, new Date(monthStart(now))))
    .get();
  return Number(row?.cost ?? 0);
}

const dollars = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(2)}`;

/**
 * After a call: emails the owner once a month when Fennl's AI cost reaches the alert amount,
 * and once when it reaches the pause amount (from then, AI imports are refused until the month
 * ends or the pause amount is raised in the admin console). Failures to send are logged, not
 * thrown: the import itself has worked.
 */
export async function checkSpending(
  env: Env,
  db: Database,
  config: Pick<AiConfig, "alertMicroUsd" | "pauseMicroUsd">,
  now = new Date(),
): Promise<void> {
  const total = await fennlMonthCost(db, now);
  const month = monthKey(now);
  const notices: { subject: string; lines: string[] }[] = [];
  if (total >= config.pauseMicroUsd && (await claimText(db, "ai_paused_month", month))) {
    notices.push({
      subject: "Fennl: AI imports are paused",
      lines: [
        `The AI's estimated cost this month has reached ${dollars(total)}, the pause amount (${dollars(config.pauseMicroUsd)}).`,
        "AI imports are paused for everyone until the month ends. To restart them sooner, raise the pause amount in the admin console, under AI imports.",
      ],
    });
  }
  if (total >= config.alertMicroUsd && (await claimText(db, "ai_alerted_month", month))) {
    notices.push({
      subject: "Fennl: AI cost alert",
      lines: [
        `The AI's estimated cost this month has reached ${dollars(total)}, past the alert amount (${dollars(config.alertMicroUsd)}).`,
        `AI imports carry on until ${dollars(config.pauseMicroUsd)}, the pause amount. The admin console shows the cost by household, under AI imports.`,
      ],
    });
  }
  if (!env.ADMIN_ALERT_EMAIL) return;
  const send = createEmailSender(env);
  for (const notice of notices) {
    try {
      await send(ownerNoticeEmail(env.ADMIN_ALERT_EMAIL, notice.subject, notice.lines));
    } catch (error) {
      console.error("Couldn't email the AI cost notice", error);
    }
  }
}
