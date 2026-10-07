import type { DirectionStep, IngredientLine } from "./recipe";

/**
 * People type or paste ingredients and directions into one text box each; the recipe keeps them
 * as lines with IDs (shared/recipe.ts). This file goes between the two:
 *
 * - textFromLines: the text box, exactly as the lines read.
 * - linesFromText: lines from the text box. Pasted bullets (and, for directions, step numbers)
 *   are cleaned off and blank lines dropped. Headings are recognised ("For the crust:", or an
 *   ALL-CAPS line with no amount), unless the heading button decided.
 *
 * Every line that's recognisably the same as before keeps its ID, its heading choice and (for
 * ingredients) its linked recipe: unchanged lines wherever they moved, and lightly edited lines
 * ("1 cup BBQ sauce" → "1½ cups BBQ sauce") in the same place. A changed line loses how the
 * ingredient reader understood it, so it's read again.
 */

export type ListKind = "ingredients" | "directions";

type Line = IngredientLine | DirectionStep;

/** Bullets and checkboxes pasted from websites and documents, followed by a space. */
const BULLET = /^[\s]*(?:[•◦▪▫●○■□▢☐✓✔✗➤►▸‣⁃∙·*]|[-–—](?=\s))\s*/u;

/** "1.", "1)", "Step 1:", "Step 1." at the start of a direction. */
const STEP_NUMBER = /^\s*(?:step\s*\d+\s*[.:)-]?|\d+\s*[.)])\s+/i;

/** Digits and fraction characters: an ingredient amount. */
const AMOUNT = /[0-9¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/u;

/** Cleans one pasted line: surrounding spaces, bullets, and (directions) step numbers. */
export function cleanLine(raw: string, kind: ListKind): string {
  let line = raw.replace(/\s+$/u, "").replace(BULLET, "");
  if (kind === "directions") line = line.replace(STEP_NUMBER, "");
  return line.trim();
}

/**
 * Whether a line reads as a section heading: it ends with a colon and has no amount
 * ("For the crust:", "TO MAKE AVOCADO CREMA:"), or it's short, ALL CAPS, with no amount
 * ("CHICKEN"). A step that starts with a label ("FOR THE GRAVY: Toast the chiles…") isn't one.
 */
export function looksLikeHeading(text: string): boolean {
  if (AMOUNT.test(text)) return false;
  if (text.endsWith(":") && text.length <= 80) return true;
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && text.length <= 60 && letters === letters.toUpperCase();
}

/** The text box: one line per line, as written. */
export function textFromLines(lines: readonly Line[]): string {
  return lines.map((line) => line.text).join("\n");
}

/** How alike two lines are, 0 to 1 (letter pairs in common: the Dice coefficient). */
function similarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const t = s.toLowerCase().replace(/\s+/g, " ");
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const pair = t.slice(i, i + 2);
      out.set(pair, (out.get(pair) ?? 0) + 1);
    }
    return out;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  let total = 0;
  for (const n of pa.values()) total += n;
  for (const n of pb.values()) total += n;
  if (total === 0) return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
  let shared = 0;
  for (const [pair, n] of pa) shared += Math.min(n, pb.get(pair) ?? 0);
  return (2 * shared) / total;
}

/** How alike an edited line must be to count as the same line, in its place… */
const SAME_LINE = 0.6;
/** …or anywhere in the list (edited and moved at once). */
const SAME_LINE_MOVED = 0.75;

/**
 * Pairs new texts with previous lines: index in `previous` for each new text, or -1. Unchanged
 * texts pair first, in order (longest common sequence), then unchanged texts that moved, then
 * edited lines between the same unchanged neighbours, then closely alike lines anywhere.
 */
