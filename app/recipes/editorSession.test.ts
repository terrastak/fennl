import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRecipeContent, type RecipeContent } from "../../shared/recipe";
import type { RecipeChange } from "../../shared/sync";
import type { DraftData } from "../../shared/drafts";
import { EditorSession, type DraftWrite, type SavedState } from "./editorSession";

const ID = "6f1c2a4e-8a1b-4c3d-9e2f-0a1b2c3d4e5f";

function setUp(initial: RecipeContent | null = null) {
  const saves: RecipeChange[] = [];
  let refuse = false;
  const session = new EditorSession({
    id: ID,
    initial,
    delayMs: 100,
    now: () => 1_700_000_000_000 + saves.length,
    save: async (change) => {
      if (refuse) throw new Error("Editing is paused.");
      saves.push(change);
    },
  });
  return {
    session,
    saves,
    state: () => session.getSnapshot(),
    refuse: (value: boolean) => {
      refuse = value;
    },
  };
}

const existing = (): RecipeContent => ({ ...emptyRecipeContent(), title: "Stew", notes: "Hot" });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a new recipe", () => {
  it("is created by the first save once it has a title, with every field", async () => {
    const { session, saves, state } = setUp();
    expect(state().save).toBe("needs_title");
    session.set({ notes: "From June" });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves).toHaveLength(0);

    session.set({ title: "Green chile stew" });
    expect(state().save).toBe("saving");
    await vi.advanceTimersByTimeAsync(200);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.create).toBeDefined();
    expect(saves[0]?.fields).toMatchObject({ title: "Green chile stew", notes: "From June" });
    expect(state()).toMatchObject({ created: true, save: "saved", canUndo: false });

    // Later saves send only what changed.
    session.set({ description: "Mild" });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves[1]).toMatchObject({ fields: { description: "Mild" } });
    expect(saves[1]?.create).toBeUndefined();
  });

  it("waits until typing stops", async () => {
    const { session, saves } = setUp(existing());
    session.set({ title: "S" });
    await vi.advanceTimersByTimeAsync(60);
    session.set({ title: "So" });
    await vi.advanceTimersByTimeAsync(60);
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(saves).toEqual([expect.objectContaining({ fields: { title: "So" } })]);
  });
});

describe("text boxes", () => {
  it("turn into lines, times and servings, and tidy up when left", async () => {
    const { session, saves, state } = setUp(existing());
    session.setBox("ingredients", "• 1 cup flour\n\nFOR THE TOP:\n2 eggs");
    session.setBox("prep", "90");
    session.setBox("servings", "6");
    expect(state().draft.ingredients.map((l) => [l.text, l.heading])).toEqual([
      ["1 cup flour", false],
      ["FOR THE TOP:", true],
      ["2 eggs", false],
    ]);
    expect(state().draft.times.prep).toEqual({ minutes: 90, text: null });
    expect(state().boxes.prep).toBe("90");
    session.tidyBox("prep");
    session.tidyBox("ingredients");
    expect(state().boxes.prep).toBe("1 hr 30 min");
    expect(state().boxes.ingredients).toBe("1 cup flour\nFOR THE TOP:\n2 eggs");

    await session.flush();
    expect(Object.keys(saves[0]?.fields ?? {}).sort()).toEqual([
      "ingredients",
      "servings",
      "times",
    ]);
  });

  it("keep how many it serves and makes in one box (U27)", () => {
    const { session, state } = setUp(existing());
    session.setBox("servings", "24 cookies");
    expect(state().draft.servings).toEqual({ count: 24, yield: "24 cookies" });
    session.setBox("servings", "Makes 24 pancakes, serves 8");
    expect(state().draft.servings).toEqual({ count: 8, yield: "24 pancakes" });
    session.tidyBox("servings");
    expect(state().boxes.servings).toBe("Serves 8, makes 24 pancakes");
    session.setBox("servings", "");
    expect(state().draft.servings).toEqual({ count: null, yield: null });
  });

  it("link a step to a recipe, and unlink it (U27)", () => {
    const { session, state } = setUp(existing());
    session.setBox("directions", "Make the herb butter.\nSear the salmon.");
    const step = state().draft.directions[0]!;
    const LINK = "8a1b2c3d-0000-4000-8000-000000000003";
    session.setLink("directions", step.id, LINK);
    expect(state().draft.directions[0]?.linkedRecipeId).toBe(LINK);
    // Typing elsewhere keeps it.
    session.setBox("directions", "Make the herb butter.\nSear the salmon well.");
    expect(state().draft.directions[0]?.linkedRecipeId).toBe(LINK);
    session.setLink("directions", step.id, null);
    expect(state().draft.directions[0]?.linkedRecipeId).toBeNull();
  });

  it("keeps line IDs while typing, and the heading button's choice", () => {
    const { session, state } = setUp(existing());
    session.setBox("directions", "Brown the pork");
    const id = state().draft.directions[0]?.id;
    session.setBox("directions", "Brown the pork well");
    expect(state().draft.directions[0]?.id).toBe(id);

    session.toggleHeading("directions", 0);
    expect(state().draft.directions[0]).toMatchObject({ heading: true, headingByHand: true });
    session.setBox("directions", "Brown the pork well\nAdd chiles");
    expect(state().draft.directions[0]?.heading).toBe(true);
  });
});

