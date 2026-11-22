import { describe, expect, it } from "vitest";
import {
  MAX_DRAFT_CATEGORIES,
  MAX_DRAFT_PHOTOS,
  categoryPathKey,
  draftConflicts,
  draftImageHashes,
  draftParts,
  emptyDraftData,
  isDraftData,
  isEmptyDraft,
  partsText,
  sameValue,
  untitledHint,
  type DraftData,
  type DraftPhoto,
  type SavedAtDone,
} from "./drafts";
import { emptyRecipeContent, type IngredientLine, type RecipeContent } from "./recipe";

// U27 part 3: drafts.

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const hash = (c: string) => c.repeat(64);

const line = (text: string, heading = false): IngredientLine => ({ id: uuid(), text, heading });

const photo = (c: string): DraftPhoto => ({
  id: uuid(),
  imageHash: hash(c),
  width: 800,
  height: 600,
  takenAt: null,
});

const draft = (over: Partial<DraftData>): DraftData => ({ ...emptyDraftData(), ...over });

const content = (over: Partial<RecipeContent> = {}): RecipeContent => ({
  ...emptyRecipeContent(),
  title: "Lemon Bars",
  ingredients: [line("1 cup flour")],
  ...over,
});

describe("sameValue", () => {
  it("compares JSON values deeply, ignoring key order and absent keys", () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue({ a: null }, { a: undefined })).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue("a", "a")).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, {})).toBe(false);
  });
});

describe("isEmptyDraft", () => {
  it("is empty with nothing typed or added", () => {
    expect(isEmptyDraft(emptyDraftData())).toBe(true);
    expect(isEmptyDraft(draft({ fields: emptyRecipeContent() }))).toBe(true);
    expect(
      isEmptyDraft(
        draft({ fields: { ...emptyRecipeContent(), title: "  ", ingredients: [line(" ")] } }),
      ),
    ).toBe(true);
  });

  it("isn't once a word, a time, a photo or a category is there", () => {
    expect(isEmptyDraft(draft({ fields: { title: "Soup" } }))).toBe(false);
    expect(isEmptyDraft(draft({ fields: { ingredients: [line("2 eggs")] } }))).toBe(false);
    const times = emptyRecipeContent().times;
    expect(
      isEmptyDraft(draft({ fields: { times: { ...times, prep: { minutes: 10, text: null } } } })),
    ).toBe(false);
    expect(isEmptyDraft(draft({ fields: { difficulty: "easy" } }))).toBe(false);
    expect(isEmptyDraft(draft({ photos: [photo("a")] }))).toBe(false);
    expect(isEmptyDraft(draft({ categories: [["Dinner"]] }))).toBe(false);
    expect(isEmptyDraft(draft({ photos: [], categories: [] }))).toBe(true);
  });
});

describe("draftParts", () => {
  const saved = (over: Partial<RecipeContent> = {}) => ({
    content: content(over),
    galleryIds: ["p1", "p2"],
    categoryKeys: ["dinner", "fish › salmon"],
  });

  it("names the parts that differ from the saved recipe, in the editor's order", () => {
    const s = saved();
    const data = draft({
      fields: { notes: "Chill first", ingredients: [line("2 cups flour")], title: "Lemon Bars" },
      photos: [
        { ...photo("a"), id: "p2" },
        { ...photo("b"), id: "p1" },
      ],
    });
    expect(draftParts(s, data)).toEqual(["Ingredients", "Photos", "Notes"]);
  });

  it("is empty once the draft matches the saved recipe again", () => {
    const s = saved();
    const data = draft({
      fields: { title: "Lemon Bars", ingredients: s.content.ingredients },
      photos: [
        { ...photo("a"), id: "p1" },
        { ...photo("b"), id: "p2" },
      ],
      categories: [["Fish", "Salmon"], ["DINNER"]],
    });
    expect(draftParts(s, data)).toEqual([]);
  });

  it("groups times, servings and difficulty as one part", () => {
    expect(
      draftParts(
        saved(),
        draft({ fields: { servings: { count: 4, yield: null }, difficulty: "easy" } }),
      ),
    ).toEqual(["Time and servings"]);
  });

  it("for a new recipe names the parts with something in them", () => {
    const data = draft({
      fields: { ...emptyRecipeContent(), title: "Soup", directions: [line("Stir.")] },
      categories: [["Soups"]],
    });
    expect(draftParts(null, data)).toEqual(["Title", "Directions", "Categories"]);
  });
});