function pairUp(previous: readonly string[], next: readonly string[]): number[] {
  const n = previous.length;
  const m = next.length;
  const pairs = new Array<number>(m).fill(-1);
  const used = new Array<boolean>(n).fill(false);

  // Longest common sequence of identical texts (a table of lengths from each position on).
  const table = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => table[i * (m + 1) + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] =
        previous[i] === next[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  for (let i = 0, j = 0; i < n && j < m;) {
    if (previous[i] === next[j]) {
      pairs[j] = i;
      used[i] = true;
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) i++;
    else j++;
  }

  const anchors = pairs.slice();

  // Lines moved elsewhere, unchanged.
  for (let j = 0; j < m; j++) {
    if (pairs[j] !== -1) continue;
    const i = previous.findIndex((text, k) => !used[k] && text === next[j]);
    if (i !== -1) {
      pairs[j] = i;
      used[i] = true;
    }
  }

  const closest = (j: number, from: number, to: number, threshold: number) => {
    let best = -1;
    let bestScore = threshold;
    for (let i = from; i < to; i++) {
      if (used[i]) continue;
      const score = similarity(previous[i] ?? "", next[j] ?? "");
      if (score >= bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best !== -1) {
      pairs[j] = best;
      used[best] = true;
    }
  };

  // Edited lines: between the same unchanged neighbours, alike enough.
  for (let j = 0; j < m; j++) {
    if (pairs[j] !== -1) continue;
    let before = -1;
    for (let k = j - 1; k >= 0; k--) {
      const anchor = anchors[k] ?? -1;
      if (anchor !== -1) {
        before = anchor;
        break;
      }
    }
    let after = n;
    for (let k = j + 1; k < m; k++) {
      const anchor = anchors[k] ?? -1;
      if (anchor !== -1) {
        after = anchor;
        break;
      }
    }
    closest(j, before + 1, after, SAME_LINE);
  }

  // Edited and moved: anywhere, but only when very alike.
  for (let j = 0; j < m; j++) {
    if (pairs[j] === -1) closest(j, 0, n, SAME_LINE_MOVED);
  }
  return pairs;
}

function makeId(): string {
  return crypto.randomUUID();
}

function rebuild<T extends Line>(
  text: string,
  previous: readonly T[],
  kind: ListKind,
  newId: () => string,
  carry: (old: T | undefined, line: { id: string; text: string; heading: boolean }) => T,
): T[] {
  const texts = text
    .split(/\r?\n/)
    .map((raw) => cleanLine(raw, kind))
    .filter(Boolean);
  const pairs = pairUp(
    previous.map((line) => line.text),
    texts,
  );
  return texts.map((lineText, j) => {
    const paired = pairs[j] ?? -1;
    const old = paired === -1 ? undefined : previous[paired];
    const heading =
      old && (old.headingByHand || old.text === lineText)
        ? old.heading
        : looksLikeHeading(lineText);
    return carry(old, { id: old?.id ?? newId(), text: lineText, heading });
  });
}

/** Ingredient lines from the text box, keeping what belongs to lines that are still there. */
export function ingredientsFromText(
  text: string,
  previous: readonly IngredientLine[] = [],
  newId: () => string = makeId,
): IngredientLine[] {
  return rebuild(text, previous, "ingredients", newId, (old, line) => {
    const result: IngredientLine = { ...line };
    if (old?.headingByHand) result.headingByHand = true;
    if (old?.linkedRecipeId && !line.heading) result.linkedRecipeId = old.linkedRecipeId;
    if (old?.parsed && old.text === line.text) result.parsed = old.parsed;
    return result;
  });
}

/** Direction steps from the text box, keeping IDs and heading choices. */
export function directionsFromText(
  text: string,
  previous: readonly DirectionStep[] = [],
  newId: () => string = makeId,
): DirectionStep[] {
  return rebuild(text, previous, "directions", newId, (old, line) => {
    const result: DirectionStep = { ...line };
    if (old?.headingByHand) result.headingByHand = true;
    return result;
  });
}

/** The heading button: makes a line a heading (or not), regardless of how it reads. */
export function setHeading<T extends Line>(lines: readonly T[], id: string, heading: boolean): T[] {
  return lines.map((line) => (line.id === id ? { ...line, heading, headingByHand: true } : line));
}
