import { describe, expect, it } from "vitest";
import {
  barChips,
  barFiltersOn,
  clearBarFilters,
  countLines,
  layoutBar,
  removeChip,
  unsetGroups,
  type BarMeasure,
} from "./filterBar";
import { NO_FILTERS, type RecipeFilters } from "./filters";

const f = (over: Partial<RecipeFilters>): RecipeFilters => ({ ...NO_FILTERS, ...over });
const pathOf = (key: string) =>
  ({ mexican: "Mexican", soup: "Soup", "desserts › cakes": "Desserts › Cakes" })[key] ?? key;

describe("barChips", () => {
  it("is empty with nothing set beyond the category", () => {
    expect(barChips(f({ category: "mexican" }), pathOf)).toEqual([]);
  });

  it("gives one chip per thing set, in the groups' order, with its words", () => {
    const chips = barChips(
      f({
        photo: true,
        with: ["Demerara brown sugar"],
        without: ["fresh cilantro", "mushrooms"],
        made: "old",
        maxMinutes: 45,
        rating: "4",
        minServings: 6,
        alsoIn: ["mexican", "soup"],
        anyCategory: true,
        notIn: ["desserts › cakes"],
        source: " Nana ",
        nutrition: true,
      }),
      pathOf,
    );
    expect(chips.map((c) => [c.key, c.group, c.lead, c.value])).toEqual([
      ["time", "time", "", "45 min or less"],
      ["rating", "rating", "", "4 stars and up"],
      ["made", "made", "", "Not made in the last 90 days"],
      ["serves", "serves", "", "Serves 6 or more"],
      ["with:demerara brown sugar", "ingredients", "With", "Demerara brown sugar"],
      ["without:fresh cilantro", "ingredients", "Without", "fresh cilantro"],
      ["without:mushrooms", "ingredients", "Without", "mushrooms"],
      ["also", "categories", "Also in", "Mexican or Soup"],
      ["notin", "categories", "Not in", "Desserts › Cakes"],
      ["source", "more", "From", "Nana"],
      ["photo", "more", "", "Has a photo"],
      ["nutrition", "more", "", "Has nutrition"],
    ]);
    expect(chips[4]!.text).toBe("With Demerara brown sugar");
    expect(chips[0]!.text).toBe("45 min or less");
    expect(chips.every((c) => !c.added)).toBe(true);
  });

  it("joins categories with “and” when a recipe must be in all of them", () => {
    const [chip] = barChips(f({ alsoIn: ["mexican", "soup"] }), pathOf);
    expect(chip!.text).toBe("Also in Mexican and Soup");
  });

  it("says times as the choices do, and favorites in words", () => {
    expect(barChips(f({ maxMinutes: 90 }), pathOf)[0]!.value).toBe("1½ hr or less");
    expect(barChips(f({ rating: "favorite" }), pathOf)[0]!.value).toBe("My favorites");
  });

  it("marks what a saved search doesn't have as added", () => {
    const saved = f({ maxMinutes: 45, with: ["Lime"] });
    const chips = barChips(
      f({ maxMinutes: 45, with: ["lime", "cumin"], rating: "favorite" }),
      pathOf,
      saved,
    );
    expect(chips.map((c) => [c.key, c.added])).toEqual([
      ["time", false],
      ["rating", true],
      ["with:lime", false],
      ["with:cumin", true],
    ]);
    // A changed choice counts as added too.
    expect(barChips(f({ maxMinutes: 30 }), pathOf, saved)[0]!.added).toBe(true);
  });
});

describe("removeChip", () => {
  const all = f({
    category: "mexican",
    maxMinutes: 30,
    rating: "5",
    made: "never",
    minServings: 4,
    with: ["Lime", "cumin"],
    without: ["nuts"],
    alsoIn: ["soup"],
    anyCategory: true,
    notIn: ["desserts › cakes"],
    source: "Nana",
    photo: true,
    nutrition: true,
  });

  it("takes away just that part", () => {
    expect(removeChip(all, "time").maxMinutes).toBeNull();
    expect(removeChip(all, "rating").rating).toBe("");
    expect(removeChip(all, "made").made).toBe("");
    expect(removeChip(all, "serves").minServings).toBeNull();
    expect(removeChip(all, "with:lime").with).toEqual(["cumin"]);
    expect(removeChip(all, "without:nuts").without).toEqual([]);
    expect(removeChip(all, "also")).toMatchObject({ alsoIn: [], anyCategory: false });
    expect(removeChip(all, "notin").notIn).toEqual([]);
    expect(removeChip(all, "source").source).toBe("");
    expect(removeChip(all, "photo").photo).toBe(false);
    expect(removeChip(all, "nutrition").nutrition).toBe(false);
    // The category and everything else stay.
    expect(removeChip(all, "with:lime")).toEqual({ ...all, with: ["cumin"] });
  });

  it("works with each chip barChips gives", () => {
    let left = all;
    for (const c of barChips(all, pathOf)) left = removeChip(left, c.key);
    expect(left).toEqual(clearBarFilters(all));
    expect(barFiltersOn(left)).toBe(false);
  });
});

