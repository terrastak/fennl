import { describe, expect, it } from "vitest";
import type { AiImportUsage, Usage } from "../../shared/limits";
import {
  addBlockedText,
  aiImportsLine,
  aiResetText,
  devicesLine,
  recipesLine,
  restoreBlockedText,
  textLine,
} from "./limitText";

const usage = (over: Partial<Usage> = {}): Usage => ({
  recipes: 87,
  textBytes: 1.5 * 1024 * 1024,
  maxRecipes: 100,
  maxTextBytes: 3 * 1024 * 1024,
  maxRecipeBytes: 256 * 1024,
  ...over,
});

describe("usage lines", () => {
  it("say how much of each limit is used", () => {
    expect(recipesLine(usage())).toBe("87 of 100 recipes");
    expect(textLine(usage())).toBe("1.5 MB of 3 MB of recipe text");
    expect(recipesLine(usage({ recipes: 1, maxRecipes: null }))).toBe("1 recipe");
    expect(textLine(usage({ textBytes: 2048, maxTextBytes: null }))).toBe("2 KB of recipe text");
  });
});

describe("AI imports and devices", () => {
  const ai = (over: Partial<AiImportUsage> = {}): AiImportUsage => ({
    enabled: true,
    used: 58,
    max: 300,
    usedUp: false,
    paused: false,
    resetsAt: "2026-11-01T00:00:00.000Z",
    ...over,
  });

  it("say how many are used this month, and when they start again", () => {
    expect(aiImportsLine(ai())).toBe("58 of 300 AI imports this month");
    expect(aiImportsLine(ai({ used: 1, max: null }))).toBe("1 AI import this month");
    expect(aiResetText(ai())).toBe("They start again on November 1.");
    // Used up by the plan's number or the hidden cost backstop alike.
    expect(aiResetText(ai({ used: 120, usedUp: true }))).toBe(
      "This month's AI imports are used up. They start again on November 1.",
    );
  });

  it("say how many devices are signed in", () => {
    expect(devicesLine(1, 1)).toBe("1 of 1 device signed in");
    expect(devicesLine(3, null)).toBe("3 devices signed in");
  });
});

describe("blocked messages", () => {
  it("say why, and how to make room", () => {
    expect(addBlockedText("max_recipes", usage({ recipes: 100 }))).toBe(
      "You have 100 recipes, as many as your plan includes. To add another, move one you don’t need to Trash.",
    );
    expect(addBlockedText("max_recipes", usage({ recipes: 130 }))).toBe(
      "You have 130 recipes, and your plan includes 100. To add another, move one you don’t need to Trash.",
    );
    expect(addBlockedText("max_text_bytes", usage({ textBytes: 3.2 * 1024 * 1024 }))).toBe(
      "Your recipes hold 3.2 MB of text, and your plan includes 3 MB. To add another, delete recipes you don’t need for good: move them to Trash, then empty it.",
    );
    expect(restoreBlockedText(usage({ recipes: 100 }))).toBe(
      "You have 100 recipes, as many as your plan includes. To put this one back, move another recipe to Trash first.",
    );
  });
});
