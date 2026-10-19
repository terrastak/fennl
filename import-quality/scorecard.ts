import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { draftContent, draftIssues, type RecipeDraft } from "../shared/importDraft";
import {
  SCORED_FIELDS,
  matchRecipes,
  scoreRecipe,
  type ExpectedRecipe,
  type LineCounts,
  type RecipeScore,
  type ScoredField,
} from "../shared/importScore";

// The import quality scorecard (phase E1; spec.md E1). Runs every importer over the quality test
// set (samples.json, with the correct answers in expected/) and reports how close each came,
// field by field. Run with `npm run import:quality`; CI runs it with the unit tests and adds the
// report to the run's summary.

export const SAMPLE_KINDS = ["web", "card", "cookbook", "screenshot", "pdf", "paprika"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

export interface Sample {
  id: string;
  kind: SampleKind;
  /** Files, relative to the repository's root, in reading order (a card's front, then back). */
  inputs: string[];
  /** For a web page: its address. */
  url?: string;
  /** What makes it a useful test ("angled photo", "two recipes on one page"). */
  notes?: string;
}

export interface InputFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

/**
 * Something that turns a sample's files into recipe drafts (shared/importDraft.ts): one per
 * importer as stages E3 to E13 build them. Several drafts for a file of several recipes.
 */
export interface Importer {
  name: string;
  kinds: readonly SampleKind[];
  /**
   * Reads data the source publishes as data (a page's Schema.org recipe, a Paprika file), so
   * what decides how the dish turns out must come out exactly right on every sample: the
   * ingredients, the directions, the times and the servings count (agreed 2026-10-11). CI fails
   * otherwise.
   */
  exact?: boolean;
  /** Whether it reads this sample at all (the AI's web reading skips a saved copy with no text). */
  accepts?(sample: Sample): Promise<boolean>;
  run(files: InputFile[], sample: Sample): Promise<RecipeDraft[]>;
}

/** The fields an exact importer must get exactly right. */
export const COOKING_FIELDS = ["ingredients", "directions", "times"] as const;

const root = join(import.meta.dirname, "..");

export async function loadSamples(): Promise<Sample[]> {
  const text = await readFile(join(import.meta.dirname, "samples.json"), "utf8");
  return JSON.parse(text) as Sample[];
}

/** What's wrong with the test set itself: bad entries, missing files. */
export async function testSetIssues(samples: Sample[]): Promise<string[]> {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const s of samples) {
    if (!/^[a-z0-9-]+$/.test(s.id)) issues.push(`${s.id}: the id should be lowercase-with-dashes`);
    if (ids.has(s.id)) issues.push(`${s.id}: used twice`);
    ids.add(s.id);
    if (!(SAMPLE_KINDS as readonly string[]).includes(s.kind)) {
      issues.push(`${s.id}: unknown kind "${s.kind}"`);
    }
    if (!s.inputs.length && s.kind !== "web") issues.push(`${s.id}: no input files`);
    for (const input of s.inputs) {
      await readFile(join(root, input)).catch(() => issues.push(`${s.id}: ${input} not found`));
    }
    const expected = await loadExpected(s.id).catch((e: unknown) => {
      issues.push(`${s.id}: expected/${s.id}.json can't be read (${String(e)})`);
      return undefined;
    });
    for (const [i, e] of (expected ?? []).entries()) {
      const at = `${s.id}: expected recipe ${i + 1}`;
      if (typeof e.title !== "string" || !e.title) issues.push(`${at} needs a title`);
      for (const key of ["ingredients", "directions"] as const) {
        const list = e[key];
        if (
          list !== undefined &&
          !(Array.isArray(list) && list.every((l) => typeof l === "string"))
        ) {
          issues.push(`${at}: ${key} should be a list of lines`);
        }
      }
    }
  }
  return issues;
}

