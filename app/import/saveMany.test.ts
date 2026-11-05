import { describe, expect, it } from "vitest";
import type { RecipeDraft } from "../../shared/importDraft";
import { directionsFromText, ingredientsFromText } from "../../shared/recipeLines";
import { draftStanding, needsReview, savedText } from "./saveMany";

// Phases E12 and U19: drafts with nothing to look at are ready to save; the rest say why they
// wait, and only a draft that fails the editor's checks can never be saved from the list.

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
    ).toBe("blocked");
  });

  it("leaves photos to choose for Premium, where they can be kept", () => {
    const withPhotos = draft({ photos: [{ input: 0, role: "photo" }] });
    expect(needsReview(withPhotos, true)).toBe("photos");
    expect(needsReview(withPhotos, false)).toBeNull();
  });
});

describe("what each draft's label says (U19)", () => {
  it("says a ready draft is ready", () => {
    expect(draftStanding(draft(), true)).toEqual({ standing: "ready", detail: null });
  });

  it("counts the places Fennl wasn't sure of", () => {
    const unsure = draft({
      lineConfidence: { ingredients: ["high", "low"], directions: ["medium", "high"] },
      unsureWords: { x: ["2 1/4", "Karo"] },
    });
    expect(draftStanding(unsure, true)).toEqual({
      standing: "check",
      detail: "4 things Fennl wasn’t sure of",
    });
    expect(draftStanding(draft({ warnings: ["Hard to read"] }), true)).toEqual({
      standing: "check",
      detail: "1 thing Fennl wasn’t sure of",
    });
  });

  it("says a draft with no title can't be saved until it's finished", () => {
    const base = draft();
    const untitled = draft({
      fields: { ...base.fields, title: { value: " ", confidence: "high", from: [] } },
    });
    expect(draftStanding(untitled, true)).toEqual({ standing: "blocked", detail: "no title" });
  });

  it("says how many photos there are to choose, on Premium only", () => {
    const withPhotos = draft({
      photos: [
        { input: 0, role: "photo" },
        { input: 1, role: "photo" },
        { input: 2, role: "import_original" },
      ],
    });
    expect(draftStanding(withPhotos, true)).toEqual({ standing: "photos", detail: "2 photos" });
    expect(draftStanding(withPhotos, false)).toEqual({ standing: "ready", detail: null });
  });
});

describe("what a save says afterwards", () => {
  it("says only how many were saved when all of them were", () => {
    expect(
      savedText({ saved: ["a", "b", "c"], left: [], originalsMissed: 0, photosMissed: 0 }),
    ).toBe("Saved 3 recipes.");
  });

  it("names the ones left waiting, and a cover photo that couldn't be added", () => {
    expect(
      savedText({
        saved: ["a"],
        left: [{ id: "b", title: "Page 14", reason: "blocked" }],
        originalsMissed: 0,
        photosMissed: 1,
      }),
    ).toBe(
      "Saved 1 recipe. For one of them, the cover photo couldn’t be added. One is still waiting for you to review: Page 14 (can’t be saved until it’s finished).",
    );
  });
});
