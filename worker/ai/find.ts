import { PDF_FIND_SCHEMA, pdfRecipes, type PdfRecipe } from "../../shared/pdfImport";
import type { AiCaller } from "./read";
import { aiConfig } from "./config";
import { FIND_INSTRUCTION, FIND_OUTPUT_TOKENS, FIND_SYSTEM } from "./prompt";
import { NO_TOKENS, type AiPart, type AiProblem, type AiResult } from "./provider";
import { checkSpending, finishCall, reserveCall } from "./usage";

// Finding the recipes in a PDF (phase E12): one quick read by the cheapest model of every page,
// as its text or (a scanned page) its picture, listing each recipe's title and pages. It's
// metered like any AI call ("find") but isn't an import: each recipe read afterwards is (owner's
// choice 2026-10-21). The answer is only a starting point; the person can change it.

export type FindProblem = "import_not_included" | "monthly_limit" | "paused" | "unavailable";

export async function findPdfRecipes(
  caller: AiCaller,
  parts: AiPart[],
  pageCount: number,
): Promise<{ ok: true; recipes: PdfRecipe[] } | { ok: false; problem: FindProblem }> {
  if (!caller.plan.import_ai_enabled) return { ok: false, problem: "import_not_included" };
  const config = await aiConfig(caller.env, caller.db);
  const model = config?.models[0];
  if (!config || !model) return { ok: false, problem: "unavailable" };
  const reserved = await reserveCall(
    caller.db,
    {
      householdId: caller.householdId,
      userId: caller.userId,
      importJobId: null,
      purpose: "find",
      provider: config.provider.name,
      model,
    },
    {
      maxImports: caller.plan.ai_imports_per_month,
      maxCostMicroUsd:
        caller.plan.ai_cost_cents_per_month === null
          ? null
          : caller.plan.ai_cost_cents_per_month * 10_000,
    },
    config.pauseMicroUsd,
  );
  if (!reserved.ok) return { ok: false, problem: reserved.refusal };

  const result: AiResult = await config.provider
    .read({
      model,
      system: FIND_SYSTEM,
      parts,
      instruction: FIND_INSTRUCTION,
      schema: PDF_FIND_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
      maxOutputTokens: FIND_OUTPUT_TOKENS,
    })
    .catch((error: unknown) => ({
      ok: false as const,
      problem: "failed" as const,
      tokens: NO_TOKENS,
      detail: String(error).slice(0, 500),
    }));
  const recipes = result.ok ? pdfRecipes(result.output, pageCount) : null;
  const outcome: { ok: true } | { ok: false; problem: AiProblem } = !result.ok
    ? { ok: false, problem: result.problem }
    : recipes
      ? { ok: true }
      : { ok: false, problem: "bad_output" };
  await finishCall(
    caller.db,
    reserved.id,
    outcome,
    result.tokens,
    config.provider.costMicroUsd(model, result.tokens),
  );
  await checkSpending(caller.env, caller.db, config);
  return recipes ? { ok: true, recipes } : { ok: false, problem: "unavailable" };
}