/** The correct answer(s): null when not written yet. */
export async function loadExpected(id: string): Promise<ExpectedRecipe[] | null> {
  let text: string;
  try {
    text = await readFile(join(import.meta.dirname, "expected", `${id}.json`), "utf8");
  } catch {
    return null;
  }
  const value = JSON.parse(text) as ExpectedRecipe | ExpectedRecipe[];
  return Array.isArray(value) ? value : [value];
}

export interface SampleResult {
  sample: Sample;
  importer: string;
  exact: boolean;
  /** One score per expected recipe (0 overall when nothing was found for it). */
  scores: (RecipeScore | null)[];
  overall: number;
  /** Found recipes that match nothing expected. */
  extra: number;
  problems: string[];
  ms: number;
}

async function runOne(importer: Importer, sample: Sample, expected: ExpectedRecipe[]) {
  const started = performance.now();
  const problems: string[] = [];
  let drafts: RecipeDraft[] = [];
  try {
    const files = await Promise.all(
      sample.inputs.map(async (path) => ({
        path,
        name: basename(path),
        bytes: new Uint8Array(await readFile(join(root, path))),
      })),
    );
    drafts = await importer.run(files, sample);
  } catch (error) {
    problems.push(`failed: ${String(error)}`);
  }
  const scored = scoreDrafts(expected, drafts);
  return {
    sample,
    importer: importer.name,
    exact: importer.exact ?? false,
    ...scored,
    problems: [...problems, ...scored.problems],
    ms: Math.round(performance.now() - started),
  } satisfies SampleResult;
}

/** How a sample's drafts compare with its correct answers (invalid drafts count as not found). */
export function scoreDrafts(
  expected: ExpectedRecipe[],
  drafts: RecipeDraft[],
): Pick<SampleResult, "scores" | "overall" | "extra" | "problems"> {
  const problems: string[] = [];
  const valid = drafts.filter((d, i) => {
    const issues = draftIssues(d);
    if (issues.length) {
      problems.push(
        `draft ${i + 1} invalid: ${issues.map((x) => `${x.path} ${x.problem}`).join(", ")}`,
      );
    }
    return !issues.length;
  });
  const found = valid.map(draftContent);
  const { pairs, extra } = matchRecipes(expected, found);
  const scores = pairs.map((p) => {
    const recipe = p.found === null ? undefined : found[p.found];
    return recipe ? scoreRecipe(expected[p.expected] as ExpectedRecipe, recipe) : null;
  });
  const overall = scores.reduce((s, r) => s + (r?.overall ?? 0), 0) / Math.max(1, scores.length);
  return { scores, overall, extra, problems };
}

export interface Scorecard {
  samples: Sample[];
  /** Samples with a correct answer written. */
  answered: number;
  results: SampleResult[];
  /** Kinds with samples but no importer yet. */
  uncovered: { kind: SampleKind; samples: number }[];
}

/**
 * Where an exact importer got something that decides how the dish turns out wrong: "nyt-7up-
 * sheet-cake: ingredients 96%". Empty when all is right.
 */
export function exactMisses(card: Scorecard): string[] {
  const misses: string[] = [];
  for (const r of card.results.filter((x) => x.exact)) {
    const at = `${r.sample.id} (${r.importer})`;
    if (r.problems.length) misses.push(`${at}: ${r.problems.join("; ")}`);
    r.scores.forEach((score, i) => {
      const which = r.scores.length > 1 ? ` recipe ${i + 1}` : "";
      if (!score) return misses.push(`${at}${which}: not found`);
      for (const field of COOKING_FIELDS) {
        const value = score.fields[field];
        if (value !== null && value < 1) misses.push(`${at}${which}: ${field} ${pct(value)}`);
      }
      if (score.servingsCount === 0) misses.push(`${at}${which}: servings count`);
    });
  }
  return misses;
}

