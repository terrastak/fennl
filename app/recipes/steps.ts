import { cleanLine } from "../../shared/recipeLines";

// Directions as separate step boxes in the editor on a laptop (U27, owner's choices 2026-11-21):
// each step is its own box, but typing feels like one box. The steps are the lines of the
// Directions text (shared/recipeLines.ts turns them into the recipe's direction lines, each
// keeping its ID), so every change here is a change to that text and nothing in the data changes.
// These are the pure pieces: splitting, joining, moving, pasting and replacing a selection that
// runs across steps.

/** A place in the steps: which step, and where in its words. */
export interface StepPoint {
  step: number;
  offset: number;
}

/** A stretch of the steps' words, start first. */
export interface StepRange {
  start: StepPoint;
  end: StepPoint;
}

/** The steps after a change, and where the cursor goes. */
export interface StepEdit {
  texts: string[];
  cursor: StepPoint;
}

/** The steps a Directions text makes, one per line as typed (a blank one too). */
export function stepsFromText(text: string): string[] {
  return text.split("\n");
}

/** The Directions text the steps make. */
export function textFromSteps(texts: readonly string[]): string {
  return texts.join("\n");
}

/** Whether a step has no words that would make a direction line (blank, or only a bullet). */
export function isBlankStep(text: string): boolean {
  return cleanLine(text, "directions") === "";
}

/** Two places in order, start first. */
export function ordered(a: StepPoint, b: StepPoint): StepRange {
  const aFirst = a.step < b.step || (a.step === b.step && a.offset <= b.offset);
  return aFirst ? { start: a, end: b } : { start: b, end: a };
}

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/**
 * Replaces a stretch of the steps with words, as one box would: what's left of the first and
 * last steps joins into one step around the words, and each line of the words after the first
 * starts a step of its own ("\n" alone splits the step there).
 */
export function replaceRange(texts: readonly string[], range: StepRange, insert: string): StepEdit {
  const last = Math.max(0, texts.length - 1);
  const startStep = clamp(range.start.step, 0, last);
  const endStep = clamp(range.end.step, startStep, last);
  const startText = texts[startStep] ?? "";
  const endText = texts[endStep] ?? "";
  const before = startText.slice(0, clamp(range.start.offset, 0, startText.length));
  const endOffset = clamp(range.end.offset, 0, endText.length);
  const after =
    endStep === startStep
      ? startText.slice(Math.max(endOffset, before.length))
      : endText.slice(endOffset);
  const lines = insert.split(/\r?\n/);
  const first = lines[0] ?? "";
  const lastLine = lines.at(-1) ?? "";
  const middle =
    lines.length === 1
      ? [before + first + after]
      : [before + first, ...lines.slice(1, -1), lastLine + after];
  const cursor: StepPoint =
    lines.length === 1
      ? { step: startStep, offset: before.length + first.length }
      : { step: startStep + lines.length - 1, offset: lastLine.length };
  return {
    texts: [...texts.slice(0, startStep), ...middle, ...texts.slice(endStep + 1)],
    cursor,
  };
}

/**
 * Enter: the step splits at the cursor (at its end, a new empty step starts under it), taking
 * out what's selected within it first.
 */
export function splitStep(
  texts: readonly string[],
  at: StepPoint,
  selectionEnd?: number,
): StepEdit {
  const end = { step: at.step, offset: selectionEnd ?? at.offset };
  return replaceRange(texts, ordered(at, end), "\n");
}

/** Backspace at the start of a step: it joins the end of the step above. Null on the first. */
export function joinWithPrevious(texts: readonly string[], step: number): StepEdit | null {
  if (step <= 0 || step >= texts.length) return null;
  const above = texts[step - 1] ?? "";
  return replaceRange(
    texts,
    { start: { step: step - 1, offset: above.length }, end: { step, offset: 0 } },
    "",
  );
}

/** Delete at the end of a step: the next step joins it. Null on the last. */
export function joinWithNext(texts: readonly string[], step: number): StepEdit | null {
  if (step < 0 || step >= texts.length - 1) return null;
  const here = texts[step] ?? "";
  return replaceRange(
    texts,
    { start: { step, offset: here.length }, end: { step: step + 1, offset: 0 } },
    "",
  );
}

/** Alt+↑ / Alt+↓: the step moves up or down one place. Null at the top or bottom. */
export function moveStep(
  texts: readonly string[],
  step: number,
  direction: -1 | 1,
): { texts: string[]; step: number } | null {
  const target = step + direction;
  if (step < 0 || step >= texts.length || target < 0 || target >= texts.length) return null;
  const moved = [...texts];
  [moved[step], moved[target]] = [moved[target] ?? "", moved[step] ?? ""];
  return { texts: moved, step: target };
}

/** Pasted words, one step per line: blank lines dropped, pasted bullets and numbers cleaned off. */
export function pastedLines(clip: string): string[] {
  return clip
    .split(/\r?\n/)
    .map((line) => cleanLine(line, "directions"))
    .filter(Boolean);
}

/**
 * Pasting over a stretch of the steps (or at the cursor): several lines make one step per line;
 * one line goes into the step. Null when the browser's own paste does the same (one line, or
 * nothing, within one step).
 */
