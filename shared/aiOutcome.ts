import { linesScore } from "./importScore";

// How AI reads turn out in real use (decided by the owner 2026-10-19): for every recipe the AI
// read, each model's answer is compared with what the person finally saved, the closest thing
// to a right answer real imports have. Only scores are kept (table ai_outcome, two years), never
// the recipe itself, so the admin console can show over months, quarters and years whether the
// stronger model's second look and "Read again" are worth what they cost, model by model.

export type AiReadPurpose = "read" | "second_look" | "reread";

/** A line as both drafts and recipes have it. */
export interface OutcomeLine {
  text: string;
  heading: boolean;
}

export interface OutcomeLists {
  ingredients: OutcomeLine[];
  directions: OutcomeLine[];
}

/** One model's answer, as kept with the draft until it's saved, discarded or removed. */
export interface ReadAnswer {
  purpose: AiReadPurpose;
  model: string;
  /** Whether this is the answer the person was shown (the last one shown, after Read again). */
  shown: boolean;
  lists: OutcomeLists;
}

/** One answer measured against the saved recipe. */
export interface ReadScore {
  purpose: AiReadPurpose;
  model: string;
  shown: boolean;
  /** Lines exactly as saved, and how many the saved recipe has. */
  ingredients: { exact: number; saved: number };
  directions: { exact: number; saved: number };
  /** How close the whole answer was to what was saved, 0 to 1 (missing and extra lines count). */
  closeness: number;
}

export type OutcomeKind = "saved" | "discarded" | "expired";

/** What's kept for one AI-read draft once it's decided (a row of ai_outcome). */
export interface AiOutcome {
  /** Where the recipe came from (website, photo, screenshot, pdf). */
  source: string;
  outcome: OutcomeKind;
  /** Which reads there were, in order ("read", "read+second_look+reread"). */
  path: string;
  /** A short fingerprint of Fennl's instructions and second-look rules at the time. */
  setup: string;
  /** The answers measured against the saved recipe; without scores when not saved. */
  reads: (Omit<ReadScore, "ingredients" | "directions" | "closeness"> &
    Partial<Pick<ReadScore, "ingredients" | "directions" | "closeness">>)[];
  /** Lines the person changed, added or removed from the answer they were shown (saved only). */
  linesFixed: number | null;
  createdAt: number;
  decidedAt: number;
}

/** The answer and the saved recipe differ by at least this much closeness to count as better. */
export const MEANINGFUL = 0.02;

function score(answer: ReadAnswer, saved: OutcomeLists): ReadScore {
  const ing = linesScore(saved.ingredients, answer.lists.ingredients);
  const dir = linesScore(saved.directions, answer.lists.directions);
  return {
    purpose: answer.purpose,
    model: answer.model,
    shown: answer.shown,
    ingredients: { exact: ing.counts.exact, saved: saved.ingredients.length },
    directions: { exact: dir.counts.exact, saved: saved.directions.length },
    closeness: (ing.score + dir.score) / 2,
  };
}

/** Lines changed, added or removed between what was shown and what was saved. */
function fixed(shown: ReadAnswer, saved: OutcomeLists): number {
  let n = 0;
  for (const list of ["ingredients", "directions"] as const) {
    const { counts } = linesScore(saved[list], shown.lists[list]);
    n += Math.max(counts.expected, counts.found) - counts.exact;
  }
  return n;
}

