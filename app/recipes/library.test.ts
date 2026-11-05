import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_SEARCHES, quick } from "../../shared/quickSearches";
import type { RecipeSummary } from "../sync/dbProtocol";
import { NO_FILTERS, UNFILED, type RecipeFilters } from "./filters";
import {
  categoryCount,
  libraryCounts,
  listTitle,
  outsideCount,
  pickAll,
  pickCategory,
  pickedList,
  shownSentence,
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
  it("is all recipes or a category, one at a time", () => {
    expect(pickedList(f())).toEqual({ kind: "all" });
    // Made lately is a tick line now (U18), not a list.
    expect(pickedList(f({ made: "recent" }))).toEqual({ kind: "all" });
    expect(pickedList(f({ category: "dessert", made: "recent" }))).toEqual({
      kind: "category",
      key: "dessert",
    });
  });

  it("keeps the search's tick lines when switching lists", () => {
    const on = f({
      rating: "favorite",
      maxMinutes: 30,
      made: "recent",
      category: "bread",
      alsoIn: ["soup"],
    });
    expect(pickCategory(on, "dessert")).toMatchObject({
      category: "dessert",
      rating: "favorite",
      maxMinutes: 30,
      made: "recent",
      alsoIn: ["soup"],
    });
    expect(pickAll(on)).toMatchObject({
      category: "",
      alsoIn: [],
      rating: "favorite",
      made: "recent",
    });
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
    const items = [...DEFAULT_QUICK_SEARCHES, quick.made("recent"), quick.search("abc")];
    const counts = libraryCounts(list, f(), {}, TODAY, null, items);
    expect(counts?.all).toBe(4);
    // Each tick line, by its key; search lines aren't counted.
    expect(Object.fromEntries(counts?.quick ?? [])).toEqual({
      favorites: 1,
      "time:30": 3,
      "made:recent": 1,
    });
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
      DEFAULT_QUICK_SEARCHES,
    );
    // Picked: Soup. All recipes counts every category's quick recipes.
    expect(counts?.all).toBe(3);
    expect(counts?.byKey.get("dessert")).toBe(2);
    expect(counts?.byKey.get("bars")).toBeUndefined();
    // The tick lines count what the list would show, in Soup.
    expect(counts?.quick.get("favorites")).toBe(0);
    expect(counts?.quick.get("time:30")).toBe(1);

    const searched = libraryCounts(list, f(), {}, TODAY, new Set(["cake"]));
    expect(searched?.all).toBe(1);
    expect(searched?.byKey.get("dessert")).toBe(1);
    expect(searched?.byKey.get("soup")).toBeUndefined();
  });

  it("counts a tick line as turning it on would show it, in place of its own part", () => {
    // "Never made" from Filters gives way to Made lately when that is turned on.
    const items = [quick.made("recent"), quick.made("never")];
    const counts = libraryCounts(list, f({ made: "never" }), {}, TODAY, null, items);
    expect(counts?.quick.get("made:recent")).toBe(1);
    expect(counts?.quick.get("made:never")).toBe(2);
    expect(counts?.all).toBe(2);
  });

  it("counts what matches outside the category only when nothing else ties it to categories", () => {
    const words = new Set(["a", "b", "c"]);
    const three = [
      recipe("a", { categories: ["Breakfast"] }),
      recipe("b", { categories: ["Breakfast", "Mexican"] }),
      recipe("c", { categories: ["Soups"] }),
    ];
    const picked = f({ category: "breakfast" });
    const counts = libraryCounts(three, picked, {}, TODAY, words);
    expect(outsideCount(picked, counts?.all ?? 0, 2)).toBe(1);
    // "Also in Mexican" shows only b: All recipes would drop that filter too, so no number.
    const alsoIn = f({ category: "breakfast", alsoIn: ["mexican"] });
    const withAlso = libraryCounts(three, alsoIn, {}, TODAY, words);
    expect(outsideCount(alsoIn, withAlso?.all ?? 0, 1)).toBe(0);
    expect(outsideCount(f({ category: "breakfast", anyCategory: true }), 3, 1)).toBe(0);
    expect(outsideCount(f(), 3, 1)).toBe(0);
  });

  it("counts each category as clicking it would show it, with More filters' also in", () => {
    const four = [
      recipe("stew", { categories: ["Mexican", "Soups"] }),
      recipe("tacos", { categories: ["Mexican"] }),
      recipe("eggs", { categories: ["Breakfast"] }),
      recipe("broth", { categories: ["Soups"] }),
      recipe("plain"),
    ];
    // Mexican, also in Soups: the list shows the stew, and so does Mexican's count.
    const also = f({ category: "mexican", alsoIn: ["soups"] });
    const counts = libraryCounts(four, also, {}, TODAY, null);
    expect(counts && categoryCount(counts, "mexican")).toBe(1);
    expect(counts && categoryCount(counts, "breakfast")).toBe(0);
    expect(counts && categoryCount(counts, "soups")).toBe(2);
    expect(counts?.unfiled).toBe(0);
    // All recipes drops "also in", so it counts everything.
    expect(counts?.all).toBe(5);

    // In any of them: Breakfast or Soups gives the eggs and both soups.
    const any = f({ category: "mexican", alsoIn: ["soups"], anyCategory: true });
    const either = libraryCounts(four, any, {}, TODAY, null);
    expect(either && categoryCount(either, "breakfast")).toBe(3);
    expect(either && categoryCount(either, "mexican")).toBe(3);
    expect(either && categoryCount(either, "desserts")).toBe(2);
    expect(either?.unfiled).toBe(3);
  });

  it("waits for the ingredient answers", () => {
    expect(libraryCounts(list, f({ with: ["egg"] }), null, TODAY, null)).toBeNull();
  });
});

describe("what the list says it shows", () => {
  it("names the list", () => {
    expect(listTitle(f(), nameOf)).toBe("All recipes");
    expect(listTitle(f({ made: "recent" }), nameOf)).toBe("All recipes");
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
    // Choices a tick line can hold are said as the line says them.
    expect(shownSentence(2, "", f({ made: "recent", maxMinutes: 60 }), nameOf)).toBe(
      "2 recipes · 1 hour or less · Made lately",
    );
    expect(shownSentence(2, "", f({ rating: "4", maxMinutes: 25, minServings: 6 }), nameOf)).toBe(
      "2 recipes · 4 stars and up · Up to 25 minutes · Serves 6 or more",
    );
  });
});
