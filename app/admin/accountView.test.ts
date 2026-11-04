import { describe, expect, it } from "vitest";
import type { Finding, HistoryEntry } from "../../shared/accountFindings";
import {
  entryTime,
  firstName,
  historyShown,
  householdWords,
  inOrder,
  periodNote,
  sinceWords,
  summaryLine,
} from "./accountView";

const NOW = new Date(2026, 10, 4, 12, 0);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function entry(days: number, category: HistoryEntry["category"]): HistoryEntry {
  return { at: daysAgo(days), category, text: "Something", problem: false, keptForGood: false };
}

function finding(level: Finding["level"], key: Finding["key"]): Finding {
  return {
    key,
    level,
    title: key,
    body: "",
    since: null,
    sinceText: "",
    fingerprint: key,
    actions: [],
    handled: null,
  };
}

describe("What happened", () => {
  const history = [entry(1, "email"), entry(4, "plan"), entry(34, "plan"), entry(100, "support")];

  it("shows the period and filter, and counts what the period hides", () => {
    expect(historyShown(history, "all", 30, NOW.getTime())).toMatchObject({ hidden: 2 });
    expect(historyShown(history, "all", 30, NOW.getTime()).shown).toHaveLength(2);
    expect(historyShown(history, "plan", 60, NOW.getTime()).shown).toHaveLength(2);
    expect(historyShown(history, "support", 90, NOW.getTime())).toMatchObject({ hidden: 1 });
    expect(historyShown(history, "all", null, NOW.getTime())).toMatchObject({ hidden: 0 });
    expect(historyShown(history, "all", null, NOW.getTime()).shown).toHaveLength(4);
  });

  it("says what the period leaves out", () => {
    expect(periodNote(30, 2, 2)).toBe(
      "2 older entries before 30 days ago. Choose a longer period to see them.",
    );
    expect(periodNote(30, 2, 1)).toBe(
      "1 older entry before 30 days ago. Choose a longer period to see it.",
    );
    // Nothing older: no pointing at a longer period that would show nothing more.
    expect(periodNote(30, 0, 0)).toMatch(/^Nothing here yet, and nothing older\. Emails/);
    expect(periodNote(90, 3, 0)).toMatch(/^Nothing older is hidden: this is everything kept\. /);
    expect(periodNote(90, 3, 0)).not.toContain("Choose");
    expect(periodNote(null, 3, 0)).toMatch(/^Emails, sign-ins and devices are kept for 90 days/);
  });
});

describe("What's going on", () => {
  it("counts what needs the admin, what's worth knowing and the checks that are fine", () => {
    const findings = [
      finding("worth_knowing", "premium_ending"),
      finding("needs_you", "cant_add"),
      finding("needs_you", "email_not_arriving"),
    ];
    expect(summaryLine(findings, 6)).toBe("2 things need you · 1 worth knowing · 6 checks fine");
    expect(summaryLine([finding("needs_you", "cant_add")], 1)).toBe(
      "1 thing needs you · 1 check fine",
    );
    expect(summaryLine([], 7)).toBe("Nothing needs you · 7 checks fine");
    expect(inOrder(findings).map((f) => f.key)).toEqual([
      "cant_add",
      "email_not_arriving",
      "premium_ending",
    ]);
  });
});

describe("words", () => {
  it("puts times and people plainly", () => {
    expect(entryTime(new Date(2026, 10, 4, 8, 41).toISOString(), NOW)).toMatch(/^Today /);
    expect(entryTime(new Date(2026, 10, 3, 21, 5).toISOString(), NOW)).toMatch(/^Yesterday /);
    expect(sinceWords(new Date(2026, 10, 4, 10, 0).toISOString(), NOW)).toBe("2 hours ago");
    expect(sinceWords(new Date(2026, 10, 3, 10, 0).toISOString(), NOW)).toBe("yesterday");
    expect(sinceWords(null, NOW)).toBe("");
    expect(firstName("Dana Ortiz")).toBe("Dana");
    expect(householdWords([{ name: "Dana Ortiz", email: "d@example.com" }])).toBe("Just Dana");
    expect(
      householdWords([
        { name: "Dana Ortiz", email: "d@example.com" },
        { name: "Sam Ortiz", email: "s@example.com" },
      ]),
    ).toBe("Dana Ortiz and Sam Ortiz");
  });
});
