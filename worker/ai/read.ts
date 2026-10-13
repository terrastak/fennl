import { and, eq, sql } from "drizzle-orm";
import {
  AI_ANSWER_SCHEMA,
  answerToDrafts,
  isAiAnswer,
  secondLookReasons,
  type SecondLookReason,
} from "../../shared/aiAnswer";
import type { Entitlements } from "../../shared/entitlements";
import {
  draftIssues,
  type DraftInput,
  type DraftPhoto,
  type RecipeDraft,
} from "../../shared/importDraft";
import {
  importPhotoKey,
  type AiPartRecord,
  type AiProvenance,
  type ReadAgainError,
} from "../../shared/importJobs";
import type { ImportSource } from "../../shared/recipe";
import type { Database } from "../db/client";
import { importJob } from "../db/schema";
import { aiConfig, effortFor, MAX_OUTPUT_TOKENS, type AiConfig } from "./config";
import { instructionFor, SYSTEM_PROMPT } from "./prompt";
import { NO_TOKENS, type AiPart, type AiProblem, type AiResult } from "./provider";
import { checkSpending, finishCall, reserveCall, type AiPurpose } from "./usage";

// Reading a recipe with the AI (phase E7; decided by the owner 2026-10-12):
//
// 1. The cheapest configured model reads it (Claude Haiku to start).
// 2. If its answer looks wrong (shared/aiAnswer.ts, secondLookReasons: unsure parts, missing
//    parts, amounts that don't add up, no usable answer), the next stronger model reads it once
//    more, automatically. This second look doesn't count as another import.
// 3. On the review screen, "Read again" has the next stronger model read it once more, by hand.
//    Once only: after that, the person corrects what's left.
//
// Every call is metered and checked against the month's limits first (worker/ai/usage.ts).
// Import code (E8 to E12) calls readWithAi or createAiImport, never a provider.

/** Who is importing, and what their household's plan allows. */
export interface AiCaller {
  env: Env;
  db: Database;
  householdId: string;
  userId: string;
  plan: Entitlements;
}

export interface AiReadInput {
  source: ImportSource;
  /** What to read, in order. */
  parts: AiPart[];
  /** The draft's inputs: one per part, in the same order. */
  inputs: DraftInput[];
  /** Inputs to keep with the recipe (a card itself, as an import original). */
  photos: DraftPhoto[];
}

export type AiReadProblem =
  | "import_not_included"
  | "monthly_limit"
  | "paused"
  /** No AI is set up on this server, or every read failed. */
  | "unavailable"
  /** It was read, but holds no recipe. */
  | "no_recipe";

export type AiReadResult =
  | {
      ok: true;
      drafts: RecipeDraft[];
      /** Which model (in the configured order) the drafts are from. */
      level: number;
      /** Every model that read it, in order. */
      models: string[];
      secondLook: SecondLookReason[];
    }
  | { ok: false; problem: AiReadProblem };

interface Attempt {
  /** Null: no usable answer. Empty: an answer with no recipe in it. */
  drafts: RecipeDraft[] | null;
  refusal: "monthly_limit" | "paused" | null;
}

