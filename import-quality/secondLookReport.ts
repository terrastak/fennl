import type { SecondLookFinding } from "../shared/aiAnswer";
import type { DraftInput } from "../shared/importDraft";
import type { ImportSource } from "../shared/recipe";
import type { SampleResult } from "./scorecard";

// How well each second-look rule (shared/aiAnswer.ts, secondLookFindings) earns its cost: how
// often it fired on an answer the cheaper model already got right (a wasted call to the stronger
// model) against one it got wrong (a mistake caught). Used by the model comparison
// (aiCompare.ts) and by the replay of saved answers (aiReplay.ts), which re-checks the rules
// on the last comparison's answers without calling the AI again.

/** Which way of reading asked: a model alone, or the switch's first read or second look. */
export type Way = "alone" | "first" | "second_look";

/**
 * Every answer the AI gave in a comparison, saved to import-quality/ai-answers.json (kept with
 * the workflow's run), so the second-look rules can be re-checked on them without calling the AI
 * again (aiReplay.ts).
 */
export interface SavedAnswer {
  /** "photos" or "web". */
  set: string;
  sample: string;
  way: Way;
  model: string;
  source: ImportSource;
  inputs: DraftInput[];
  ok: boolean;
  problem: string | null;
  output: unknown;
  costMicroUsd: number;
}

/** One second look decided on a sample: what set it off, and how good the answers were. */
export interface LookRecord {
  set: string;
  sample: string;
  findings: SecondLookFinding[];
  /** The cheaper model's ingredients and method, 0 to 1 (see cookingScore). */
  first: number;
  /** The stronger model's, when it read it. */
  second: number | null;
}

/** "Right": every expected recipe found, with ingredients and method at least this good. */
export const RIGHT = 0.95;

/**
 * How right the parts that decide the dish are: the ingredients and the method, averaged over
 * the expected recipes (a recipe not found counts 0). Description, times and servings are left
 * out: the test set's saved pages can't measure them fairly (spec.md E8).
 */
export function cookingScore(result: Pick<SampleResult, "scores">): number {
  const parts = result.scores.map((s) => {
    if (!s) return 0;
    const values = [s.fields.ingredients, s.fields.directions].filter(
      (v): v is number => v !== null,
    );
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 1;
  });
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}

/** A rule as the report names it: the reason, and for "unsure" what was unsure. */
function ruleOf(finding: SecondLookFinding): string {
  if (finding.reason !== "unsure") return finding.reason;
  if (finding.detail.startsWith("said unclear")) return "unsure (a note about something unclear)";
  if (finding.detail.includes("line unsure")) return "unsure (an ingredient or method line)";
  return `unsure (${finding.detail.replace(" marked unsure", "")})`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The report's section on the second look: each rule's record, then each sample's findings. */
export function secondLookSection(looks: LookRecord[]): string[] {
  const rules = new Map<string, { fired: number; right: number; wrong: number; better: number }>();
  for (const look of looks) {
    for (const rule of new Set(look.findings.map(ruleOf))) {
      const r = rules.get(rule) ?? { fired: 0, right: 0, wrong: 0, better: 0 };
      r.fired += 1;
      if (look.first >= RIGHT) r.right += 1;
      else r.wrong += 1;
      if (look.second !== null && look.second - look.first >= 0.05) r.better += 1;
      rules.set(rule, r);
    }
  }
  const quiet = looks.filter((l) => l.findings.length === 0);
  const fired = looks.filter((l) => l.findings.length > 0);
  return [
    "## Second looks",
    "",
    `The cheaper model's answer is "right" when every recipe was found with its ingredients and method at least ${pct(RIGHT)} right. A rule earns its cost when it fires on answers that aren't.`,
    "",
    `Second look asked for on ${fired.length} of ${looks.length} samples; on ${fired.filter((l) => l.first >= RIGHT).length} of them the cheaper model was already right. No second look on ${quiet.length}, of which ${quiet.filter((l) => l.first < RIGHT).length} weren't right (missed).`,
    "",
    "| Rule | Fired | Cheaper model already right | Cheaper model wrong | Stronger model did better |",
    "| --- | --- | --- | --- | --- |",
    ...[...rules.entries()]
      .sort((a, b) => b[1].fired - a[1].fired)
      .map(([rule, r]) => `| ${rule} | ${r.fired} | ${r.right} | ${r.wrong} | ${r.better} |`),
    "",
    "### By sample",
    "",
    "| Sample | Cheaper | Stronger | What set it off |",
    "| --- | --- | --- | --- |",
    ...looks.map(
      (l) =>
        `| ${l.sample} | ${pct(l.first)} | ${l.second === null ? "–" : pct(l.second)} | ${
          l.findings
            .map((f) => f.detail.replace(/\|/g, "/").slice(0, 80))
            .join("; ")
            .slice(0, 400) || "–"
        } |`,
    ),
    "",
  ];
}
