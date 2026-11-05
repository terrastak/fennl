import { describe, expect, it } from "vitest";
import type { RecipeSummary } from "../sync/dbProtocol";
import { NO_FILTERS, UNFILED, type RecipeFilters } from "./filters";
import {
  libraryCounts,
  listTitle,
  pickAll,
  pickCategory,
  pickedList,
  pickMadeLately,
  shownSentence,
  toggleFavorites,
  toggleQuick,
} from "./library";

const TODAY = "2026-11-04";

function recipe(id: string, over: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id,
    title: id,
    ownerUserId: "me",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    totalMinutes: null,
    categories: [],
    addedBy: null,
    waiting: false,
    myRating: null,
    favorite: false,
    cover: null,
    prepMinutes: null,
    cookMinutes: null,
    servings: null,
    sourceName: null,
    hasNutrition: false,
    lastMadeOn: null,
    ...over,
  };
}

const f = (over: Partial<RecipeFilters> = {}): RecipeFilters => ({ ...NO_FILTERS, ...over });
const nameOf = (key: string) => (key === "dessert" ? "Dessert" : key);

describe("picking a list", () => {
  it("is all recipes, made lately or a category, one at a time", () => {
    expect(pickedList(f())).toEqual({ kind: "all" });
    expect(pickedList(f({ made: "recent" }))).toEqual({ kind: "made" });
    expect(pickedList(f({ category: "dessert", made: "recent" }))).toEqual({
      kind: "category",
      key: "dessert",
    });
  });

  it("keeps the search's switches when switching lists", () => {
    const on = f({ rating: "favorite", maxMinutes: 30, category: "bread", alsoIn: ["soup"] });
    expect(pickCategory(on, "dessert")).toMatchObject({
      category: "dessert",
      rating: "favorite",
      maxMinutes: 30,
      alsoIn: ["soup"],
    });
    expect(pickAll(on)).toMatchObject({ category: "", alsoIn: [], rating: "favorite" });
    expect(pickMadeLately(on)).toMatchObject({ category: "", made: "recent", maxMinutes: 30 });
    // A category replaces Made lately, but not "never made" from More filters.
    expect(pickCategory(f({ made: "recent" }), "dessert").made).toBe("");
    expect(pickCategory(f({ made: "never" }), "dessert").made).toBe("never");
  });

  it("turns the switches on and off", () => {
    expect(toggleFavorites(f()).rating).toBe("favorite");
    expect(toggleFavorites(f({ rating: "favorite" })).rating).toBe("");
    expect(toggleFavorites(f({ rating: "4" })).rating).toBe("favorite");
    expect(toggleQuick(f()).maxMinutes).toBe(30);
    expect(toggleQuick(f({ maxMinutes: 30 })).maxMinutes).toBe(null);
    expect(toggleQuick(f({ maxMinutes: 60 })).maxMinutes).toBe(30);
  });
});

describe("counts", () => {
  const list = [
    recipe("curd", { categories: ["Dessert"], totalMinutes: 25, lastMadeOn: "2026-11-01" }),
    recipe("cake", { categories: ["Dessert › Cakes"], totalMinutes: 10, favorite: true }),
    recipe("bars", { categories: ["Bars", "Dessert › Cakes"], totalMinutes: 90 }),
    recipe("soup", { categories: ["Soup"], totalMinutes: 20, lastMadeOn: "2026-08-01" }),
  ];

  it("counts every category with what is inside it, once a recipe", () => {
    const counts = libraryCounts(list, f(), {}, TODAY, null);
    expect(counts?.all).toBe(4);
    expect(counts?.made).toBe(1);
    expect(counts?.favorites).toBe(1);
    expect(counts?.quick).toBe(3);
    expect(counts?.unfiled).toBe(0);
    expect(Object.fromEntries(counts?.byKey ?? [])).toEqual({
      dessert: 3,
      "dessert › cakes": 2,
      bars: 1,
      soup: 1,
    });
  });

  it("follows the search and the switches, never what is picked", () => {
    const counts = libraryCounts(
      list,
      f({ category: "soup", maxMinutes: 30 }),
      {},
      TODAY,
      new Set(["curd", "cake", "bars", "soup"]),
    );
    // Picked: Soup. All recipes counts every category's quick recipes.
    expect(counts?.all).toBe(3);
    expect(counts?.byKey.get("dessert")).toBe(2);
    expect(counts?.byKey.get("bars")).toBeUndefined();
    // The switches count what the list would show, in Soup.
    expect(counts?.favorites).toBe(0);
    expect(counts?.quick).toBe(1);

    const searched = libraryCounts(list, f(), {}, TODAY, new Set(["cake"]));
    expect(searched?.all).toBe(1);
    expect(searched?.byKey.get("dessert")).toBe(1);
    expect(searched?.byKey.get("soup")).toBeUndefined();
  });

  it("waits for the ingredient answers", () => {
    expect(libraryCounts(list, f({ with: ["egg"] }), null, TODAY, null)).toBeNull();
  });
});

describe("what the list says it shows", () => {
  it("names the list", () => {
    expect(listTitle(f(), nameOf)).toBe("All recipes");
    expect(listTitle(f({ made: "recent" }), nameOf)).toBe("Made lately");
    expect(listTitle(f({ category: "dessert" }), nameOf)).toBe("Dessert");
    expect(listTitle(f({ category: UNFILED }), nameOf)).toBe("Not in a category");
  });

  it("says the words searched for and what else narrows it, never ending on a dot", () => {
    expect(shownSentence(12, "", f(), nameOf)).toBeNull();
    expect(shownSentence(12, "", f({ category: "dessert" }), nameOf)).toBeNull();
    expect(shownSentence(6, " lemon ", f({ category: "dessert", maxMinutes: 30 }), nameOf)).toBe(
      "6 recipes match “lemon” · 30 minutes or less",
    );
    expect(shownSentence(1, "lemon", f(), nameOf)).toBe("1 recipe matches “lemon”");
    expect(shownSentence(4, "", f({ rating: "favorite", without: ["mushroom"] }), nameOf)).toBe(
      "4 recipes · Favorites · Without mushroom",
    );
    expect(shownSentence(2, "", f({ made: "recent", maxMinutes: 60 }), nameOf)).toBe(
      "2 recipes · Up to 1 hour",
    );
  });
});
