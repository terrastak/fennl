import { describe, expect, it } from "vitest";
import {
  answerToDrafts,
  isAiAnswer,
  secondLookReasons,
  stillUncertain,
  type AiLine,
  type AiRecipe,
} from "./aiAnswer";
import { draftIssues } from "./importDraft";

// Phase E7: the AI's answer as recipe drafts, and when a read gets a second look.

const sure = { confidence: "high" as const };
const line = (
  text: string,
  confidence: AiLine["confidence"] = "high",
  heading = false,
): AiLine => ({
  text,
  heading,
  confidence,
});

function recipe(overrides: Partial<AiRecipe> = {}): AiRecipe {
  return {
    title: { text: "Walnut Cherry Cake", ...sure },
    description: { text: "", ...sure },
    ingredients: [line("1 C walnuts"), line("1/2 tsp vanilla"), line("Salt to taste")],
    directions: [line("Coarsely chop 1/4 C walnuts, set aside.")],
    notes: { text: "", ...sure },
    times: {
      prep: { minutes: null, text: null },
      cook: { minutes: 35, text: null },
      total: { minutes: null, text: null },
      ...sure,
    },
    servings: { count: null, yield: null, ...sure },
    source: { kind: null, name: null, author: null, page: null, url: null, ...sure },
    unclear: [],
    ...overrides,
  };
}

let n = 0;
const context = {
  source: "photo" as const,
  inputs: [{ kind: "image" as const, name: "card.jpg", url: null, imageHash: null }],
  photos: [{ input: 0, role: "import_original" as const }],
  model: "model-a",
  newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
};

const drafts = (...recipes: AiRecipe[]) => answerToDrafts({ recipes }, context);

describe("an AI answer as drafts", () => {
  it("keeps what was read, with how sure the AI was of each part and line", () => {
    const [draft] = drafts(
      recipe({
        ingredients: [line("For the cake", "high", true), line("1 C walnuts", "medium")],
        source: { kind: "person", name: "Aunt June", author: null, page: null, url: null, ...sure },
        unclear: ["  the oven temperature is smudged "],
      }),
    );
    expect(draft).toBeDefined();
    expect(draftIssues(draft)).toEqual([]);
    expect(draft!.fields.title).toEqual({
      value: "Walnut Cherry Cake",
      confidence: "high",
      from: [{ kind: "ai", input: null, detail: null }],
    });
    expect(draft!.fields.ingredients?.value.map((l) => [l.text, l.heading])).toEqual([
      ["For the cake", true],
      ["1 C walnuts", false],
    ]);
    // A list is as sure as its least sure line.
    expect(draft!.fields.ingredients?.confidence).toBe("medium");
    expect(draft!.lineConfidence.ingredients).toEqual(["high", "medium"]);
    expect(draft!.fields.times?.value.cook).toEqual({ minutes: 35, text: null });
    expect(draft!.fields.source?.value).toMatchObject({ kind: "person", name: "Aunt June" });
    // Nothing stated, nothing kept.
    expect(draft!.fields.description).toBeUndefined();
    expect(draft!.fields.servings).toBeUndefined();
    expect(draft!.warnings).toEqual(["the oven temperature is smudged"]);
    expect(draft!.producer).toEqual({ importer: "ai", model: "model-a" });
    expect(draft!.photos).toEqual([{ input: 0, role: "import_original" }]);
  });

  it("makes one draft per recipe, and none for an empty one", () => {
    const found = drafts(
      recipe(),
      recipe({ title: { text: " ", ...sure }, ingredients: [], directions: [] }),
      recipe({ title: { text: "Lemon Bars", ...sure } }),
    );
    expect(found.map((d) => d.fields.title?.value)).toEqual(["Walnut Cherry Cake", "Lemon Bars"]);
  });

  it("only takes answers of the right shape", () => {
    expect(isAiAnswer({ recipes: [recipe()] })).toBe(true);
    expect(isAiAnswer({ recipes: [] })).toBe(true);
    expect(isAiAnswer(null)).toBe(false);
    expect(isAiAnswer({ recipes: [{ ...recipe(), title: "Cake" }] })).toBe(false);
    expect(
      isAiAnswer({ recipes: [{ ...recipe(), ingredients: [{ text: "x", confidence: "sure" }] }] }),
    ).toBe(false);
    expect(
      isAiAnswer({
        recipes: [
          { ...recipe(), times: { ...recipe().times, cook: { minutes: 1.5, text: null } } },
        ],
      }),
    ).toBe(false);
  });
});