describe("partsText", () => {
  it("lists parts with commas, or as a sentence with 'and'", () => {
    expect(partsText(["Photos", "Ingredients"])).toBe("Ingredients, Photos");
    expect(partsText(["Notes", "Ingredients"], "sentence")).toBe("Ingredients and Notes");
    expect(partsText(["Notes", "Directions", "Ingredients"], "sentence")).toBe(
      "Ingredients, Directions and Notes",
    );
    expect(partsText(["Ingredients"], "sentence")).toBe("Ingredients");
  });
});

describe("draftConflicts", () => {
  const me = "me";
  const sarah = "sarah";
  const base = content();
  const savedAt = (over: Partial<SavedAtDone> = {}): SavedAtDone => ({
    content: base,
    galleryIds: ["p1"],
    categoryKeys: ["dinner"],
    updatedByUserId: me,
    photosBy: [],
    categoriesBy: [],
    ...over,
  });

  it("names a partner who changed a field the draft changes too", () => {
    const mine = draft({
      fields: { ingredients: [line("2 cups flour")], notes: "Mine" },
      base: { ingredients: base.ingredients, notes: base.notes },
    });
    const now = savedAt({
      content: { ...base, ingredients: [line("3 cups flour")] },
      fieldBy: { ingredients: sarah },
      updatedByUserId: sarah,
    });
    expect(draftConflicts({ me, members: [me, sarah], saved: now, data: mine })).toEqual([
      { userId: sarah, parts: ["Ingredients"] },
    ]);
  });

  it("doesn't ask about the partner's other fields, or the same change as mine", () => {
    const mine = draft({
      fields: { ingredients: [line("2 cups flour")] },
      base: { ingredients: base.ingredients },
    });
    const otherField = savedAt({
      content: { ...base, notes: "Sarah's note" },
      fieldBy: { notes: sarah },
    });
    expect(draftConflicts({ me, members: [me, sarah], saved: otherField, data: mine })).toEqual([]);
    const sameChange = savedAt({
      content: { ...base, ingredients: mine.fields.ingredients! },
      fieldBy: { ingredients: sarah },
    });
    expect(draftConflicts({ me, members: [me, sarah], saved: sameChange, data: mine })).toEqual([]);
  });

  it("doesn't ask about my own change from another device", () => {
    const mine = draft({ fields: { title: "Mine" }, base: { title: base.title } });
    const now = savedAt({ content: { ...base, title: "Also mine" }, fieldBy: { title: me } });
    expect(draftConflicts({ me, members: [me, sarah], saved: now, data: mine })).toEqual([]);
  });

  it("falls back to who last changed the recipe for fields with nobody recorded", () => {
    const mine = draft({ fields: { title: "Mine" }, base: { title: base.title } });
    const now = savedAt({ content: { ...base, title: "Hers" }, updatedByUserId: sarah });
    expect(draftConflicts({ me, members: [me, sarah], saved: now, data: mine })).toEqual([
      { userId: sarah, parts: ["Title"] },
    ]);
    // Someone no longer in the household isn't asked about.
    expect(draftConflicts({ me, members: [me, "tom"], saved: now, data: mine })).toEqual([]);
  });

  it("names a partner who changed the photos or categories since the draft began", () => {
    const mine = draft({
      photos: [{ ...photo("a"), id: "p1" }, photo("b")],
      basePhotos: ["p1"],
      categories: [["Dinner"], ["Quick"]],
      baseCategories: ["dinner"],
      fields: { notes: "x" },
      base: { notes: "" },
    });
    const now = savedAt({
      galleryIds: ["p1", "p9"],
      categoryKeys: ["dinner", "fish"],
      photosBy: [sarah],
      categoriesBy: [me, sarah],
    });
    expect(draftConflicts({ me, members: [me, sarah], saved: now, data: mine })).toEqual([
      { userId: sarah, parts: ["Photos", "Categories"] },
    ]);
  });

  it("doesn't ask about my own photo and category changes outside the draft", () => {
    const mine = draft({
      categories: [["Dinner"], ["Desserts"]],
      baseCategories: ["dinner"],
      photos: [{ ...photo("a"), id: "p1" }, photo("b")],
      basePhotos: ["p1"],
    });
    // I added "Quick" on the recipe page, and a photo on my phone, while the draft waited.
    const now = savedAt({
      galleryIds: ["p1", "p9"],
      categoryKeys: ["dinner", "quick"],
      photosBy: [me],
      categoriesBy: [me],
    });
    expect(draftConflicts({ me, members: [me, sarah], saved: now, data: mine })).toEqual([]);
  });

  it("never asks a person on their own", () => {
    const mine = draft({ fields: { title: "Mine" }, base: { title: base.title } });
    const now = savedAt({ content: { ...base, title: "Other" }, fieldBy: { title: sarah } });
    expect(draftConflicts({ me, members: [me], saved: now, data: mine })).toEqual([]);
  });
});

