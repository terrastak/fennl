import { describe, expect, it } from "vitest";
import type { RecipeSummary } from "../sync/dbProtocol";
import {
  activeFilterCount,
  addDays,
  applyFilters,
  filterChips,
  filtersFromParams,
  filtersToParams,
  NO_FILTERS,
  recipeMinutes,
  UNFILED,
  type RecipeFilters,
} from "./filters";

const TODAY = "2026-10-20";

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

const withFilters = (over: Partial<RecipeFilters>): RecipeFilters => ({ ...NO_FILTERS, ...over });
const ids = (r: { recipes: RecipeSummary[] }) => r.recipes.map((x) => x.id);
const run = (
  list: RecipeSummary[],
  filters: Partial<RecipeFilters>,
  ingredients: Record<string, string[]> | null = {},
) => applyFilters(list, withFilters(filters), ingredients, TODAY);

describe("with no filters", () => {
  it("leaves every recipe, in order", () => {
    const list = [recipe("b"), recipe("a")];
    expect(ids(run(list, {}, null))).toEqual(["b", "a"]);
  });
});

describe("categories", () => {
  const soup = recipe("soup", { categories: ["Dinner › Soup", "Vegan"] });
  const stew = recipe("stew", { categories: ["Dinner › Soup"] });
  const cake = recipe("cake", { categories: ["Desserts › Cakes", "Vegan"] });
  const plain = recipe("plain");
  const list = [soup, stew, cake, plain];

  it("one category includes what is inside it", () => {
    expect(ids(run(list, { category: "dinner" }))).toEqual(["soup", "stew"]);
  });

  it("two categories need both ('Soup' and 'Vegan')", () => {
    expect(ids(run(list, { category: "dinner › soup", alsoIn: ["vegan"] }))).toEqual(["soup"]);
  });

  it("or either, when asked for any", () => {
    expect(
      ids(run(list, { category: "dinner › soup", alsoIn: ["vegan"], anyCategory: true })),
    ).toEqual(["soup", "stew", "cake"]);
  });

  it("'not in' leaves out recipes in a category", () => {
    expect(ids(run(list, { notIn: ["vegan"] }))).toEqual(["stew", "plain"]);
  });

  it("combines in and not in", () => {
    expect(ids(run(list, { category: "dinner", notIn: ["vegan"] }))).toEqual(["stew"]);
  });

  it("'not in a category' picks the unfiled", () => {
    expect(ids(run(list, { category: UNFILED }))).toEqual(["plain"]);
  });
});

describe("rating", () => {
  const list = [
    recipe("five", { myRating: 5 }),
    recipe("three", { myRating: 3 }),
    recipe("fav", { favorite: true }),
    recipe("none"),
  ];
  it("4 and up", () => expect(ids(run(list, { rating: "4" }))).toEqual(["five"]));
  it("3 and up", () => expect(ids(run(list, { rating: "3" }))).toEqual(["five", "three"]));
  it("favorites", () => expect(ids(run(list, { rating: "favorite" }))).toEqual(["fav"]));
  it("not rated yet", () => expect(ids(run(list, { rating: "none" }))).toEqual(["fav", "none"]));
});

describe("time", () => {
  const list = [
    recipe("quick", { totalMinutes: 20 }),
    recipe("slow", { totalMinutes: 120 }),
    recipe("sum", { prepMinutes: 10, cookMinutes: 15 }),
    recipe("prepOnly", { prepMinutes: 10 }),
    recipe("blank"),
  ];

  it("uses the total time, else prep plus cook when both are written", () => {
    expect(recipeMinutes(list[2] as RecipeSummary)).toBe(25);
    expect(recipeMinutes(list[3] as RecipeSummary)).toBeNull();
  });

  it("keeps recipes at or under the time", () => {
    expect(ids(run(list, { maxMinutes: 30 }))).toEqual(["quick", "sum"]);
    expect(ids(run(list, { maxMinutes: 20 }))).toEqual(["quick"]);
  });

  it("counts recipes left out only because no time is written down", () => {
    expect(run(list, { maxMinutes: 30 }).unknown.time).toBe(2);
  });

  it("doesn't count a recipe that fails another filter too", () => {
    const withCategory = [recipe("x", { categories: ["A"] }), recipe("y")];
    expect(run(withCategory, { maxMinutes: 30, category: "a" }).unknown.time).toBe(1);
    expect(run(withCategory, { maxMinutes: 30, category: "b" }).unknown.time).toBe(0);
  });
});