describe("a second look", () => {
  it("isn't needed when the read is complete and sure", () => {
    expect(secondLookReasons(drafts(recipe()))).toEqual([]);
  });

  it("is needed when nothing was read, or a main part is missing", () => {
    expect(secondLookReasons([])).toEqual(["no_answer"]);
    expect(secondLookReasons(drafts(recipe({ directions: [] })))).toEqual(["missing_part"]);
    expect(secondLookReasons(drafts(recipe({ title: { text: "", ...sure } })))).toEqual([
      "missing_part",
    ]);
  });

  it("is needed when the AI was unsure of something that matters, or said so", () => {
    const lowLine = recipe({ ingredients: [line("2 1/4 cup flour", "low")] });
    expect(secondLookReasons(drafts(lowLine))).toEqual(["unsure"]);
    const lowTimes = recipe({ times: { ...recipe().times, confidence: "low" } });
    expect(secondLookReasons(drafts(lowTimes))).toEqual(["unsure"]);
    expect(secondLookReasons(drafts(recipe({ unclear: ["smudged"] })))).toEqual(["unsure"]);
    // Medium is fine, and so is an unsure headnote.
    const fine = recipe({
      ingredients: [line("1 C walnuts", "medium")],
      description: { text: "Grandma's", confidence: "low" },
    });
    expect(secondLookReasons(drafts(fine))).toEqual([]);
  });

  it("is needed when amounts look missing or misread", () => {
    const missing = recipe({ ingredients: [line("walnuts"), line("cake mix"), line("1 egg")] });
    expect(secondLookReasons(drafts(missing))).toEqual(["missing_amounts"]);
    // One is fine, and lines that rightly have no amount don't count.
    const fine = recipe({
      ingredients: [line("walnuts"), line("Salt and pepper to taste"), line("Butter for the pan")],
    });
    expect(secondLookReasons(drafts(fine))).toEqual([]);
    expect(secondLookReasons(drafts(recipe({ ingredients: [line("35 cups flour")] })))).toEqual([
      "odd_amount",
    ]);
    expect(secondLookReasons(drafts(recipe({ ingredients: [line("35 g flour")] })))).toEqual([]);
  });

  it("follows the admin console's thresholds (0 turns a check off)", () => {
    const odd = drafts(
      recipe({ ingredients: [line("walnuts"), line("cake mix"), line("30 cups milk")] }),
    );
    expect(secondLookReasons(odd, { missingAmounts: 0, oddAmount: 0 })).toEqual([]);
    expect(secondLookReasons(odd, { missingAmounts: 3, oddAmount: 40 })).toEqual([]);
    expect(secondLookReasons(odd, { missingAmounts: 2, oddAmount: 24 }).sort()).toEqual([
      "missing_amounts",
      "odd_amount",
    ]);
  });
});

describe("what's still uncertain after reading again", () => {
  it("is anything the AI marked unsure or said it couldn't read", () => {
    expect(stillUncertain(drafts(recipe())[0]!)).toBe(false);
    expect(stillUncertain(drafts(recipe({ unclear: ["smudged"] }))[0]!)).toBe(true);
    expect(stillUncertain(drafts(recipe({ directions: [line("Bake at 3?0", "low")] }))[0]!)).toBe(
      true,
    );
  });
});
