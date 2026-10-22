import type { RecipeContent } from "./recipe";

/**
 * Import quality scoring (phase E1): how close an importer's recipe is to the correct answer,
 * field by field, from 0 (nothing right) to 1 (all of it). The scorecard (import-quality/) runs
 * this over the quality test set, so importers and AI models are compared by numbers, not
 * impressions (spec.md E7, E14).
 *
 * Small differences that don't matter to a cook are forgiven: letter case, spacing, curly
 * quotes, "½" against "1/2", bullets and step numbers. Everything else counts.
 */

/**
 * A correct answer, written by hand (import-quality/expected/). Only the fields given are
 * scored: leave one out when the source doesn't have it and it doesn't matter what's found.
 */
export interface ExpectedRecipe {
  title?: string;
  description?: string;
  /** One per line, as printed. A section heading is written with a leading "## ". */
  ingredients?: string[];
  directions?: string[];
  /** Minutes, or null for "the source gives none". */
  times?: { prep?: number | null; cook?: number | null; total?: number | null };
  servings?: { count?: number | null; yield?: string | null };
  notes?: string;
  source?: {
    name?: string | null;
    url?: string | null;
    author?: string | null;
    page?: string | null;
  };
}

export const SCORED_FIELDS = [
  "title",
  "description",
  "ingredients",
  "directions",
  "times",
  "servings",
  "notes",
  "source",
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

/** Each field's score, or null when the correct answer doesn't give that field. */
export type FieldScores = Record<ScoredField, number | null>;

export interface LineCounts {
  expected: number;
  found: number;
  /** Lines that match all but trivially (score 0.98 or more). */
  exact: number;
  /** Expected lines with no reasonable match. */
  missing: number;
  /** Found lines that match nothing expected. */
  extra: number;
}

export interface RecipeScore {
  fields: FieldScores;
  /** The mean of the fields scored. */
  overall: number;
  ingredients: LineCounts | null;
  directions: LineCounts | null;
  /** The servings count alone (it drives scaling): 1 right, 0 wrong, null when not given. */
  servingsCount: number | null;
}

const FRACTIONS: Record<string, string> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
  "⅕": "1/5",
  "⅖": "2/5",
  "⅗": "3/5",
  "⅘": "4/5",
  "⅙": "1/6",
  "⅚": "5/6",
};

/** Text as compared: the differences that don't matter taken out. */
export function normalize(text: string): string {
  return (
    text
      // Fractions first: NFKC would make "1½" into "11⁄2".
      .replace(/[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]/gu, (f) => ` ${FRACTIONS[f] ?? f}`)
      .normalize("NFKC")
      .replace(/⁄/g, "/")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/^\s*(?:[•◦▪●○■□▢☐*-]|\d+[.)])\s+/u, "")
      // "Step 1 Spread…", and "Step 1Spread…" as some pages run the two together.
      .replace(/^\s*step\s*\d+\s*[.:)-]?\s*(?=\S)/iu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\s*([,.;:!?)])/g, "$1")
      .replace(/([(])\s*/g, "$1")
      .replace(/(\d) +(\d+\/\d+)/g, "$1 $2")
      .trim()
      .replace(/[.:;,]+$/u, "")
  );
}