export async function runScorecard(importers: readonly Importer[]): Promise<Scorecard> {
  const samples = await loadSamples();
  const results: SampleResult[] = [];
  let answered = 0;
  for (const sample of samples) {
    const expected = await loadExpected(sample.id);
    if (!expected) continue;
    answered += 1;
    for (const importer of importers.filter((i) => i.kinds.includes(sample.kind))) {
      if (importer.accepts && !(await importer.accepts(sample))) continue;
      results.push(await runOne(importer, sample, expected));
    }
  }
  const uncovered = SAMPLE_KINDS.filter((k) => !importers.some((i) => i.kinds.includes(k)))
    .map((kind) => ({ kind, samples: samples.filter((s) => s.kind === kind).length }))
    .filter((u) => u.samples > 0);
  return { samples, answered, results, uncovered };
}

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

const LABELS: Record<ScoredField, string> = {
  title: "Title",
  description: "Description",
  ingredients: "Ingredients",
  directions: "Directions",
  times: "Times",
  servings: "Servings",
  notes: "Notes",
  source: "Source",
};

function fieldMean(results: SampleResult[], field: ScoredField): number | null {
  const values = results.flatMap((r) =>
    r.scores.map((s) => (s ? s.fields[field] : 0)).filter((v): v is number => v !== null),
  );
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** The report, as Markdown (it reads fine as plain text too). */
export function reportMarkdown(card: Scorecard): string {
  const out: string[] = ["# Import quality", ""];
  const byKind = SAMPLE_KINDS.map(
    (k) => `${k} ${card.samples.filter((s) => s.kind === k).length}`,
  ).join(", ");
  out.push(
    `Test set: ${card.samples.length} samples (${byKind}); correct answers written for ${card.answered}.`,
    "",
  );

  const importers = [...new Set(card.results.map((r) => r.importer))];
  if (importers.length) {
    out.push(
      "## By importer",
      "",
      `| Importer | Samples | Overall | ${SCORED_FIELDS.map((f) => LABELS[f]).join(" | ")} |`,
      `| --- | --- | --- | ${SCORED_FIELDS.map(() => "---").join(" | ")} |`,
    );
    for (const name of importers) {
      const rs = card.results.filter((r) => r.importer === name);
      const overall = rs.reduce((s, r) => s + r.overall, 0) / rs.length;
      out.push(
        `| ${name} | ${rs.length} | ${pct(overall)} | ${SCORED_FIELDS.map((f) => pct(fieldMean(rs, f))).join(" | ")} |`,
      );
    }
    out.push(
      "",
      "## Samples",
      "",
      "| Sample | Kind | Importer | Overall | Ingredients | Directions | Notes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const r of card.results) {
      const lines = (k: "ingredients" | "directions") =>
        r.scores
          .map((s) => s?.[k])
          .filter((c): c is LineCounts => Boolean(c))
          .map((c) => `${c.exact}/${c.expected} exact, ${c.missing} missing, ${c.extra} extra`)
          .join("; ") || "–";
      const notes = [
        ...r.problems,
        ...(r.extra ? [`${r.extra} recipe(s) found that aren't expected`] : []),
        ...(r.scores.some((s) => s === null) ? ["a recipe wasn't found"] : []),
      ].join("; ");
      out.push(
        `| ${r.sample.id} | ${r.sample.kind} | ${r.importer} | ${pct(r.overall)} | ${lines("ingredients")} | ${lines("directions")} | ${notes || "–"} |`,
      );
    }
    out.push("");
  } else {
    out.push("No importers yet: they arrive with phases E3 (web pages) to E13 (Paprika).", "");
  }
  const misses = exactMisses(card);
  if (card.results.some((r) => r.exact)) {
    out.push(
      "## Must be exact",
      "",
      "Importers reading published data must get the ingredients, directions, times and servings count exactly right.",
      "",
      ...(misses.length ? misses.map((m) => `- ${m}`) : ["All exact."]),
      "",
    );
  }
  if (card.uncovered.length) {
    out.push(
      "## Not covered yet",
      "",
      ...card.uncovered.map((u) => `- ${u.kind}: ${u.samples} sample(s), no importer yet`),
      "",
    );
  }
  return out.join("\n");
}