describe("problems", () => {
  it("hold back only the field with the problem", async () => {
    const { session, saves, state } = setUp(existing());
    session.set({ source: { ...existing().source, url: "not a web address" }, notes: "Spicy" });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves).toEqual([expect.objectContaining({ fields: { notes: "Spicy" } })]);
    expect(state().save).toBe("problems");
    expect(state().issues).toEqual([{ path: "source.url", problem: "invalid" }]);

    session.set({ source: { ...existing().source, url: "https://example.com/stew" } });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves[1]?.fields.source?.url).toBe("https://example.com/stew");
    expect(state().save).toBe("saved");
  });
});

describe("undo and redo", () => {
  it("go back and forward one save at a time", async () => {
    const { session, saves, state } = setUp(existing());
    session.set({ title: "Pork stew" });
    await vi.advanceTimersByTimeAsync(200);
    session.setBox("ingredients", "2 lb pork");
    await vi.advanceTimersByTimeAsync(200);

    await session.undo();
    expect(state().draft.ingredients).toEqual([]);
    expect(state().boxes.ingredients).toBe("");
    expect(state().draft.title).toBe("Pork stew");
    expect(saves.at(-1)?.fields).toEqual({ ingredients: [] });

    await session.undo();
    expect(state().draft.title).toBe("Stew");
    expect(state().canUndo).toBe(false);

    await session.redo();
    expect(state().draft.title).toBe("Pork stew");
    await session.redo();
    expect(state().boxes.ingredients).toBe("2 lb pork");
    expect(state().canRedo).toBe(false);
  });

  it("saves typing first, so it can be undone too", async () => {
    const { session, state } = setUp(existing());
    session.set({ notes: "Hot and sour" });
    expect(state().canUndo).toBe(true);
    await session.undo();
    expect(state().draft.notes).toBe("Hot");
  });

  it("a new edit clears redo", async () => {
    const { session, state } = setUp(existing());
    session.set({ title: "A" });
    await session.flush();
    await session.undo();
    expect(state().canRedo).toBe(true);
    session.set({ notes: "B" });
    await session.flush();
    expect(state().canRedo).toBe(false);
  });

  it("go back through a step split on its own, apart from the typing before it (U27)", async () => {
    const { session, saves, state } = setUp(existing());
    session.setBox("directions", "Mix well. Bake.");
    // Enter in the middle of the step, before the typing has saved.
    session.setBoxApart("directions", "Mix well.\nBake.");
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toHaveLength(2);
    expect(state().draft.directions.map((l) => l.text)).toEqual(["Mix well.", "Bake."]);
    await session.undo();
    expect(state().boxes.directions).toBe("Mix well. Bake.");
    await session.undo();
    expect(state().boxes.directions).toBe("");
    await session.redo();
    await session.redo();
    expect(state().boxes.directions).toBe("Mix well.\nBake.");
  });
});

