import { describe, expect, it } from "vitest";
import { draftContent, draftIssues, type RecipeDraft } from "./importDraft";
import { ingredientsFromText } from "./recipeLines";

function draft(extra: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    version: 1,
    source: "photo",
    externalId: null,
    externalHash: null,
    inputs: [{ kind: "image", name: "card.jpg", url: null, imageHash: null }],
    fields: {
      title: {
        value: "Sugar Butter Balls",
        confidence: "high",
        from: [{ kind: "ai", input: 0, detail: null }],
      },
      ingredients: {
        value: ingredientsFromText("1 cup butter\n½ cup sugar"),
        confidence: "medium",
        from: [{ kind: "ai", input: 0, detail: "front" }],
      },
    },
    lineConfidence: { ingredients: ["high", "low"], directions: null },
    categories: null,
    photos: [{ input: 0, role: "import_original" }],
    warnings: ["The card's corner is torn."],
    producer: { importer: "test", model: null },
    ...extra,
  };
}

describe("recipe drafts", () => {
  it("accepts a valid draft and fills in what wasn't found", () => {
    expect(draftIssues(draft())).toEqual([]);
    const content = draftContent(draft());
    expect(content.title).toBe("Sugar Butter Balls");
    expect(content.ingredients.map((l) => l.text)).toEqual(["1 cup butter", "½ cup sugar"]);
    expect(content.directions).toEqual([]);
    expect(content.notes).toBe("");
  });

  it("finds what's wrong", () => {
    const bad = {
      ...draft(),
      version: 2,
      source: "fax",
      fields: {
        title: { value: "x", confidence: "certain", from: [] },
        flavor: { value: "x", confidence: "high", from: [] },
      },
      photos: [{ input: 3, role: "photo" }],
      producer: null,
    };
    expect(draftIssues(bad).map((i) => i.path)).toEqual([
      "version",
      "source",
      "fields.title.confidence",
      "fields.flavor",
      "photos[0]",
      "producer",
    ]);
  });

  it("checks the content with the recipe's own rules", () => {
    const tooLong = draft({
      fields: {
        title: { value: "x".repeat(1000), confidence: "low", from: [] },
      },
    });
    expect(draftIssues(tooLong)).toEqual([{ path: "fields.title", problem: "too_long" }]);
  });

  it("checks where each piece came from", () => {
    const wrongInput = draft({
      fields: {
        title: { value: "Pie", confidence: "high", from: [{ kind: "ai", input: 5, detail: null }] },
      },
    });
    expect(draftIssues(wrongInput)).toEqual([
      { path: "fields.title.from[0].input", problem: "invalid" },
    ]);
  });
});
