import { describe, expect, it } from "vitest";
import { addBlockedBy, overallLevel, tooLarge, usageLevel, type Usage } from "./limits";

const usage = (over: Partial<Usage> = {}): Usage => ({
  recipes: 10,
  textBytes: 1000,
  maxRecipes: 100,
  maxTextBytes: 3 * 1024 * 1024,
  maxRecipeBytes: 256 * 1024,
  ...over,
});

describe("adding a recipe", () => {
  it("needs room under both limits", () => {
    expect(addBlockedBy(usage())).toBeNull();
    expect(addBlockedBy(usage({ recipes: 99 }))).toBeNull();
    expect(addBlockedBy(usage({ recipes: 100 }))).toBe("max_recipes");
    expect(addBlockedBy(usage({ recipes: 140 }))).toBe("max_recipes");
    expect(addBlockedBy(usage({ textBytes: 3 * 1024 * 1024 }))).toBe("max_text_bytes");
    expect(addBlockedBy(usage({ recipes: 5000, maxRecipes: null, maxTextBytes: null }))).toBeNull();
  });

  it("from Trash, needs room in the count only (its text counts already)", () => {
    expect(addBlockedBy(usage({ textBytes: 9e9 }), true)).toBeNull();
    expect(addBlockedBy(usage({ recipes: 100 }), true)).toBe("max_recipes");
  });
});

describe("how close to a limit", () => {
  it("is fine, near (80%), full or over", () => {
    expect(usageLevel(79, 100)).toBe("fine");
    expect(usageLevel(80, 100)).toBe("near");
    expect(usageLevel(100, 100)).toBe("full");
    expect(usageLevel(101, 100)).toBe("over");
    expect(usageLevel(10_000, null)).toBe("fine");
    expect(usageLevel(0, 0)).toBe("full");
  });

  it("takes the closer of the two", () => {
    expect(overallLevel(usage())).toBe("fine");
    expect(overallLevel(usage({ recipes: 85 }))).toBe("near");
    expect(overallLevel(usage({ recipes: 85, textBytes: 4 * 1024 * 1024 }))).toBe("over");
  });
});

describe("a recipe's own size", () => {
  it("is too large past the cap, unless it isn't growing", () => {
    expect(tooLarge(1001, 0, 1000)).toBe(true);
    expect(tooLarge(1000, 0, 1000)).toBe(false);
    expect(tooLarge(1500, 2000, 1000)).toBe(false);
    expect(tooLarge(2001, 2000, 1000)).toBe(true);
    expect(tooLarge(1e9, 0, null)).toBe(false);
  });
});
