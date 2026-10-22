import { photoLabels, type PhotoLabel, type PhotoLabels } from "../../shared/photoOrder";
import type { AiCaller } from "./read";
import { aiConfig } from "./config";
import { arrangeRequest, type ArrangeInput } from "./arrangeRequest";
import { NO_TOKENS } from "./provider";
import { checkSpending, finishCall, reserveCall } from "./usage";

// Putting a recipe's photos in order (phase D4; spec.md D4): one quick look by the cheapest model
// at the photos' small copies beside the recipe's method, saying what each shows. Metered like
// any AI call ("arrange") but never counted as an import (owner's choice 2026-10-22), and still
// under the household's hidden cost limit and Fennl's pause.

export type ArrangeProblem = "monthly_limit" | "paused" | "unavailable";

/** What the AI makes of the photos, in the order given; or why there's no answer. */
export async function labelPhotos(
  caller: AiCaller,
  input: ArrangeInput,
): Promise<{ ok: true; labels: PhotoLabels } | { ok: false; problem: ArrangeProblem }> {
  const config = await aiConfig(caller.env, caller.db);
  const model = config?.models[0];
  if (!config || !model) return { ok: false, problem: "unavailable" };
  const reserved = await reserveCall(
    caller.db,
    {
      householdId: caller.householdId,
      userId: caller.userId,
      importJobId: null,
      purpose: "arrange",
      provider: config.provider.name,
      model,
    },
    {
      maxImports: null,
      maxCostMicroUsd:
        caller.plan.ai_cost_cents_per_month === null
          ? null
          : caller.plan.ai_cost_cents_per_month * 10_000,
    },
    config.pauseMicroUsd,
  );
  if (!reserved.ok) return { ok: false, problem: reserved.refusal };
  const result = await config.provider
    .read(arrangeRequest(model, input))
    .catch((error: unknown) => ({
      ok: false as const,
      problem: "failed" as const,
      tokens: NO_TOKENS,
      detail: String(error).slice(0, 500),
    }));
  const labels = result.ok
    ? photoLabels(result.output, input.photos.length, input.steps.length)
    : null;
  await finishCall(
    caller.db,
    reserved.id,
    labels ? { ok: true } : { ok: false, problem: result.ok ? "bad_output" : result.problem },
    result.tokens,
    config.provider.costMicroUsd(model, result.tokens),
  );
  await checkSpending(caller.env, caller.db, config);
  return labels ? { ok: true, labels } : { ok: false, problem: "unavailable" };
}

/** Labels for a whole gallery, from labels of the photos that could be shown (by their places). */
export function galleryLabels(count: number, shown: number[], labels: PhotoLabels): PhotoLabels {
  const photos: (PhotoLabel | null)[] = Array.from({ length: count }, () => null);
  shown.forEach((at, i) => {
    photos[at] = labels.photos[i] ?? null;
  });
  return { photos, cover: shown[labels.cover] ?? 0 };
}
