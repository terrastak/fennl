import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRecipeContent, type RecipeContent } from "../../shared/recipe";
import type { RecipeChange } from "../../shared/sync";
import { EditorSession } from "./editorSession";

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
