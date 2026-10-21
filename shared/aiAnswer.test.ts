import { describe, expect, it } from "vitest";
import {
  answerToDrafts,
  isAiAnswer,
  secondLookReasons,
  stillUncertain,
  webAddress,
  withoutBadParts,
  type AiLine,
  type AiRecipe,
  wordsIn,
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
      ["1 cup walnuts", false],
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

  it("keeps the words the AI wasn't sure of, by line, when they're really in the line", () => {
    const [draft] = drafts(
      recipe({
        ingredients: [
          { ...line("1/3 Cups flowr", "low"), unsure: ["1/3", "flowr", "flour", "1/3"] },
          { ...line("1 Cup sugar", "high"), unsure: [] },
        ],
      }),
    );
    expect(draftIssues(draft!)).toEqual([]);
    const [flour, sugar] = draft!.fields.ingredients!.value;
    // Only words as written in the line, once each.
    expect(draft!.unsureWords).toEqual({ [flour!.id]: ["1/3", "flowr"] });
    expect(draft!.unsureWords?.[sugar!.id]).toBeUndefined();
    // Answers saved before E10 have none.
    expect(drafts(recipe())[0]!.unsureWords).toBeUndefined();
    expect(wordsIn("2 Tbs butter", [" Tbs ", "x".repeat(61)])).toEqual(["Tbs"]);
    expect(
      draftIssues({ ...draft!, unsureWords: { a: [1] } as unknown as Record<string, string[]> }),
    ).toEqual([{ path: "unsureWords", problem: "invalid" }]);
  });

  it("writes units and soda the standard way, except on a web page", () => {
    const card = recipe({
      ingredients: [
        line("1T butter"),
        { ...line("1/2 teas salt", "low"), unsure: ["1/2 teas"] },
        line("1/2 t soda"),
        line("For the Cake:", "high", true),
      ],
      directions: [line("Add 2 C. Stir in 1 1/2 c peanut butter.")],
    });
    const [draft] = drafts(card);
    const ingredients = draft!.fields.ingredients!.value;
    expect(ingredients.map((l) => l.text)).toEqual([
      "1 Tbsp butter",
      "1/2 tsp salt",
      "1/2 tsp baking soda",
      "For the Cake:",
    ]);
    // An unsure "1/2 teas" is still highlighted, as the "1/2 tsp" it became.
    expect(draft!.unsureWords).toEqual({ [ingredients[1]!.id]: ["1/2 tsp"] });
    expect(draft!.fields.directions!.value[0]!.text).toBe(
      "Add 2 cups. Stir in 1 1/2 cups peanut butter.",
    );
    const [page] = answerToDrafts({ recipes: [card] }, { ...context, source: "website" });
    expect(page!.fields.ingredients!.value.map((l) => l.text)).toEqual([
      "1T butter",
      "1/2 teas salt",
      "1/2 t soda",
      "For the Cake:",
    ]);
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
    const unsureLine = { text: "x", heading: false, confidence: "low", unsure: ["x"] };
    expect(isAiAnswer({ recipes: [{ ...recipe(), ingredients: [unsureLine] }] })).toBe(true);
    expect(
      isAiAnswer({ recipes: [{ ...recipe(), ingredients: [{ ...unsureLine, unsure: "x" }] }] }),
    ).toBe(false);
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

  it("is needed when the AI was unsure of something that matters, not for its notes", () => {
    const lowLine = recipe({ ingredients: [line("2 1/4 cup flour", "low")] });
    expect(secondLookReasons(drafts(lowLine))).toEqual(["unsure"]);
    const lowTimes = recipe({ times: { ...recipe().times, confidence: "low" } });
    expect(secondLookReasons(drafts(lowTimes))).toEqual(["unsure"]);
    // A note is for the person reviewing it ("the page gives no prep time"), not a doubt to settle.
    expect(secondLookReasons(drafts(recipe({ unclear: ["the page gives no prep time"] })))).toEqual(
      [],
    );
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
    // Seasoning and frying oil are rarely measured (seen in the model comparison, 2026-10-19).
    const seasoned = recipe({
      ingredients: [
        line("Kosher salt"),
        line("Freshly ground black pepper"),
        line("Vegetable oil"),
        line("Softened unsalted butter, for muffins"),
        line("1 egg"),
      ],
    });
    expect(secondLookReasons(drafts(seasoned))).toEqual([]);
    // But an oil named with more ("oil-packed tuna") or another ingredient still counts.
    const unmeasured = recipe({ ingredients: [line("oil-packed tuna"), line("sugar")] });
    expect(secondLookReasons(drafts(unmeasured))).toEqual(["missing_amounts"]);
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

describe("an odd part of an answer", () => {
  it("doesn't lose the recipe: a web address is made whole, or left out", () => {
    expect(webAddress("https://june.example.com/cake")).toBe("https://june.example.com/cake");
    expect(webAddress("instagram.com/junebakes")).toBe("https://instagram.com/junebakes");
    expect(webAddress("www.example.com")).toBe("https://www.example.com/");
    expect(webAddress("@junebakes")).toBeNull();
    expect(webAddress("June's blog")).toBeNull();
    expect(webAddress("javascript:alert(1)")).toBeNull();

    // The screenshot a stronger model read (2026-10-14): a handle where an address goes.
    const [draft] = drafts(
      recipe({
        source: {
          kind: "website",
          name: "June Bakes",
          author: null,
          page: null,
          url: "@junebakes on Instagram",
          ...sure,
        },
      }),
    );
    expect(draft?.fields.source?.value).toMatchObject({ name: "June Bakes", url: null });
    expect(draftIssues(draft)).toEqual([]);
  });

  it("leaves out only the part that breaks the rules", () => {
    const [draft] = drafts(recipe());
    const broken = {
      ...draft!,
      fields: {
        ...draft!.fields,
        notes: { value: "x".repeat(300_000), confidence: "high" as const, from: [] },
      },
    };
    expect(draftIssues(broken).length).toBeGreaterThan(0);
    const kept = withoutBadParts(broken, null);
    expect(kept?.fields.notes).toBeUndefined();
    expect(kept?.fields.ingredients?.value).toHaveLength(3);
    expect(draftIssues(kept)).toEqual([]);
  });
});