/** The outcome kept for a draft: each answer scored against what was saved, when it was. */
export function outcomeOf(
  answers: ReadAnswer[],
  decided: { outcome: OutcomeKind; saved: OutcomeLists | null },
  meta: { source: string; setup: string; createdAt: number; decidedAt: number },
): AiOutcome {
  const saved = decided.outcome === "saved" ? decided.saved : null;
  const shown = answers.find((a) => a.shown) ?? answers[answers.length - 1];
  return {
    ...meta,
    outcome: decided.outcome,
    path: answers.map((a) => a.purpose).join("+"),
    reads: answers.map((a) =>
      saved ? score(a, saved) : { purpose: a.purpose, model: a.model, shown: a.shown },
    ),
    linesFixed: saved && shown ? fixed(shown, saved) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Periods: months, quarters and years (UTC)
// ---------------------------------------------------------------------------------------------

export type PeriodKind = "month" | "quarter" | "year";

/** "2026-10", "2026-Q4", "2026". */
export function periodKey(kind: PeriodKind, time: number): string {
  const d = new Date(time);
  const y = d.getUTCFullYear();
  if (kind === "year") return String(y);
  if (kind === "quarter") return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The start and end (exclusive) of a period, in ms; null for a key that isn't one. */
export function periodRange(key: string): { from: number; to: number; kind: PeriodKind } | null {
  let m = /^(\d{4})$/.exec(key);
  if (m) {
    const y = Number(m[1]);
    return { kind: "year", from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) };
  }
  m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (m) {
    const y = Number(m[1]);
    const q = Number(m[2]) - 1;
    return { kind: "quarter", from: Date.UTC(y, q * 3, 1), to: Date.UTC(y, q * 3 + 3, 1) };
  }
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    return { kind: "month", from: Date.UTC(y, mo, 1), to: Date.UTC(y, mo + 1, 1) };
  }
  return null;
}

/** "October 2026", "Q4 2026 (Oct–Dec)", "2026". */
export function periodLabel(key: string): string {
  const range = periodRange(key);
  if (!range) return key;
  const month = (t: number) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const year = new Date(range.from).getUTCFullYear();
  if (range.kind === "year") return String(year);
  if (range.kind === "quarter") {
    return `${key.slice(5)} ${year} (${month(range.from)}–${month(range.to - 1)})`;
  }
  return new Date(range.from).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The periods of a kind from `first` to `now`, newest first. */
export function periodsBetween(kind: PeriodKind, first: number, now: number): string[] {
  const keys: string[] = [];
  let t = now;
  for (let i = 0; i < 100; i++) {
    const key = periodKey(kind, t);
    keys.push(key);
    const range = periodRange(key);
    if (!range || range.from <= first) break;
    t = range.from - 1;
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------
// Summing up a period, for the admin console
// ---------------------------------------------------------------------------------------------

export interface Comparison {
  /** How many times there was one. */
  count: number;
  /** Of those saved: the stronger model's answer closer to what was saved, the same, or not. */
  better: number;
  same: number;
  worse: number;
}

export interface ModelRecord {
  model: string;
  /** Answers by this model the person was shown. */
  shown: number;
  /** Of those saved: lines exactly as the person saved them, over all saved lines. */
  exactLines: number;
  savedLines: number;
  /** Saved with no line changed. */
  untouched: number;
  saved: number;
  /** Lines changed, added or removed on average, when saved. */
  linesFixed: number | null;
}

export interface OutcomeSummary {
  drafts: number;
  saved: number;
  discarded: number;
  expired: number;
  secondLook: Comparison;
  readAgain: Comparison;
  byModel: ModelRecord[];
  /** The same, by where recipes came from (website, photo...). */
  bySource: { source: string; drafts: number; secondLook: Comparison; readAgain: Comparison }[];
  /** Instruction versions in use in the period, with how many drafts each. */
  setups: { setup: string; drafts: number }[];
}

const emptyComparison = (): Comparison => ({ count: 0, better: 0, same: 0, worse: 0 });

/** Whether the later of two reads did better, the same or worse against what was saved. */
function compare(into: Comparison, earlier: ReadScoreish | undefined, later: ReadScoreish) {
  into.count += 1;
  if (!earlier || earlier.closeness === undefined || later.closeness === undefined) return;
  const diff = later.closeness - earlier.closeness;
  if (diff >= MEANINGFUL) into.better += 1;
  else if (diff <= -MEANINGFUL) into.worse += 1;
  else into.same += 1;
}

type ReadScoreish = AiOutcome["reads"][number];

function comparisons(o: AiOutcome, second: Comparison, again: Comparison) {
  o.reads.forEach((r, i) => {
    if (r.purpose === "second_look") compare(second, o.reads[i - 1], r);
    // "Read again" against what the person was shown before it.
    if (r.purpose === "reread") compare(again, o.reads[i - 1], r);
  });
}

export function summarize(outcomes: AiOutcome[]): OutcomeSummary {
  const secondLook = emptyComparison();
  const readAgain = emptyComparison();
  const models = new Map<string, ModelRecord & { fixedSum: number; fixedN: number }>();
  const sources = new Map<string, OutcomeSummary["bySource"][number]>();
  const setups = new Map<string, number>();
  for (const o of outcomes) {
    comparisons(o, secondLook, readAgain);
    const source = sources.get(o.source) ?? {
      source: o.source,
      drafts: 0,
      secondLook: emptyComparison(),
      readAgain: emptyComparison(),
    };
    source.drafts += 1;
    comparisons(o, source.secondLook, source.readAgain);
    sources.set(o.source, source);
    setups.set(o.setup, (setups.get(o.setup) ?? 0) + 1);

    const shown = o.reads.find((r) => r.shown) ?? o.reads[o.reads.length - 1];
    if (!shown) continue;
    const m = models.get(shown.model) ?? {
      model: shown.model,
      shown: 0,
      exactLines: 0,
      savedLines: 0,
      untouched: 0,
      saved: 0,
      linesFixed: null,
      fixedSum: 0,
      fixedN: 0,
    };
    m.shown += 1;
    if (o.outcome === "saved" && shown.ingredients && shown.directions) {
      m.saved += 1;
      m.exactLines += shown.ingredients.exact + shown.directions.exact;
      m.savedLines += shown.ingredients.saved + shown.directions.saved;
      if (o.linesFixed === 0) m.untouched += 1;
      if (o.linesFixed !== null) {
        m.fixedSum += o.linesFixed;
        m.fixedN += 1;
      }
    }
    models.set(shown.model, m);
  }
  return {
    drafts: outcomes.length,
    saved: outcomes.filter((o) => o.outcome === "saved").length,
    discarded: outcomes.filter((o) => o.outcome === "discarded").length,
    expired: outcomes.filter((o) => o.outcome === "expired").length,
    secondLook,
    readAgain,
    byModel: [...models.values()]
      .map(({ fixedSum, fixedN, ...m }) => ({
        ...m,
        linesFixed: fixedN ? fixedSum / fixedN : null,
      }))
      .sort((a, b) => b.shown - a.shown),
    bySource: [...sources.values()].sort((a, b) => b.drafts - a.drafts),
    setups: [...setups.entries()]
      .map(([setup, drafts]) => ({ setup, drafts }))
      .sort((a, b) => b.drafts - a.drafts),
  };
}
