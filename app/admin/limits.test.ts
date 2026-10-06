import { describe, expect, it } from "vitest";
import { inputValue, parseInput, showLimit } from "./limits";

describe("limits in the admin console", () => {
  it("shows byte limits in MB and counts as they are", () => {
    expect(showLimit("max_text_bytes", 3 * 1024 * 1024)).toBe("3 MB");
    expect(showLimit("max_recipe_bytes", 262144)).toBe("0.25 MB");
    expect(showLimit("max_recipes", 100)).toBe("100");
    expect(showLimit("max_recipes", null)).toBe("No limit");
  });

  it("reads what's typed, with blank meaning no limit", () => {
    expect(parseInput("max_recipes", "150")).toBe(150);
    expect(parseInput("max_recipes", "")).toBeNull();
    expect(parseInput("max_recipes", "1.5")).toBeUndefined();
    expect(parseInput("max_recipes", "-1")).toBeUndefined();
    expect(parseInput("max_text_bytes", "3")).toBe(3 * 1024 * 1024);
    expect(inputValue("max_text_bytes", 3 * 1024 * 1024)).toBe("3");
    expect(inputValue("max_recipes", null)).toBe("");
  });
});