describe("servings", () => {
  const list = [recipe("two", { servings: 2 }), recipe("six", { servings: 6 }), recipe("blank")];
  it("serves at least", () => {
    expect(ids(run(list, { minServings: 4 }))).toEqual(["six"]);
    expect(run(list, { minServings: 4 }).unknown.servings).toBe(1);
  });
});

describe("recipes that say neither time nor servings", () => {
  it("are counted under both filters, and only when nothing else rules them out", () => {
    const list = [recipe("blank"), recipe("filed", { categories: ["A"] })];
    const result = run(list, { maxMinutes: 30, minServings: 4 });
    expect(result.recipes).toEqual([]);
    expect(result.unknown).toEqual({ time: 2, servings: 2 });
    expect(run(list, { maxMinutes: 30, minServings: 4, category: "a" }).unknown).toEqual({
      time: 1,
      servings: 1,
    });
  });
});

describe("photo, nutrition, source", () => {
  const cover = { hash: "h", width: 1, height: 1 };
  const list = [
    recipe("pic", { cover, hasNutrition: true, sourceName: "Smitten Kitchen" }),
    recipe("text", { sourceName: "Aunt June" }),
  ];
  it("has a photo", () => expect(ids(run(list, { photo: true }))).toEqual(["pic"]));
  it("has nutrition", () => expect(ids(run(list, { nutrition: true }))).toEqual(["pic"]));
  it("source contains, ignoring case", () => {
    expect(ids(run(list, { source: "june" }))).toEqual(["text"]);
    expect(ids(run(list, { source: "  KITCHEN " }))).toEqual(["pic"]);
    expect(ids(run(list, { source: "nobody" }))).toEqual([]);
  });
});

describe("last made", () => {
  const list = [
    recipe("never"),
    recipe("lastWeek", { lastMadeOn: addDays(TODAY, -7) }),
    recipe("edge30", { lastMadeOn: addDays(TODAY, -30) }),
    recipe("sixty", { lastMadeOn: addDays(TODAY, -60) }),
    recipe("ancient", { lastMadeOn: addDays(TODAY, -400) }),
  ];
  it("never made", () => expect(ids(run(list, { made: "never" }))).toEqual(["never"]));
  it("made in the last 30 days, counting day 30", () =>
    expect(ids(run(list, { made: "recent" }))).toEqual(["lastWeek", "edge30"]));
  it("not made in the last 90 days, counting never", () =>
    expect(ids(run(list, { made: "old" }))).toEqual(["never", "ancient"]));
});

describe("ingredients", () => {
  const list = [recipe("a"), recipe("b"), recipe("c")];
  const found = { mushroom: ["a", "b"], garlic: ["b", "c"] };

  it("with: has every word", () => {
    expect(ids(run(list, { with: ["mushroom"] }, found))).toEqual(["a", "b"]);
    expect(ids(run(list, { with: ["mushroom", "garlic"] }, found))).toEqual(["b"]);
  });

  it("without: has none of the words", () => {
    expect(ids(run(list, { without: ["mushroom"] }, found))).toEqual(["c"]);
    expect(ids(run(list, { with: ["garlic"], without: ["mushroom"] }, found))).toEqual(["c"]);
  });

  it("waits for the answer rather than showing everything", () => {
    const waiting = run(list, { without: ["mushroom"] }, null);
    expect(waiting.pending).toBe(true);
    expect(waiting.recipes).toEqual([]);
  });

  it("a word nothing has leaves 'without' alone and empties 'with'", () => {
    expect(ids(run(list, { without: ["kale"] }, { kale: [] }))).toEqual(["a", "b", "c"]);
    expect(ids(run(list, { with: ["kale"] }, { kale: [] }))).toEqual([]);
  });
});

describe("everything together", () => {
  it("'under 30 minutes, 4 stars and up, in Dinners, no mushrooms'", () => {
    const list = [
      recipe("match", { totalMinutes: 25, myRating: 5, categories: ["Dinners"] }),
      recipe("long", { totalMinutes: 90, myRating: 5, categories: ["Dinners"] }),
      recipe("low", { totalMinutes: 25, myRating: 2, categories: ["Dinners"] }),
      recipe("elsewhere", { totalMinutes: 25, myRating: 5, categories: ["Lunch"] }),
      recipe("mushroomy", { totalMinutes: 25, myRating: 5, categories: ["Dinners"] }),
    ];
    const result = run(
      list,
      { maxMinutes: 30, rating: "4", category: "dinners", without: ["mushroom"] },
      { mushroom: ["mushroomy"] },
    );
    expect(ids(result)).toEqual(["match"]);
  });
});

