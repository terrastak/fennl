import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SECOND_LOOK_DEFAULTS,
  answerToDrafts,
  isAiAnswer,
  secondLookFindings,
  withoutBadParts,
  type SecondLookRules,
} from "../shared/aiAnswer";
import type { RecipeDraft } from "../shared/importDraft";
import { loadExpected, scoreDrafts } from "./scorecard";
import {
  cookingScore,
  secondLookSection,
  type LookRecord,
  type SavedAnswer,
} from "./secondLookReport";

// Re-checks the second-look rules (shared/aiAnswer.ts) on the answers a model comparison saved
// (ai-answers.json, kept with the "AI model comparison" workflow's run), without calling the AI:
// free, so the rules can be tuned as often as needed.
//
//   npm run ai:replay -- path/to/ai-answers.json
//
// AI_MISSING_AMOUNTS and AI_ODD_AMOUNT try other thresholds (as the admin console would set them).
// Where the switch didn't ask the stronger model, its answer from reading alone stands in.

function drafts(answer: SavedAnswer | undefined): RecipeDraft[] | null {
  if (!answer?.ok || !isAiAnswer(answer.output)) return null;
  return answerToDrafts(answer.output, {
    source: answer.source,
    inputs: answer.inputs,
    photos: [],
    model: answer.model,
  }).flatMap((d) => {
    const kept = withoutBadParts(d, null);
    return kept ? [kept] : [];
  });
}

const threshold = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== "" ? n : fallback;
};

async function main() {
  const path = process.argv[2] ?? join(import.meta.dirname, "ai-answers.json");
  const saved = JSON.parse(await readFile(path, "utf8")) as {
    cheap: string;
    strong: string;
    answers: SavedAnswer[];
  };
  const rules: SecondLookRules = {
    missingAmounts: threshold("AI_MISSING_AMOUNTS", SECOND_LOOK_DEFAULTS.missingAmounts),
    oddAmount: threshold("AI_ODD_AMOUNT", SECOND_LOOK_DEFAULTS.oddAmount),
  };
  const looks: LookRecord[] = [];
  for (const first of saved.answers.filter((a) => a.way === "first")) {
    const same = (a: SavedAnswer) => a.set === first.set && a.sample === first.sample;
    const second =
      saved.answers.find((a) => same(a) && a.way === "second_look") ??
      saved.answers.find((a) => same(a) && a.way === "alone" && a.model === saved.strong);
    const expected = (await loadExpected(first.sample)) ?? [];
    const firstDrafts = drafts(first);
    looks.push({
      set: first.set,
      sample: first.sample,
      findings: firstDrafts
        ? secondLookFindings(firstDrafts, rules)
        : [{ reason: "no_answer", detail: "no usable answer" }],
      first: cookingScore(scoreDrafts(expected, firstDrafts ?? [])),
      second: second ? cookingScore(scoreDrafts(expected, drafts(second) ?? [])) : null,
    });
  }
  console.log(
    [
      `# Second-look rules on saved answers (${saved.cheap}, then ${saved.strong})`,
      "",
      `Rules: ${rules.missingAmounts} lines with no amount; amounts over ${rules.oddAmount} cups or spoons.`,
      "",
      ...secondLookSection(looks),
    ].join("\n"),
  );
}

await main();
