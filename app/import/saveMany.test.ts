import { describe, expect, it } from "vitest";
import type { RecipeDraft } from "../../shared/importDraft";
import { directionsFromText, ingredientsFromText } from "../../shared/recipeLines";
import { needsReview } from "./saveMany";

// Phase E12: "Save selected" saves only drafts with nothing to look at; the rest stay waiting.

function draft(patch: Partial<RecipeDraft> = {}): RecipeDraft {
  const ingredients = ingredientsFromText("1 cup flour\n2 eggs");
  return {
    version: 1,
    source: "pdf",
    externalId: null,
    externalHash: null,
    inputs: [{ kind: "image", name: "Family.pdf, page 2", url: null, imageHash: "a".repeat(64) }],
    fields: {
      title: { value: "Lemon Bars", confidence: "high", from: [] },
      ingredients: { value: ingredients, confidence: "high", from: [] },
      directions: { value: directionsFromText("Mix.\nBake."), confidence: "high", from: [] },
    },
    lineConfidence: { ingredients: ["high", "high"], directions: ["high", "high"] },
    unsureWords: {},
    categories: null,
    photos: [{ input: 0, role: "import_original" }],
    warnings: [],
    producer: { importer: "ai", model: "fake" },
    ...patch,
  };
}

describe("which drafts can be saved at once", () => {
  it("saves a draft read with confidence, its pages kept as originals", () => {
    expect(needsReview(draft(), true)).toBeNull();
    expect(needsReview(draft(), false)).toBeNull();
  });

  it("leaves a draft with anything uncertain for its own review", () => {
    const base = draft();
    expect(
      needsReview(
        draft({
          fields: {
            ...base.fields,
            title: { value: "Lemon Bars", confidence: "medium", from: [] },
          },
        }),
        true,
      ),
    ).toBe("check");
    expect(
      needsReview(
        draft({ lineConfidence: { ingredients: ["high", "low"], directions: null } }),
        true,
      ),
    ).toBe("check");
    expect(needsReview(draft({ unsureWords: { x: ["2 1/4"] } }), true)).toBe("check");
    expect(needsReview(draft({ warnings: ["The back of the card was hard to read"] }), true)).toBe(
      "check",
    );
    // Nothing to save: no title.
    expect(
      needsReview(
        draft({ fields: { ...base.fields, title: { value: "", confidence: "high", from: [] } } }),
        true,
      ),
    ).toBe("check");
  });

  it("leaves photos to choose for Premium, where they can be kept", () => {
    const withPhotos = draft({ photos: [{ input: 0, role: "photo" }] });
    expect(needsReview(withPhotos, true)).toBe("photos");
    expect(needsReview(withPhotos, false)).toBeNull();
  });
});