describe("changes from elsewhere", () => {
  it("fill fields not being edited here, and leave typing alone", async () => {
    const { session, saves, state } = setUp(existing());
    session.set({ title: "Stew, typed here" });
    session.receive({ ...existing(), title: "Stew from the phone", notes: "Cold" });
    expect(state().draft.title).toBe("Stew, typed here");
    expect(state().draft.notes).toBe("Cold");
    await vi.advanceTimersByTimeAsync(200);
    // Only the field typed here is sent; the other device's notes aren't sent back.
    expect(saves).toEqual([expect.objectContaining({ fields: { title: "Stew, typed here" } })]);
  });

  it("that arrive while a save is going aren't sent back by the save after it (U27)", async () => {
    const sent: RecipeChange[] = [];
    let release: (() => void) | null = null;
    let fail = false;
    const make = () =>
      new EditorSession({
        id: ID,
        initial: existing(),
        delayMs: 100,
        save: async (change) => {
          sent.push(change);
          if (sent.length === 1) {
            await new Promise<void>((resolve) => (release = resolve));
            if (fail) throw new Error("Refused");
          }
        },
      });

    for (const failFirst of [false, true]) {
      sent.length = 0;
      fail = failFirst;
      const session = make();
      session.setBox("directions", "Mix well");
      // Enter: the typing saves, then the split, queued behind it.
      session.setBoxApart("directions", "Mix well\nBake");
      await vi.advanceTimersByTimeAsync(0);
      session.receive({ ...existing(), notes: "Cold, from the phone" });
      release!();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.every((change) => !("notes" in change.fields))).toBe(true);
      expect(session.getSnapshot().draft.notes).toBe("Cold, from the phone");
      await vi.advanceTimersByTimeAsync(6000);
      expect(sent.every((change) => !("notes" in change.fields))).toBe(true);
      expect(session.getSnapshot().save).toBe("saved");
      expect(session.getSnapshot().boxes.directions).toBe("Mix well\nBake");
    }
  });

  it("refresh the text boxes", () => {
    const { session, state } = setUp(existing());
    const ingredients = [{ id: ID, text: "3 limes", heading: false }];
    session.receive({ ...existing(), ingredients });
    expect(state().boxes.ingredients).toBe("3 limes");
  });
});

describe("when editing is paused", () => {
  it("waits, then saves when it's back", async () => {
    const { session, saves, state, refuse } = setUp(existing());
    session.setEditable(false);
    session.set({ notes: "Later" });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves).toHaveLength(0);
    expect(state().save).toBe("paused");
    session.setEditable(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(saves).toHaveLength(1);
    expect(state().save).toBe("saved");

    // Refused by the engine (the connection dropped just now): tried again.
    refuse(true);
    session.set({ notes: "Later still" });
    await vi.advanceTimersByTimeAsync(200);
    expect(state().save).toBe("failed");
    refuse(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves).toHaveLength(2);
    expect(state().save).toBe("saved");
  });
});

describe("the plan's per-recipe size (phase C11)", () => {
  it("holds back a recipe that grows past it, and saves once it's shorter", async () => {
    const { session, saves, state } = setUp(existing());
    session.setMaxBytes(600);
    session.set({ notes: "x".repeat(700) });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves).toHaveLength(0);
    expect(state()).toMatchObject({ save: "too_large", tooLarge: true });

    session.set({ notes: "x".repeat(100) });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves).toEqual([expect.objectContaining({ fields: { notes: "x".repeat(100) } })]);
    expect(state()).toMatchObject({ save: "saved", tooLarge: false });
  });

  it("lets a recipe already over it shrink, and saves held changes when the limit goes up", async () => {
    const big = { ...existing(), notes: "y".repeat(2000) };
    const { session, saves, state } = setUp(big);
    session.setMaxBytes(1000);
    session.set({ notes: "y".repeat(1500) });
    await vi.advanceTimersByTimeAsync(200);
    expect(saves).toHaveLength(1);

    session.set({ notes: "y".repeat(1800) });
    await vi.advanceTimersByTimeAsync(200);
    expect(state().save).toBe("too_large");
    session.setMaxBytes(null);
    await vi.advanceTimersByTimeAsync(200);
    expect(saves).toHaveLength(2);
    expect(state().save).toBe("saved");
  });
});

// --- Draft mode (U27 part 3) ---------------------------------------------------------------------

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const photo = (n: number, hash = HASH_A) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  imageHash: hash,
  width: 400,
  height: 300,
  takenAt: null,
});