/** Edit distance (Levenshtein), in characters. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Words in common, as an F1 score: for long text, where character edits would be slow. */
function wordsScore(a: string, b: string): number {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const w of s.split(" ").filter(Boolean)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const x = count(a);
  const y = count(b);
  let common = 0;
  for (const [w, n] of x) common += Math.min(n, y.get(w) ?? 0);
  const total =
    [...x.values()].reduce((s, n) => s + n, 0) + [...y.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 1 : (2 * common) / total;
}

/** How alike two texts are, 0 to 1, after normalizing. Two empty texts are alike. */
export function textScore(expected: string, found: string): number {
  const a = normalize(expected);
  const b = normalize(found);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  if (a.length + b.length > 600) return wordsScore(a, b);
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}

interface Line {
  text: string;
  heading: boolean;
}

/** A hand-written line: "## For the dough" is a heading. */
function expectedLine(line: string): Line {
  return line.startsWith("## ")
    ? { text: line.slice(3), heading: true }
    : { text: line, heading: false };
}

/** Below this, two lines aren't the same line. */
const SAME_LINE = 0.6;

/**
 * Lists of lines: every expected line paired with its best match (each found line used once,
 * best pairs first), a heading marked as a step (or the reverse) worth half. The score is the
 * matched similarity over the longer list, so missing lines and extra lines both cost.
 */
export function linesScore(
  expected: readonly Line[],
  found: readonly Line[],
): { score: number; counts: LineCounts } {
  const pairs: { e: number; f: number; s: number }[] = [];
  expected.forEach((e, i) =>
    found.forEach((f, j) => {
      const s = textScore(e.text, f.text);
      if (s >= SAME_LINE) pairs.push({ e: i, f: j, s: e.heading === f.heading ? s : s / 2 });
    }),
  );
  pairs.sort((a, b) => b.s - a.s);
  const usedE = new Set<number>();
  const usedF = new Set<number>();
  let total = 0;
  let exact = 0;
  for (const p of pairs) {
    if (usedE.has(p.e) || usedF.has(p.f)) continue;
    usedE.add(p.e);
    usedF.add(p.f);
    total += p.s;
    if (p.s >= 0.98) exact += 1;
  }
  const longest = Math.max(expected.length, found.length);
  return {
    score: longest === 0 ? 1 : total / longest,
    counts: {
      expected: expected.length,
      found: found.length,
      exact,
      missing: expected.length - usedE.size,
      extra: found.length - usedF.size,
    },
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

const sameNumber = (a: number | null | undefined, b: number | null) => ((a ?? null) === b ? 1 : 0);

/** Optional text: both empty is right; one empty is wrong. */
const optionalText = (expected: string | null | undefined, found: string | null) =>
  textScore(expected ?? "", found ?? "");

function urlScore(expected: string | null, found: string | null): number {
  const clean = (u: string | null) =>
    (u ?? "")
      .trim()
      .replace(/^https?:\/\/(www\.)?/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  return clean(expected) === clean(found) ? 1 : 0;
}

/** Scores a recipe against its correct answer. */
export function scoreRecipe(expected: ExpectedRecipe, found: RecipeContent): RecipeScore {
  const fields: FieldScores = {
    title: null,
    description: null,
    ingredients: null,
    directions: null,
    times: null,
    servings: null,
    notes: null,
    source: null,
  };
  let ingredients: LineCounts | null = null;
  let directions: LineCounts | null = null;
  let servingsCount: number | null = null;

  if (expected.title !== undefined) fields.title = textScore(expected.title, found.title);
  if (expected.description !== undefined) {
    fields.description = textScore(expected.description, found.description);
  }
  if (expected.notes !== undefined) fields.notes = textScore(expected.notes, found.notes);
  if (expected.ingredients) {
    const r = linesScore(expected.ingredients.map(expectedLine), found.ingredients);
    fields.ingredients = r.score;
    ingredients = r.counts;
  }
  if (expected.directions) {
    const r = linesScore(expected.directions.map(expectedLine), found.directions);
    fields.directions = r.score;
    directions = r.counts;
  }
  if (expected.times) {
    const t = expected.times;
    const parts = (["prep", "cook", "total"] as const)
      .filter((k) => t[k] !== undefined)
      .map((k) => sameNumber(t[k], found.times[k].minutes));
    fields.times = mean(parts);
  }
  if (expected.servings) {
    const s = expected.servings;
    const parts: number[] = [];
    if (s.count !== undefined) {
      servingsCount = sameNumber(s.count, found.servings.count);
      parts.push(servingsCount);
    }
    if (s.yield !== undefined) parts.push(optionalText(s.yield, found.servings.yield));
    fields.servings = mean(parts);
  }
  if (expected.source) {
    const s = expected.source;
    const parts: number[] = [];
    if (s.name !== undefined) parts.push(optionalText(s.name, found.source.name));
    if (s.author !== undefined) parts.push(optionalText(s.author, found.source.author));
    if (s.page !== undefined) parts.push(optionalText(s.page, found.source.page));
    if (s.url !== undefined) parts.push(urlScore(s.url ?? null, found.source.url));
    fields.source = mean(parts);
  }

  const scored = SCORED_FIELDS.map((f) => fields[f]).filter((v): v is number => v !== null);
  return { fields, overall: mean(scored) ?? 0, ingredients, directions, servingsCount };
}

/** A recipe's ingredient lines as one text, headings left out, for pairing by content. */
const ingredientText = (lines: readonly string[]) =>
  lines.filter((l) => !l.startsWith("## ")).join("\n");

/**
 * Pairs the recipes found in a file of several (a PDF, a Paprika library) with the expected
 * ones, by title. One left over on both sides is then paired by its ingredients, so a recipe read
 * right under another name ("Cookies" for "Powdered Sugar Cookies") scores its title low rather
 * than counting as not found (E14, 2026-10-22). Expected recipes nothing was found for score 0;
 * extra recipes are counted.
 */
export function matchRecipes(
  expected: readonly ExpectedRecipe[],
  found: readonly RecipeContent[],
): { pairs: { expected: number; found: number | null }[]; extra: number } {
  const used = new Set<number>();
  const pairs = expected.map((e, i) => {
    let best: number | null = null;
    let bestScore = 0.5;
    found.forEach((f, j) => {
      if (used.has(j)) return;
      const s = textScore(e.title ?? "", f.title);
      if (s > bestScore) {
        best = j;
        bestScore = s;
      }
    });
    if (best !== null) used.add(best);
    return { expected: i, found: best };
  });
  for (const pair of pairs) {
    if (pair.found !== null) continue;
    const theirs = ingredientText(expected[pair.expected]?.ingredients ?? []);
    if (!theirs) continue;
    let best: number | null = null;
    let bestScore = 0.5;
    found.forEach((f, j) => {
      if (used.has(j)) return;
      const s = textScore(theirs, ingredientText(f.ingredients.map((l) => l.text)));
      if (s > bestScore) {
        best = j;
        bestScore = s;
      }
    });
    if (best !== null) {
      used.add(best);
      pair.found = best;
    }
  }
  return { pairs, extra: found.length - used.size };
}
