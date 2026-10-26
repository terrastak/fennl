import { describe, expect, it } from "vitest";
import { RECIPE_RULES } from "../../shared/recipe";
import { addToNote, noteDay, roomInNote } from "./notes";

const day = new Date(2026, 9, 26, 12);

describe("a note that grows a part at a time", () => {
  it("dates the first part", () => {
    expect(addToNote("", "  Used less sugar. ", day)).toBe(`${noteDay(day)}: Used less sugar.`);
  });

  it("adds each later part as a new dated paragraph", () => {
    const first = addToNote("", "Used less sugar.", day);
    expect(addToNote(first, "Even better with walnuts.", day)).toBe(
      `${first}\n\n${noteDay(day)}: Even better with walnuts.`,
    );
    // A note written before parts were dated keeps its words.
    expect(addToNote("Mom's, with extra raisins.\n", "Halved it.", day)).toBe(
      `Mom's, with extra raisins.\n\n${noteDay(day)}: Halved it.`,
    );
  });

  it("knows how much room is left", () => {
    const prefix = `${noteDay(day)}: `.length;
    expect(roomInNote("", day)).toBe(RECIPE_RULES.notesLength - prefix);
    expect(roomInNote("abc", day)).toBe(RECIPE_RULES.notesLength - 3 - 2 - prefix);
    expect(roomInNote("x".repeat(RECIPE_RULES.notesLength), day)).toBe(0);
  });
});