describe("untitledHint", () => {
  it("starts with the first ingredients, headings left out", () => {
    const data = draft({
      fields: {
        ingredients: [
          line("For the dough", true),
          line("2 cups flour"),
          line("1 tsp salt"),
          line("1 cup butter, cold and cubed"),
        ],
      },
    });
    expect(untitledHint(data)).toBe("2 cups flour, 1 tsp salt, 1 cup butter…");
  });

  it("keeps short ingredients whole", () => {
    expect(untitledHint(draft({ fields: { ingredients: [line("2 eggs")] } }))).toBe("2 eggs");
  });

  it("then the start of the first step, then the notes, then About", () => {
    expect(
      untitledHint(
        draft({
          fields: {
            ingredients: [],
            directions: [line("Heat the oven to 350°F and grease a 9-inch pan.")],
          },
        }),
      ),
    ).toBe("Heat the oven to 350°F and grease a…");
    expect(untitledHint(draft({ fields: { notes: "From Gran", description: "Nice" } }))).toBe(
      "From Gran",
    );
    expect(untitledHint(draft({ fields: { notes: " ", description: "A quick soup" } }))).toBe(
      "A quick soup",
    );
    expect(untitledHint(draft({ photos: [photo("a")] }))).toBeNull();
  });
});

describe("isDraftData", () => {
  const good = (): DraftData =>
    draft({
      fields: {
        title: "",
        ingredients: [line("")],
        source: { ...emptyRecipeContent().source, url: "not a url" },
      },
      base: { title: "Old" },
      photos: [photo("a")],
      basePhotos: [uuid()],
      categories: [["Desserts", "Cakes"]],
      baseCategories: [categoryPathKey(["Desserts"])],
    });

  it("takes a draft of the right shape, even with what's typed having problems", () => {
    expect(isDraftData(good())).toBe(true);
    expect(isDraftData(emptyDraftData())).toBe(true);
  });

  it("turns away the wrong shapes", () => {
    const bad: unknown[] = [
      null,
      "x",
      { ...good(), extra: 1 },
      { ...good(), fields: { colour: "red" } },
      { ...good(), fields: { title: 5 } },
      { ...good(), fields: { ingredients: [{ id: "a", text: "x" }] } },
      { ...good(), fields: { difficulty: "brutal" } },
      { ...good(), fields: { times: { prep: { minutes: "5", text: null } } } },
      { ...good(), photos: [{ ...photo("a"), imageHash: "nope" }] },
      { ...good(), photos: [{ ...photo("a"), id: "not-a-uuid" }] },
      { ...good(), photos: Array.from({ length: MAX_DRAFT_PHOTOS + 1 }, () => photo("a")) },
      { ...good(), categories: [["Bad › name"]] },
      { ...good(), categories: [[]] },
      { ...good(), categories: Array.from({ length: MAX_DRAFT_CATEGORIES + 1 }, () => ["A"]) },
      { ...good(), photosArranged: "yes" },
    ];
    for (const value of bad) expect(isDraftData(value)).toBe(false);
    const twice = photo("a");
    expect(isDraftData({ ...good(), photos: [twice, twice] })).toBe(false);
  });
});

describe("draftImageHashes", () => {
  it("lists each photo's image once", () => {
    const a = photo("a");
    expect(draftImageHashes(draft({ photos: [a, { ...a, id: uuid() }, photo("b")] }))).toEqual([
      hash("a"),
      hash("b"),
    ]);
    expect(draftImageHashes(emptyDraftData())).toEqual([]);
  });
});
