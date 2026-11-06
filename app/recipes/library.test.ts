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
  countLineParts,
  countLineText,
  nextFreeName,
  showingEverything,
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
    // The "All recipes" row counts every recipe, whatever is searched.
    expect(searched?.total).toBe(list.length);
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

  it("counts each category as clicking it would show it, with Filters' also in", () => {
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

  it("counts in words, then the words searched for and what else narrows it (U20)", () => {
    const line = (n: number, q: string, filters: RecipeFilters) =>
      countLineText(n, countLineParts(q, filters, nameOf));
    expect(line(12, "", f())).toBe("12 recipes");
    expect(line(1, "", f())).toBe("1 recipe");
    // The category is the heading, so it isn't said again.
    expect(line(12, "", f({ category: "dessert" }))).toBe("12 recipes");
    expect(line(6, " lemon ", f({ category: "dessert", maxMinutes: 30 }))).toBe(
      "6 recipes · matching “lemon” · 30 minutes or less",
    );
    expect(line(1, "lemon", f())).toBe("1 recipe · matching “lemon”");
    expect(line(0, "zzz", f())).toBe("0 recipes · matching “zzz”");
    expect(line(4, "", f({ rating: "favorite", without: ["mushroom"] }))).toBe(
      "4 recipes · Favorites · Without mushroom",
    );
    // Choices a tick line can hold are said as the line says them.
    expect(line(2, "", f({ made: "recent", maxMinutes: 60 }))).toBe(
      "2 recipes · 1 hour or less · Made lately",
    );
    expect(line(2, "", f({ rating: "4", maxMinutes: 25, minServings: 6 }))).toBe(
      "2 recipes · 4 stars and up · Up to 25 minutes · Serves 6 or more",
    );
    expect(countLineParts("", f(), nameOf).length).toBe(0);
  });
});

describe("a saved search changed since it was chosen (U20)", () => {
  const saved = { q: "lemon", filters: f({ maxMinutes: 30 }) };

  it("marks nothing while the list is the saved search", () => {
    const parts = countLineParts("lemon", f({ maxMinutes: 30 }), nameOf, saved);
    expect(parts).toEqual([
      { text: "matching “lemon”", added: false },
      { text: "30 minutes or less", added: false },
    ]);
  });

  it("marks what was added, and simply leaves out what was taken off", () => {
    expect(
      countLineParts("lemon", f({ maxMinutes: 30, rating: "favorite" }), nameOf, saved),
    ).toEqual([
      { text: "matching “lemon”", added: false },
      { text: "30 minutes or less", added: false },
      { text: "Favorites", added: true },
    ]);
    // Without words, what was added still comes after what the search had.
    expect(
      countLineText(
        2,
        countLineParts("", f({ maxMinutes: 30, rating: "favorite" }), nameOf, {
          q: "",
          filters: f({ maxMinutes: 30 }),
        }),
      ),
    ).toBe("2 recipes · 30 minutes or less · Favorites (added)");
    expect(countLineParts("lemon", f(), nameOf, saved)).toEqual([
      { text: "matching “lemon”", added: false },
    ]);
    // A different time is a change: the new one is marked.
    expect(countLineParts("lemon", f({ maxMinutes: 60 }), nameOf, saved)).toEqual([
      { text: "matching “lemon”", added: false },
      { text: "1 hour or less", added: true },
    ]);
    expect(
      countLineText(1, countLineParts("lemon", f({ maxMinutes: 30, photo: true }), nameOf, saved)),
    ).toBe("1 recipe · matching “lemon” · 30 minutes or less · Has a photo (added)");
  });

  it("marks changed words, ignoring case and spaces", () => {
    expect(countLineParts(" Lemon ", f({ maxMinutes: 30 }), nameOf, saved)[0]).toEqual({
      text: "matching “Lemon”",
      added: false,
    });
    expect(countLineParts("lime", f({ maxMinutes: 30 }), nameOf, saved)[0]).toEqual({
      text: "matching “lime”",
      added: true,
    });
    // Words typed where the saved search had none.
    expect(countLineParts("cake", f(), nameOf, { q: "", filters: f() })[0]).toEqual({
      text: "matching “cake”",
      added: true,
    });
  });

  it("says the category, since the heading names the search", () => {
    const inDessert = { q: "", filters: f({ category: "dessert" }) };
    expect(countLineParts("", f({ category: "dessert" }), nameOf, inDessert)).toEqual([
      { text: "in Dessert", added: false },
    ]);
    expect(countLineParts("", f({ category: UNFILED }), nameOf, inDessert)).toEqual([
      { text: "not in a category", added: true },
    ]);
  });
});

describe("a name for Save new quick search (U21)", () => {
  it("adds the first free number", () => {
    expect(nextFreeName("Quick", ["Quick"], 60)).toBe("Quick 2");
    expect(nextFreeName("Quick", ["Quick", "quick 2", "Quick 3"], 60)).toBe("Quick 4");
    expect(nextFreeName(" Quick ", [], 60)).toBe("Quick 2");
  });

  it("counts on from a number the name already ends in", () => {
    expect(nextFreeName("Quick 2", ["Quick", "Quick 2"], 60)).toBe("Quick 3");
    expect(nextFreeName("Quick 2", ["Quick 2", "Quick 3"], 60)).toBe("Quick 4");
    expect(nextFreeName("Quick 1", ["Quick 1"], 60)).toBe("Quick 2");
  });

  it("stays within the longest name allowed", () => {
    const long = "x".repeat(60);
    expect(nextFreeName(long, [long], 60)).toBe(`${"x".repeat(58)} 2`);
    expect(nextFreeName(long, [long], 60).length).toBe(60);
  });
});

describe("All recipes starts fresh (owner's choice 2026-11-05)", () => {
  it("is the list shown only with nothing searched, filtered or picked", () => {
    expect(showingEverything("", f())).toBe(true);
    expect(showingEverything("  ", f())).toBe(true);
    expect(showingEverything("cookie", f())).toBe(false);
    expect(showingEverything("", f({ maxMinutes: 30 }))).toBe(false);
    expect(showingEverything("", f({ rating: "favorite" }))).toBe(false);
    expect(showingEverything("", f({ category: "dessert" }))).toBe(false);
    expect(showingEverything("", f({ without: ["mushroom"] }))).toBe(false);
  });
});
