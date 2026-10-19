import { describe, expect, it } from "vitest";
import {
  outcomeOf,
  periodKey,
  periodLabel,
  periodRange,
  periodsBetween,
  summarize,
  type OutcomeLists,
  type ReadAnswer,
} from "./aiOutcome";

// Real-use AI outcomes (decided 2026-10-19): each answer measured against what was saved.

const lists = (ingredients: string[], directions: string[]): OutcomeLists => ({
  ingredients: ingredients.map((text) => ({ text, heading: false })),
  directions: directions.map((text) => ({ text, heading: false })),
});

const saved = lists(
  ["1 cup butter", "2 cups flour", "1/2 cup sugar"],
  ["Mix.", "Bake 15 minutes."],
);
const meta = { source: "photo", setup: "abc123", createdAt: 1, decidedAt: 2 };

const answer = (
  purpose: ReadAnswer["purpose"],
  model: string,
  shown: boolean,
  l: OutcomeLists,
): ReadAnswer => ({ purpose, model, shown, lists: l });

describe("an outcome", () => {
  it("scores each answer against what was saved, and counts what the person fixed", () => {
    const haiku = answer(
      "read",
      "haiku",
      false,
      lists(["1 cup butter", "2 cups flowr"], ["Mix.", "Bake 15 minutes."]),
    );
    const sonnet = answer(
      "second_look",
      "sonnet",
      true,
      lists(["1 cup butter", "2 cups flour"], ["Mix.", "Bake 15 minutes."]),
    );
    const o = outcomeOf([haiku, sonnet], { outcome: "saved", saved }, meta);
    expect(o.path).toBe("read+second_look");
    expect(o.reads[0]).toMatchObject({ model: "haiku", ingredients: { exact: 1, saved: 3 } });
    expect(o.reads[1]).toMatchObject({ model: "sonnet", ingredients: { exact: 2, saved: 3 } });
    expect(o.reads[1]!.closeness).toBeGreaterThan(o.reads[0]!.closeness!);
    // The person added the sugar to Sonnet's answer.
    expect(o.linesFixed).toBe(1);
  });

  it("keeps no scores for a draft discarded or never reviewed", () => {
    const o = outcomeOf(
      [answer("read", "haiku", true, saved)],
      { outcome: "discarded", saved: null },
      meta,
    );
    expect(o.reads).toEqual([{ purpose: "read", model: "haiku", shown: true }]);
    expect(o.linesFixed).toBeNull();
  });
});

describe("periods", () => {
  const t = Date.UTC(2026, 9, 19, 12);
  it("are months, quarters and years in UTC", () => {
    expect(periodKey("month", t)).toBe("2026-10");
    expect(periodKey("quarter", t)).toBe("2026-Q4");
    expect(periodKey("year", t)).toBe("2026");
    expect(periodRange("2026-Q4")).toEqual({
      kind: "quarter",
      from: Date.UTC(2026, 9, 1),
      to: Date.UTC(2027, 0, 1),
    });
    expect(periodRange("2026-13")).toBeNull();
    expect(periodLabel("2026-10")).toBe("October 2026");
    expect(periodLabel("2026-Q4")).toBe("Q4 2026 (Oct–Dec)");
  });

  it("are listed back to the first record, newest first", () => {
    expect(periodsBetween("month", Date.UTC(2026, 7, 20), t)).toEqual([
      "2026-10",
      "2026-09",
      "2026-08",
    ]);
    expect(periodsBetween("quarter", Date.UTC(2025, 11, 1), t)).toEqual([
      "2026-Q4",
      "2026-Q3",
      "2026-Q2",
      "2026-Q1",
      "2025-Q4",
    ]);
  });
});

describe("a period's summary", () => {
  it("says whether the stronger model did better, by model and by source", () => {
    const weak = lists(["1 cup butter"], ["Mix."]);
    const better = outcomeOf(
      [answer("read", "haiku", false, weak), answer("second_look", "sonnet", true, saved)],
      { outcome: "saved", saved },
      meta,
    );
    const same = outcomeOf(
      [answer("read", "haiku", false, saved), answer("second_look", "sonnet", true, saved)],
      { outcome: "saved", saved },
      { ...meta, source: "website" },
    );
    const reread = outcomeOf(
      [answer("read", "haiku", false, saved), answer("reread", "sonnet", true, weak)],
      { outcome: "saved", saved },
      meta,
    );
    const firstOnly = outcomeOf(
      [answer("read", "haiku", true, saved)],
      { outcome: "saved", saved },
      meta,
    );
    const gone = outcomeOf(
      [answer("read", "haiku", true, weak)],
      { outcome: "expired", saved: null },
      meta,
    );
    const s = summarize([better, same, reread, firstOnly, gone]);
    expect(s).toMatchObject({ drafts: 5, saved: 4, discarded: 0, expired: 1 });
    expect(s.secondLook).toEqual({ count: 2, better: 1, same: 1, worse: 0 });
    expect(s.readAgain).toEqual({ count: 1, better: 0, same: 0, worse: 1 });
    const sonnet = s.byModel.find((m) => m.model === "sonnet")!;
    expect(sonnet).toMatchObject({ shown: 3, saved: 3, untouched: 2 });
    const haiku = s.byModel.find((m) => m.model === "haiku")!;
    expect(haiku).toMatchObject({ shown: 2, saved: 1, untouched: 1, linesFixed: 0 });
    expect(s.bySource.find((x) => x.source === "website")?.secondLook.same).toBe(1);
    expect(s.setups).toEqual([{ setup: "abc123", drafts: 5 }]);
  });
});