describe("the address", () => {
  const key = (path: string) => path.toLocaleLowerCase();
  const pathOf = (k: string) => ({ dinners: "Dinners", vegan: "Vegan" })[k];

  it("keeps the old addresses working (?category= and ?rating=)", () => {
    const f = filtersFromParams(new URLSearchParams("category=Desserts+%E2%80%BA+Cakes&rating=4"));
    expect(f.category).toBe(key("Desserts › Cakes"));
    expect(f.rating).toBe("4");
  });

  it("round-trips every filter", () => {
    const filters = withFilters({
      category: "dinners",
      alsoIn: ["vegan"],
      anyCategory: true,
      notIn: ["vegan"],
      rating: "favorite",
      maxMinutes: 45,
      minServings: 4,
      photo: true,
      nutrition: true,
      made: "old",
      source: "Aunt June",
      with: ["green onion"],
      without: ["mushroom", "kale"],
    });
    const params = filtersToParams("soup", filters, pathOf);
    expect(params.get("q")).toBe("soup");
    const back = filtersFromParams(new URLSearchParams(params.toString()));
    expect(back).toEqual({ ...filters, notIn: ["vegan"], alsoIn: ["vegan"] });
  });

  it("leaves out empty filters and categories that no longer exist", () => {
    expect(filtersToParams("", NO_FILTERS, pathOf).toString()).toBe("");
    const gone = withFilters({ category: "deleted", alsoIn: ["deleted"], notIn: ["deleted"] });
    expect(filtersToParams("", gone, pathOf).toString()).toBe("");
  });

  it("keeps 'not in a category'", () => {
    const params = filtersToParams("", withFilters({ category: UNFILED }), pathOf);
    expect(filtersFromParams(params).category).toBe(UNFILED);
  });

  it("ignores values it doesn't understand", () => {
    const f = filtersFromParams(
      new URLSearchParams("rating=9&time=7&serves=abc&made=sometimes&any=2&photo=yes"),
    );
    expect(f).toEqual(NO_FILTERS);
  });

  it("limits how many words and how long", () => {
    const many = Array.from({ length: 30 }, (_, i) => `with=w${i}`).join("&");
    expect(filtersFromParams(new URLSearchParams(many)).with).toHaveLength(10);
    const long = `with=${"x".repeat(200)}`;
    expect(filtersFromParams(new URLSearchParams(long)).with[0]).toHaveLength(40);
  });

  it("doesn't repeat a word that differs only in case", () => {
    const f = filtersFromParams(new URLSearchParams("with=Garlic&with=garlic"));
    expect(f.with).toEqual(["Garlic"]);
  });

  it("counts what is narrowing the list", () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount(withFilters({ category: "a", maxMinutes: 30, photo: true }))).toBe(3);
  });
});

describe("days", () => {
  it("adds across months and years", () => {
    expect(addDays("2026-10-20", -30)).toBe("2026-09-20");
    expect(addDays("2026-01-05", -10)).toBe("2025-12-26");
  });
});

describe("chips", () => {
  const nameOf = (key: string) => key.toUpperCase();
  const filters = withFilters({
    alsoIn: ["vegan"],
    notIn: ["dessert"],
    maxMinutes: 90,
    minServings: 4,
    made: "old",
    photo: true,
    source: " June ",
    with: ["garlic"],
    without: ["Mushroom"],
  });

  it("has one chip for each thing narrowing the list, except category and rating", () => {
    const chips = filterChips(withFilters({ category: "x", rating: "4" }), nameOf);
    expect(chips).toEqual([]);
    expect(filterChips(filters, nameOf).map((c) => c.label)).toEqual([
      "Also in VEGAN",
      "Not in DESSERT",
      "Up to 90 minutes",
      "Serves 4 or more",
      "Not made in the last 90 days",
      "Has a photo",
      "From June",
      "With garlic",
      "Without Mushroom",
    ]);
  });

  it("says 'Or in' when any category will do", () => {
    const [chip] = filterChips(withFilters({ alsoIn: ["vegan"], anyCategory: true }), nameOf);
    expect(chip?.label).toBe("Or in VEGAN");
  });

  it("removing each chip leaves only that filter off", () => {
    for (const chip of filterChips(filters, nameOf)) {
      const left = filterChips(chip.remove(filters), nameOf).map((c) => c.id);
      const before = filterChips(filters, nameOf).map((c) => c.id);
      expect(left).toEqual(before.filter((id) => id !== chip.id));
    }
  });

  it("says hours in whole hours", () => {
    const [chip] = filterChips(withFilters({ maxMinutes: 120 }), nameOf);
    expect(chip?.label).toBe("Up to 2 hours");
  });
});
