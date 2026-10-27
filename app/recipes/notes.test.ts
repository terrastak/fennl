import { describe, expect, it } from "vitest";
import { emptyRecipeContent, type RecipeSource } from "../../shared/recipe";
import { noteChanged, noteDate, noteDay, noteFrom } from "./notes";

const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`);

describe("dating a note", () => {
  it("shows the day it was written", () => {
    const writtenAt = at("2026-10-26").toISOString();
    expect(noteDate({ writtenAt, editedAt: null })).toBe(noteDay(at("2026-10-26")));
  });

  it("says when it was edited, only on a later day", () => {
    const writtenAt = at("2026-10-26", 9).toISOString();
    expect(noteDate({ writtenAt, editedAt: at("2026-10-26", 18).toISOString() })).toBe(
      noteDay(at("2026-10-26")),
    );
    const later = noteDate({ writtenAt, editedAt: at("2026-10-28").toISOString() });
    expect(later.startsWith(`${noteDay(at("2026-10-26"))} · edited `)).toBe(true);
    expect(later).not.toContain("2026 · edited Oct 28, 2026");
    const nextYear = noteDate({ writtenAt, editedAt: at("2027-01-03").toISOString() });
    expect(nextYear.endsWith(noteDay(at("2027-01-03")))).toBe(true);
  });
});

describe("where the recipe's own note came from", () => {
  const source = (over: Partial<RecipeSource>): RecipeSource => ({
    ...emptyRecipeContent().source,
    ...over,
  });

  it("names the recipe's source", () => {
    expect(noteFrom(source({ kind: "person", name: "Grandma Barbara" }))).toBe(
      "From Grandma Barbara",
    );
    expect(
      noteFrom(source({ kind: "cookbook", name: "Modern Classics", author: "Donna Hay" })),
    ).toBe("From Donna Hay, Modern Classics");
    expect(noteFrom(source({ kind: "person", name: "" }))).toBe("From the recipe");
  });
});

describe("a note being written", () => {
  it("has changed only when its words have", () => {
    expect(noteChanged("Less sugar. ", "Less sugar.")).toBe(false);
    expect(noteChanged("", "")).toBe(false);
    expect(noteChanged("Less salt.", "Less sugar.")).toBe(true);
  });
});
