import { describe, expect, it } from "vitest";
import { changedText, draftName, draftsText, startedText, untitledLabel } from "./draftText";

// A draft card's words (U27 part 3), against a fixed "now" in the device's own time zone.
const now = new Date(2026, 10, 22, 16, 0);
const at = (month: number, day: number, hour: number, minute: number) =>
  new Date(2026, month, day, hour, minute).getTime();

describe("a draft card's words", () => {
  it("counts drafts", () => {
    expect(draftsText(1)).toBe("1 draft");
    expect(draftsText(3)).toBe("3 drafts");
  });

  it("says when a new recipe's draft was last changed", () => {
    expect(changedText(at(10, 22, 9, 5), null, now)).toBe("Changed today");
    expect(changedText(at(10, 18, 9, 5), [], now)).toMatch(/^Changed Nov 18$/);
  });

  it("names what changed in a saved recipe's draft, in the editor's order", () => {
    expect(changedText(at(10, 22, 9, 5), ["Photos", "Ingredients"], now)).toBe(
      "Changed today: Ingredients, Photos",
    );
    expect(changedText(at(10, 18, 9, 5), ["Notes"], now)).toBe("Changed Nov 18: Notes");
  });

  it("gives the year for a day in another year", () => {
    expect(changedText(new Date(2025, 11, 30).getTime(), null, now)).toBe("Changed Dec 30, 2025");
  });

  it("says when an untitled draft was started, to the minute", () => {
    expect(startedText(at(10, 22, 15, 42), now, "en-US")).toBe("Started today, 3:42 PM");
    expect(startedText(at(10, 18, 9, 5), now, "en-US")).toBe("Started Nov 18, 9:05 AM");
  });

  it("names a draft for its buttons: untitled ones by what's typed and when they were started", () => {
    const untitled = { title: "", untitledHint: "2 cups flour…", startedAt: at(10, 22, 15, 42) };
    expect(draftName({ ...untitled, title: "Stew" }, now, "en-US")).toBe("Stew");
    expect(draftName(untitled, now, "en-US")).toBe(
      "Untitled · 2 cups flour…, started today, 3:42 PM",
    );
    expect(draftName({ ...untitled, untitledHint: null }, now, "en-US")).toBe(
      "Untitled, started today, 3:42 PM",
    );
    expect(untitledLabel(null)).toBe("Untitled");
  });
});