async function attempt(
  caller: AiCaller,
  config: AiConfig,
  input: AiReadInput,
  level: number,
  purpose: AiPurpose,
  importJobId: string | null,
): Promise<Attempt> {
  const { db, plan } = caller;
  const model = config.models[level];
  if (!model) return { drafts: null, refusal: null };
  const reserved = await reserveCall(
    db,
    {
      householdId: caller.householdId,
      userId: caller.userId,
      importJobId,
      purpose,
      provider: config.provider.name,
      model,
    },
    {
      maxImports: plan.ai_imports_per_month,
      maxCostMicroUsd:
        plan.ai_cost_cents_per_month === null ? null : plan.ai_cost_cents_per_month * 10_000,
    },
    config.pauseMicroUsd,
  );
  if (!reserved.ok) return { drafts: null, refusal: reserved.refusal };

  // A provider reports its own failures; one that throws still mustn't keep the import.
  const result: AiResult = await config.provider
    .read({
      model,
      system: SYSTEM_PROMPT,
      parts: input.parts,
      instruction: instructionFor(input.source),
      schema: AI_ANSWER_SCHEMA as unknown as Record<string, unknown>,
      effort: effortFor(level),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
    .catch((error: unknown) => ({
      ok: false as const,
      problem: "failed" as const,
      tokens: NO_TOKENS,
      detail: String(error).slice(0, 500),
    }));
  let drafts: RecipeDraft[] | null = null;
  let outcome: { ok: true } | { ok: false; problem: AiProblem } = { ok: true };
  if (!result.ok) {
    outcome = { ok: false, problem: result.problem };
  } else if (!isAiAnswer(result.output)) {
    outcome = { ok: false, problem: "bad_output" };
  } else {
    drafts = answerToDrafts(result.output, {
      source: input.source,
      inputs: input.inputs,
      photos: input.photos,
      model,
    }).filter((draft) => draftIssues(draft, plan.max_recipe_bytes).length === 0);
    // An answer whose every recipe broke the rules isn't usable either.
    if (drafts.length === 0 && result.output.recipes.length > 0) drafts = null;
  }
  await finishCall(
    db,
    reserved.id,
    outcome,
    result.tokens,
    config.provider.costMicroUsd(model, result.tokens),
  );
  await checkSpending(caller.env, db, config);
  return { drafts, refusal: null };
}

/**
 * Reads a recipe: the model at `level` (the cheapest, for a new import), and, when its answer
 * looks wrong and `secondLook` allows, the next one up.
 */
export async function readWithAi(
  caller: AiCaller,
  input: AiReadInput,
  options: {
    level?: number;
    purpose?: Exclude<AiPurpose, "second_look">;
    secondLook?: boolean;
    importJobId?: string | null;
    config?: AiConfig | null;
  } = {},
): Promise<AiReadResult> {
  if (!caller.plan.import_ai_enabled) return { ok: false, problem: "import_not_included" };
  const config = options.config ?? (await aiConfig(caller.env, caller.db));
  const level = options.level ?? 0;
  if (!config || level >= config.models.length) return { ok: false, problem: "unavailable" };
  const jobId = options.importJobId ?? null;

  const first = await attempt(caller, config, input, level, options.purpose ?? "read", jobId);
  if (first.refusal) return { ok: false, problem: first.refusal };
  const used = [config.models[level] as string];
  // No recipe found on what the person chose to import is itself suspect: it gets a second look.
  const reasons = first.drafts
    ? secondLookReasons(first.drafts, config.rules)
    : ["no_answer" as const];
  if (reasons.length === 0 || options.secondLook === false || level + 1 >= config.models.length) {
    return finish(first.drafts, level, used, reasons);
  }

  const second = await attempt(caller, config, input, level + 1, "second_look", jobId);
  if (second.drafts && second.drafts.length > 0) {
    used.push(config.models[level + 1] as string);
    return finish(second.drafts, level + 1, used, reasons);
  }
  if (second.drafts === null && !second.refusal) used.push(config.models[level + 1] as string);
  // The second look found nothing usable (or wasn't allowed): keep what the first found.
  return finish(first.drafts, level, used, reasons);
}

function finish(
  drafts: RecipeDraft[] | null,
  level: number,
  models: string[],
  secondLook: SecondLookReason[],
): AiReadResult {
  if (drafts === null) return { ok: false, problem: "unavailable" };
  if (drafts.length === 0) return { ok: false, problem: "no_recipe" };
  return { ok: true, drafts, level, models, secondLook };
}

/**
 * A new AI import: reads what the person gave, keeps the photos and PDFs (so "Read again" can
 * read them, and the review screen show them), and makes a draft for each recipe found, waiting
 * for review. Returns the new jobs' IDs. E8 to E12 call this with their own kind of input.
 */
export async function createAiImport(
  caller: AiCaller,
  input: AiReadInput,
  now = new Date(),
): Promise<{ ok: true; jobIds: string[] } | { ok: false; problem: AiReadProblem }> {
  const config = await aiConfig(caller.env, caller.db);
  const read = await readWithAi(caller, input, { config });
  if (!read.ok) return read;

  const ids = read.drafts.map(() => crypto.randomUUID());
  const firstId = ids[0] as string;
  // Kept once, under the first draft; the others point at the same files.
  const parts: AiPartRecord[] = await Promise.all(
    input.parts.map(async (part, n): Promise<AiPartRecord> => {
      if (part.kind === "text") return { kind: "text", text: part.text, label: part.label };
      const key = importPhotoKey(firstId, n);
      await caller.env.IMAGES.put(key, part.bytes, {
        httpMetadata: { contentType: part.kind === "pdf" ? "application/pdf" : part.mediaType },
      });
      return part.kind === "pdf"
        ? { kind: "pdf", key, label: part.label }
        : { kind: "image", mediaType: part.mediaType, key, label: part.label };
    }),
  );
  const batchId = ids.length > 1 ? crypto.randomUUID() : null;
  await caller.db.insert(importJob).values(
    read.drafts.map((draft, index) => {
      const provenance: AiProvenance = {
        ai: {
          models: read.models,
          level: read.level,
          secondLook: read.secondLook,
          rereadAt: null,
          index,
          parts,
        },
      };
      return {
        id: ids[index] as string,
        householdId: caller.householdId,
        userId: caller.userId,
        batchId,
        source: input.source,
        status: "ready",
        draft: JSON.stringify(draft),
        provenance: JSON.stringify(provenance),
        error: null,
        recipeId: null,
        createdAt: now,
        updatedAt: now,
      };
    }),
  );
  return { ok: true, jobIds: ids };
}

/** Whether "Read again" is on offer for a job: AI-read, not yet read again, a stronger model left. */
export function canReadAgain(provenance: unknown, config: AiConfig | null): boolean {
  const ai = (provenance as Partial<AiProvenance> | null)?.ai;
  return Boolean(ai && ai.rereadAt === null && config && ai.level + 1 < config.models.length);
}

/**
 * "Read again" (decided 2026-10-12): the next stronger model reads the draft's photos once more,
 * by itself, and its answer replaces the draft. Once per draft, claimed in the same statement
 * that checks it, so a second press (or a second tab) can't read it twice; given back if the
 * read doesn't happen, so a month's limit or an outage doesn't use up the one try.
 */
export async function readAgain(
  caller: AiCaller,
  jobId: string,
  now = new Date(),
): Promise<{ ok: true; draft: RecipeDraft } | { ok: false; problem: ReadAgainError }> {
  const { db } = caller;
  const job = await db
    .select()
    .from(importJob)
    .where(
      and(
        eq(importJob.id, jobId),
        eq(importJob.userId, caller.userId),
        eq(importJob.householdId, caller.householdId),
        eq(importJob.status, "ready"),
      ),
    )
    .get();
  const ai = job ? (JSON.parse(job.provenance) as Partial<AiProvenance>).ai : undefined;
  if (!job || !ai) return { ok: false, problem: "not_found" };
  if (ai.rereadAt !== null) return { ok: false, problem: "already_read_again" };
  if (!caller.plan.import_ai_enabled) return { ok: false, problem: "import_not_included" };
  const config = await aiConfig(caller.env, db);
  if (!config) return { ok: false, problem: "unavailable" };
  const level = ai.level + 1;
  if (level >= config.models.length) return { ok: false, problem: "none_stronger" };

  const claimed = await db
    .update(importJob)
    .set({
      provenance: sql`json_set(${importJob.provenance}, '$.ai.rereadAt', ${now.toISOString()})`,
    })
    .where(
      and(
        eq(importJob.id, job.id),
        eq(importJob.status, "ready"),
        sql`json_extract(${importJob.provenance}, '$.ai.rereadAt') is null`,
      ),
    )
    .returning({ id: importJob.id })
    .all();
  if (claimed.length === 0) return { ok: false, problem: "already_read_again" };
  const giveBack = () =>
    db
      .update(importJob)
      .set({ provenance: sql`json_set(${importJob.provenance}, '$.ai.rereadAt', null)` })
      .where(eq(importJob.id, job.id));

  const parts: AiPart[] = [];
  for (const part of ai.parts) {
    if (part.kind === "text") {
      parts.push(part);
      continue;
    }
    const object = await caller.env.IMAGES.get(part.key);
    if (!object) {
      await giveBack();
      return { ok: false, problem: "inputs_gone" };
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    parts.push(
      part.kind === "pdf"
        ? { kind: "pdf", bytes, label: part.label }
        : { kind: "image", mediaType: part.mediaType, bytes, label: part.label },
    );
  }
  const before = JSON.parse(job.draft ?? "null") as RecipeDraft | null;
  const read = await readWithAi(
    caller,
    {
      source: job.source as ImportSource,
      parts,
      inputs: before?.inputs ?? [],
      photos: before?.photos ?? [],
    },
    { level, purpose: "reread", secondLook: false, importJobId: job.id, config },
  );
  if (!read.ok) {
    await giveBack();
    return {
      ok: false,
      problem:
        read.problem === "no_recipe" || read.problem === "import_not_included"
          ? "unavailable"
          : read.problem,
    };
  }
  const draft = read.drafts[ai.index] ?? (read.drafts[0] as RecipeDraft);
  const provenance: AiProvenance = {
    ai: {
      ...(ai as AiProvenance["ai"]),
      models: [...(ai.models ?? []), ...read.models],
      level,
      rereadAt: now.toISOString(),
    },
  };
  await db
    .update(importJob)
    .set({
      draft: JSON.stringify(draft),
      provenance: JSON.stringify(provenance),
      updatedAt: now,
    })
    .where(eq(importJob.id, job.id));
  return { ok: true, draft };
}