describe("unsetGroups, barFiltersOn and clearBarFilters", () => {
  it("lists the groups with nothing set", () => {
    const chips = barChips(f({ maxMinutes: 30, photo: true, with: ["lime"] }), pathOf);
    expect(unsetGroups(chips, true)).toEqual(["rating", "made", "serves", "categories"]);
    expect(unsetGroups([], false)).toEqual([
      "time",
      "rating",
      "made",
      "serves",
      "ingredients",
      "more",
    ]);
  });

  it("shows the bar for anything beyond the category", () => {
    expect(barFiltersOn(f({ category: "mexican" }))).toBe(false);
    expect(barFiltersOn(f({ alsoIn: ["soup"] }))).toBe(true);
    expect(barFiltersOn(f({ source: "Nana" }))).toBe(true);
  });

  it("clears everything but the category", () => {
    expect(clearBarFilters(f({ category: "mexican", rating: "4", with: ["lime"] }))).toEqual(
      f({ category: "mexican" }),
    );
  });
});

describe("countLines", () => {
  it("wraps as flex wrap does", () => {
    expect(countLines([], 100, 8)).toBe(0);
    expect(countLines([40, 52], 100, 8)).toBe(1);
    expect(countLines([40, 53], 100, 8)).toBe(2);
    // One wider than the row has a line of its own.
    expect(countLines([30, 500, 30], 100, 8)).toBe(3);
  });
});

describe("layoutBar", () => {
  const measure = (over: Partial<BarMeasure>): BarMeasure => ({
    width: 1000,
    gap: 8,
    set: [],
    unset: [],
    add: 100,
    more: (n) => (n < 10 ? 80 : 90),
    ...over,
  });
  const set = (...widths: number[]) => widths.map((width, i) => ({ key: `c${i}`, width }));

  it("shows every group when nothing is set", () => {
    expect(layoutBar(measure({ unset: [70, 80, 90, 70, 100, 100, 60] }))).toEqual({
      folded: [],
      unset: "full",
      lines: 1,
    });
  });

  it("shows the groups not set in full when they add no line", () => {
    expect(layoutBar(measure({ set: set(200, 200), unset: [80, 80] }))).toMatchObject({
      unset: "full",
      lines: 1,
    });
    // Already two lines and they fit on the second: in full (the 1280 px picture).
    expect(layoutBar(measure({ set: set(300, 300, 300, 200), unset: [80, 80] }))).toMatchObject({
      unset: "full",
      lines: 2,
    });
  });

  it("folds them into + Add filter when that saves a line (the 1600 px picture)", () => {
    // 6 set chips fill most of one line; Rating and Serves would start a second.
    const layout = layoutBar(measure({ set: set(150, 150, 150, 150, 150, 50), unset: [80, 80] }));
    expect(layout).toEqual({ folded: [], unset: "folded", lines: 1 });
  });

  it("shows them in full when folding wouldn't save the line", () => {
    // The set chips leave no room even for + Add filter on the first line.
    const layout = layoutBar(measure({ set: set(495, 495), unset: [80, 80] }));
    expect(layout).toEqual({ folded: [], unset: "full", lines: 2 });
  });

  it("folds them when showing them would make a third line", () => {
    const layout = layoutBar(
      measure({ set: set(495, 495, 495, 300), unset: [300, 300, 300], add: 100 }),
    );
    expect(layout).toEqual({ folded: [], unset: "folded", lines: 2 });
  });

  it("never takes a third line: the last set chips fold into + N more", () => {
    const layout = layoutBar(
      measure({ width: 600, set: set(250, 250, 250, 250, 250, 250), unset: [80], add: 100 }),
    );
    expect(layout.lines).toBe(2);
    // Rating fits beside the last set chip, so it stays in full; then two chips a line, the
    // second with room for +3 more and Rating.
    expect(layout.unset).toBe("full");
    expect(layout.folded).toEqual(["c3", "c4", "c5"]);
  });

  it("folds the groups not set rather than more set chips (the 1024 px picture)", () => {
    const layout = layoutBar(
      measure({ width: 600, set: set(250, 250, 250, 250, 100), unset: [200, 200], add: 100 }),
    );
    // In full, Rating and Serves would push three set chips into +3 more; folded, only two.
    expect(layout).toEqual({ folded: ["c3", "c4"], unset: "folded", lines: 2 });
  });

  it("never folds the chip whose menu is open", () => {
    const layout = layoutBar(
      measure({ width: 600, set: set(250, 250, 250, 250, 250, 250), open: "c5" }),
    );
    expect(layout.folded).not.toContain("c5");
    expect(layout.lines).toBe(2);
    expect(layout.folded).toEqual(["c3", "c4"]);
  });
});
