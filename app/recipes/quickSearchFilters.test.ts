import { describe, expect, it } from "vitest";
import { quick, quickSearchKey } from "../../shared/quickSearches";
import type { RecipeSummary } from "../sync/dbProtocol";
import { NO_FILTERS, type RecipeFilters } from "./filters";
import {
  inQuickSearches,
  quickFilterOn,
  quickFiltersIn,
  quickSearchCounts,
  quickSearchWords,
  toggleQuickFilter,
  turnOffQuickFilter,
  turnOnQuickFilter,
} from "./quickSearchFilters";

// U18: what a quick search's tick line does to the recipe list's filters.

const TODAY = "2026-11-05";
const f = (over: Partial<RecipeFilters> = {}): RecipeFilters => ({ ...NO_FILTERS, ...over });

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

describe("a tick line on and off", () => {
  it("is on when the filters hold exactly its choice", () => {
    expect(quickFilterOn(quick.favorites, f({ rating: "favorite" }))).toBe(true);
    expect(quickFilterOn(quick.rating("4"), f({ rating: "favorite" }))).toBe(false);
    expect(quickFilterOn(quick.time(30), f({ maxMinutes: 30 }))).toBe(true);
    expect(quickFilterOn(quick.time(30), f({ maxMinutes: 45 }))).toBe(false);
    expect(quickFilterOn(quick.made("recent"), f({ made: "recent" }))).toBe(true);
    expect(quickFilterOn(quick.serves(6), f({ minServings: 6 }))).toBe(true);
    expect(quickFilterOn(quick.photo, f({ photo: true }))).toBe(true);
    expect(quickFilterOn(quick.nutrition, f())).toBe(false);
    expect(quickFilterOn(quick.with("lime"), f({ with: ["Lime"] }))).toBe(true);
    expect(quickFilterOn(quick.without("lime"), f({ with: ["Lime"] }))).toBe(false);
    expect(quickFilterOn(quick.source("Aunt June"), f({ source: "aunt june " }))).toBe(true);
  });

  it("turns on like a radio button for lines on the same part", () => {
    const on = turnOnQuickFilter(f({ rating: "favorite", maxMinutes: 30 }), quick.rating("4"));
    expect(on).toEqual(f({ rating: "4", maxMinutes: 30 }));
    expect(turnOnQuickFilter(f({ maxMinutes: 30 }), quick.time(60)).maxMinutes).toBe(60);
  });

  it("adds a word to the others, and takes it out of the opposite list", () => {
    const on = turnOnQuickFilter(f({ with: ["egg"], without: ["Lime"] }), quick.with("lime"));
    expect(on.with).toEqual(["egg", "lime"]);
    expect(on.without).toEqual([]);
    const again = turnOnQuickFilter(f({ with: ["Lime"] }), quick.with("lime"));
    expect(again.with).toEqual(["Lime"]);
  });

  it("turns off only its own part, and only when it is on", () => {
    const filters = f({ rating: "favorite", maxMinutes: 30, with: ["egg", "lime"], photo: true });
    expect(turnOffQuickFilter(filters, quick.favorites)).toEqual({ ...filters, rating: "" });
    expect(turnOffQuickFilter(filters, quick.rating("4"))).toBe(filters);
    expect(turnOffQuickFilter(filters, quick.time(45))).toBe(filters);
    expect(turnOffQuickFilter(filters, quick.time(30)).maxMinutes).toBeNull();
    expect(turnOffQuickFilter(filters, quick.with("LIME")).with).toEqual(["egg"]);
    expect(turnOffQuickFilter(filters, quick.photo).photo).toBe(false);
  });

  it("switches", () => {
    expect(toggleQuickFilter(f(), quick.photo).photo).toBe(true);
    expect(toggleQuickFilter(f({ photo: true }), quick.photo).photo).toBe(false);
    expect(toggleQuickFilter(f({ made: "never" }), quick.made("recent")).made).toBe("recent");
  });
});

describe("filters that could be added from Filters", () => {
  it("are every set filter but categories, as the lines they'd add", () => {
    const filters = f({
      category: "dessert",
      notIn: ["cakes"],
      rating: "favorite",
      maxMinutes: 45,
      made: "never",
      minServings: 4,
      photo: true,
      nutrition: true,
      source: "  Smitten   Kitchen ",
      with: ["lime"],
      without: ["mushroom", "olive"],
    });
    expect(quickFiltersIn(filters).map(quickSearchKey)).toEqual([
      "time:45",
      "favorites",
      "made:never",
      "serves:4",
      "photo",
      "nutrition",
      "source:smitten kitchen",
      "with:lime",
      "without:mushroom",
      "without:olive",
    ]);
    expect(quickFiltersIn(f({ rating: "3" })).map(quickSearchKey)).toEqual(["rating:3"]);
    expect(quickFiltersIn(f({ category: "dessert" }))).toEqual([]);
  });

  it("say whether they're already there", () => {
    const items = [quick.favorites, quick.without("Mushroom")];
    expect(inQuickSearches(items, quick.without("mushroom"))).toBe(true);
    expect(inQuickSearches(items, quick.with("mushroom"))).toBe(false);
  });
});

describe("counting each tick line", () => {
  const recipes = [
    recipe("a", { favorite: true, totalMinutes: 20, lastMadeOn: "2026-11-01" }),
    recipe("b", { favorite: true, totalMinutes: 50 }),
    recipe("c", { totalMinutes: 25, myRating: 4 }),
  ];

  it("is what the list would show with that line turned on", () => {
    const items = [quick.favorites, quick.time(30), quick.made("recent"), quick.search("s")];
    const counts = quickSearchCounts(items, recipes, f(), {}, TODAY, null);
    expect(counts).toEqual(
      new Map([
        ["favorites", 2],
        ["time:30", 2],
        ["made:recent", 1],
      ]),
    );
    // With Favorites on, 30 minutes or less counts favorites only.
    const on = quickSearchCounts(items, recipes, f({ rating: "favorite" }), {}, TODAY, null);
    expect(on?.get("time:30")).toBe(1);
    // A line on the same part shows what it would show instead.
    const rated = quickSearchCounts(
      [quick.rating("4")],
      recipes,
      f({ rating: "favorite" }),
      {},
      TODAY,
      null,
    );
    expect(rated?.get("rating:4")).toBe(1);
  });

  it("follows the words searched for", () => {
    const counts = quickSearchCounts([quick.favorites], recipes, f(), {}, TODAY, new Set(["b"]));
    expect(counts?.get("favorites")).toBe(1);
  });

  it("counts word lines once their words have answers", () => {
    const items = [quick.without("Lime"), quick.with("egg")];
    expect(quickSearchWords([...items, quick.with("lime"), quick.photo])).toEqual(["Lime", "egg"]);
    const counts = quickSearchCounts(items, recipes, f(), { lime: ["a"] }, TODAY, null);
    expect(counts).toEqual(new Map([["without:lime", 2]]));
  });

  it("waits for the ingredient answers the filters need", () => {
    expect(
      quickSearchCounts([quick.photo], recipes, f({ with: ["egg"] }), null, TODAY, null),
    ).toBeNull();
    expect(quickSearchCounts([quick.photo], recipes, f(), null, TODAY, null)?.get("photo")).toBe(0);
  });
});