function draftSetUp(
  saved: SavedState | null,
  existingDraft: { data: DraftData; startedAt: number } | null = null,
) {
  const kept: (DraftWrite | null)[] = [];
  let refuse = false;
  let clock = 1_700_000_000_000;
  const session = new EditorSession({
    id: ID,
    initial: null,
    delayMs: 100,
    now: () => (clock += 1000),
    draft: {
      saved,
      existing: existingDraft,
      keep: async (write) => {
        if (refuse) throw new Error("Editing is paused.");
        kept.push(write);
      },
    },
  });
  return {
    session,
    kept,
    last: () => kept[kept.length - 1],
    state: () => session.getSnapshot(),
    drafting: () => session.getSnapshot().drafting!,
    refuse: (value: boolean) => {
      refuse = value;
    },
  };
}

const savedStew = (): SavedState => ({
  content: existing(),
  photos: [photo(1)],
  categories: [["Dinner"]],
});

describe("draft mode", () => {
  it("keeps what's typed as a draft, never as a change, with the saved value it started from", async () => {
    const { session, kept, last, drafting } = draftSetUp(savedStew());
    expect(drafting()).toMatchObject({ save: "unchanged", parts: [], isNew: false });
    session.set({ notes: "Very hot" });
    expect(drafting().save).toBe("saving");
    await vi.advanceTimersByTimeAsync(200);
    expect(kept).toHaveLength(1);
    expect(last()?.data).toMatchObject({
      fields: { notes: "Very hot" },
      base: { notes: "Hot" },
      photos: null,
      categories: null,
    });
    expect(drafting()).toMatchObject({ save: "kept", parts: ["Notes"] });

    // Typing again keeps the first base and the first start.
    const startedAt = last()?.startedAt;
    session.set({ title: "Stew 2" });
    await vi.advanceTimersByTimeAsync(200);
    expect(last()?.data.base).toEqual({ notes: "Hot", title: "Stew" });
    expect(last()?.startedAt).toBe(startedAt);
    expect(drafting().parts).toEqual(["Title", "Notes"]);
  });

  it("never keeps a new recipe with nothing in it, and drops one emptied again", async () => {
    const { session, kept, drafting } = draftSetUp(null);
    session.set({ title: "   " });
    await vi.advanceTimersByTimeAsync(200);
    expect(kept).toHaveLength(0);
    expect(drafting()).toMatchObject({ save: "unchanged", isNew: true });

    // Ingredients with no title: kept (photos and categories don't need a title either).
    session.setBox("ingredients", "2 cups flour");
    await vi.advanceTimersByTimeAsync(200);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.data.fields.title).toBe("   ");

    session.setBox("ingredients", "");
    await vi.advanceTimersByTimeAsync(200);
    expect(kept).toEqual([expect.anything(), null]);
    expect(drafting().save).toBe("unchanged");
  });

  it("drops a saved recipe's draft that is back to the recipe", async () => {
    const { session, kept } = draftSetUp(savedStew());
    session.set({ notes: "Mild" });
    await vi.advanceTimersByTimeAsync(200);
    session.set({ notes: "Hot" });
    await vi.advanceTimersByTimeAsync(200);
    expect(kept).toEqual([expect.anything(), null]);
  });

  it("follows the recipe box for untouched parts, and keeps what's typed", async () => {
    const { session, drafting, state, last } = draftSetUp(savedStew());
    session.set({ notes: "Mine" });
    await vi.advanceTimersByTimeAsync(200);
    session.receiveSaved({
      content: { ...existing(), title: "Stew from Sarah", notes: "Sarah's" },
      photos: [photo(1), photo(2, HASH_B)],
      categories: [["Dinner"], ["Soups"]],
    });
    expect(state().draft).toMatchObject({ title: "Stew from Sarah", notes: "Mine" });
    expect(drafting().photos).toHaveLength(2);
    expect(drafting().categories).toEqual([["Dinner"], ["Soups"]]);
    expect(drafting().parts).toEqual(["Notes"]);
    // The base stays what the draft started from, so Done can tell Sarah changed it too.
    expect(last()?.data.base).toEqual({ notes: "Hot" });
    expect(state().canUndo).toBe(true);
  });

  it("drops the draft when the same change arrives from elsewhere", async () => {
    const { session, kept, drafting } = draftSetUp(savedStew());
    session.set({ notes: "Very hot" });
    await vi.advanceTimersByTimeAsync(200);
    session.receiveSaved({ ...savedStew(), content: { ...existing(), notes: "Very hot" } });
    await vi.advanceTimersByTimeAsync(10);
    expect(kept).toEqual([expect.anything(), null]);
    expect(drafting().save).toBe("unchanged");
  });

  it("carries a category renamed elsewhere, keeping what the draft added", async () => {
    const { session, last, drafting } = draftSetUp(savedStew());
    session.setCategories([["Dinner"], ["Quick"]]);
    await vi.advanceTimersByTimeAsync(0);
    // "Dinner" renamed "Suppers" on the Categories page meanwhile.
    session.receiveSaved({ ...savedStew(), categories: [["Suppers"]] });
    expect(drafting().categories).toEqual([["Suppers"], ["Quick"]]);
    await vi.advanceTimersByTimeAsync(10);
    expect(last()?.data).toMatchObject({
      categories: [["Suppers"], ["Quick"]],
      baseCategories: ["suppers"],
    });
  });

  it("keeps photos and categories, and undoes them with the words", async () => {
    const { session, last, drafting, state } = draftSetUp(savedStew());
    session.addPhoto(photo(2, HASH_B));
    await vi.advanceTimersByTimeAsync(0);
    expect(last()?.data).toMatchObject({
      photos: [photo(1), photo(2, HASH_B)],
      basePhotos: [photo(1).id],
      photosArranged: false,
    });
    session.setPhotos([photo(2, HASH_B), photo(1)], true);
    await vi.advanceTimersByTimeAsync(0);
    expect(last()?.data.photosArranged).toBe(true);
    session.setCategories([["Dinner"], ["Quick"]]);
    await vi.advanceTimersByTimeAsync(0);
    expect(last()?.data).toMatchObject({
      categories: [["Dinner"], ["Quick"]],
      baseCategories: ["dinner"],
    });
    expect(drafting().parts).toEqual(["Photos", "Categories"]);

    await session.undo();
    expect(drafting().categories).toEqual([["Dinner"]]);
    await session.undo();
    expect(drafting().photos.map((p) => p.id)).toEqual([photo(1).id, photo(2).id]);
    await session.undo();
    expect(drafting().photos).toEqual([photo(1)]);
    expect(last()).toBeNull();
    expect(state().canUndo).toBe(false);
    await session.redo();
    expect(drafting().photos).toHaveLength(2);
    expect(last()?.data.photos).toHaveLength(2);
  });

  it("carries on a draft kept earlier", async () => {
    const { session, state, drafting, kept } = draftSetUp(savedStew(), {
      data: {
        fields: { notes: "From the phone" },
        base: { notes: "Hot" },
        photos: null,
        basePhotos: null,
        photosArranged: false,
        categories: null,
        baseCategories: null,
      },
      startedAt: 5,
    });
    expect(state().draft.notes).toBe("From the phone");
    expect(drafting()).toMatchObject({ save: "kept", parts: ["Notes"] });
    session.set({ title: "Stew!" });
    await vi.advanceTimersByTimeAsync(200);
    expect(kept[0]).toMatchObject({
      startedAt: 5,
      data: { base: { notes: "Hot", title: "Stew" } },
    });
  });

  it("discards: back to the saved recipe, the draft removed, undo forgotten", async () => {
    const { session, kept, state, drafting } = draftSetUp(savedStew());
    session.set({ notes: "Mild" });
    session.setCategories([]);
    await vi.advanceTimersByTimeAsync(200);
    await session.discard();
    expect(kept[kept.length - 1]).toBeNull();
    expect(state().draft.notes).toBe("Hot");
    expect(drafting()).toMatchObject({ save: "unchanged", categories: [["Dinner"]] });
    expect(state().canUndo).toBe(false);
  });

  it("waits while editing is paused, then keeps it; nothing after close", async () => {
    const { session, kept, drafting, refuse } = draftSetUp(savedStew());
    refuse(true);
    session.set({ notes: "Offline" });
    await vi.advanceTimersByTimeAsync(200);
    expect(drafting().save).toBe("failed");
    session.setEditable(false);
    expect(drafting().save).toBe("paused");
    refuse(false);
    session.setEditable(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(kept).toHaveLength(1);
    expect(drafting().save).toBe("kept");

    session.close();
    session.set({ notes: "After Done" });
    await session.flush();
    expect(kept).toHaveLength(1);
  });
});