export function pasteInto(
  texts: readonly string[],
  range: StepRange,
  clip: string,
): StepEdit | null {
  const raw = clip.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (raw.length < 2) {
    // One line with nothing around it, within one step: the browser's own paste.
    if (range.start.step === range.end.step && !/[\r\n]/.test(clip)) return null;
    // One line over a selection across steps, or with its line ending: into the step, as written.
    return replaceRange(texts, range, raw[0] ?? "");
  }
  return replaceRange(texts, range, pastedLines(clip).join("\n"));
}

/** The words of a stretch of the steps, for copying: one line per step. */
export function selectedText(texts: readonly string[], range: StepRange): string {
  const { start, end } = range;
  if (start.step === end.step) return (texts[start.step] ?? "").slice(start.offset, end.offset);
  const out = [(texts[start.step] ?? "").slice(start.offset)];
  for (let step = start.step + 1; step < end.step; step++) out.push(texts[step] ?? "");
  out.push((texts[end.step] ?? "").slice(0, end.offset));
  return out.join("\n");
}

/**
 * Words typed into one step that hold line breaks (dropped or filled in, not typed key by key):
 * one step per line, blank lines dropped. The cursor stays where the box had it (`caret`, by
 * default the end), in the step that place lands in.
 */
export function typedInto(
  texts: readonly string[],
  step: number,
  value: string,
  caret: number = value.length,
): StepEdit {
  const at = clamp(caret, 0, value.length);
  if (!value.includes("\n")) {
    const next = [...texts];
    next[step] = value;
    return { texts: next, cursor: { step, offset: at } };
  }
  const raw = value.split("\n");
  // The line the cursor is on, and where in it.
  let line = 0;
  let rest = at;
  while (line < raw.length - 1 && rest > (raw[line] ?? "").length) {
    rest -= (raw[line] ?? "").length + 1;
    line += 1;
  }
  const kept = raw.map((words) => words.trim() !== "");
  const lines = raw.filter((_, i) => kept[i]);
  const before = kept.slice(0, line).filter(Boolean).length;
  let cursor: StepPoint;
  if (lines.length === 0) cursor = { step, offset: 0 };
  else if (kept[line]) cursor = { step: step + before, offset: rest };
  else if (before > 0)
    cursor = { step: step + before - 1, offset: (lines[before - 1] ?? "").length };
  else cursor = { step, offset: 0 };
  return {
    texts: [
      ...texts.slice(0, step),
      ...(lines.length > 0 ? lines : [""]),
      ...texts.slice(step + 1),
    ],
    cursor,
  };
}

/**
 * After Undo or Redo: the first step whose words changed, and the first place in it that did
 * (where the words came back, or went).
 */
export function firstChange(before: readonly string[], after: readonly string[]): StepPoint {
  let step = 0;
  while (step < after.length - 1 && before[step] === after[step]) step++;
  const was = before[step] ?? "";
  const now = after[step] ?? "";
  let offset = 0;
  while (offset < was.length && offset < now.length && was[offset] === now[offset]) offset++;
  return { step, offset };
}

/** An empty step left behind goes (there's always one step to type in). Null to keep it. */
export function dropBlankStep(texts: readonly string[], step: number): string[] | null {
  if (texts.length < 2 || !isBlankStep(texts[step] ?? "x")) return null;
  return texts.filter((_, i) => i !== step);
}

/**
 * Keys that stay with the steps as they change, so the box being typed in stays the same box:
 * the same number of steps keeps them in place; otherwise the unchanged steps before and after
 * keep theirs, and the changed ones in between keep theirs in order, new steps getting new keys.
 */
export function followKeys(
  before: readonly string[],
  keys: readonly string[],
  after: readonly string[],
  newKey: () => string,
): string[] {
  if (before.length === after.length && keys.length === after.length) return [...keys];
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  const middleBefore = keys.slice(head, keys.length - tail);
  const middleCount = after.length - head - tail;
  const middle = Array.from({ length: middleCount }, (_, i) => middleBefore[i] ?? newKey());
  return [...keys.slice(0, head), ...middle, ...keys.slice(keys.length - tail)];
}

/**
 * What a screen reader hears for each step box: "Step 3 of 7", a heading "Heading, Cook the
 * salmon", a blank step "New step", and a box with nothing in it at all "Directions".
 */
export function stepLabels(
  texts: readonly string[],
  lines: readonly { heading: boolean }[],
): { group: string; steps: string[] } {
  let line = -1;
  const kinds = texts.map((text) => {
    if (isBlankStep(text)) return null;
    line += 1;
    return lines[line]?.heading ?? false;
  });
  const total = kinds.filter((kind) => kind === false).length;
  let number = 0;
  const steps = texts.map((text, i) => {
    const kind = kinds[i];
    if (kind === null) return line === -1 ? "Directions" : "New step";
    if (kind) return `Heading, ${cleanLine(text, "directions")}`;
    number += 1;
    return `Step ${number} of ${total}`;
  });
  return { group: `Directions, ${total} ${total === 1 ? "step" : "steps"}`, steps };
}
