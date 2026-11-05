import { describe, expect, it } from "vitest";
import {
  addQuickSearch,
  DEFAULT_QUICK_SEARCHES,
  isQuickSearchItem,
  isQuickSearchList,
  MAX_QUICK_SEARCHES,
  mergeQuickSearches,
  moveQuickSearch,
  moveQuickSearchBefore,
  presetIndex,
  presetMatches,
  quick,
  QUICK_PRESETS,
  quickChoices,
  quickFilterLabel,
  quickSearchFull,
  quickSearchKey,
  readQuickSearches,
  removeQuickSearch,
  replaceQuickSearch,
  type QuickSearchItem,
} from "./quickSearches";
import { MAX_SAVED_SEARCHES } from "./savedSearch";

// U18: the left panel's quick searches, kept with the account.

const keys = (items: QuickSearchItem[]) => items.map(quickSearchKey);

describe("quick search lines", () => {
  it("start with Favorites and 30 minutes or less", () => {
    expect(keys(DEFAULT_QUICK_SEARCHES)).toEqual(["favorites", "time:30"]);
  });

  it("are named in plain words", () => {
    const cases: [QuickSearchItem, string][] = [
      [quick.favorites, "Favorites"],
      [quick.time(15), "15 minutes or less"],
      [quick.time(30), "30 minutes or less"],
      [quick.time(45), "45 minutes or less"],
      [quick.time(60), "1 hour or less"],
      [quick.time(90), "1½ hours or less"],
      [quick.time(120), "2 hours or less"],
      [quick.rating("5"), "5 stars"],
      [quick.rating("4"), "4 stars and up"],
      [quick.rating("3"), "3 stars and up"],
      [quick.rating("none"), "Not rated yet"],
      [quick.made("recent"), "Made lately"],
      [quick.made("never"), "Never made"],
      [quick.made("old"), "Not made in 90 days"],
      [quick.serves(6), "Serves 6 or more"],
      [quick.photo, "Has a photo"],
      [quick.nutrition, "Has nutrition"],
      [quick.with("lime"), "With lime"],
      [quick.without("mushroom"), "Without mushroom"],
      [quick.source("Smitten Kitchen"), "From Smitten Kitchen"],
    ];
    for (const [item, label] of cases) {
      if (item.type === "filter") expect(quickFilterLabel(item)).toBe(label);
    }
  });

  it("have a key that is the same for lines that are the same to a person", () => {
    expect(quickSearchKey(quick.with("Lime"))).toBe(quickSearchKey(quick.with("lime")));
    expect(quickSearchKey(quick.with("lime"))).not.toBe(quickSearchKey(quick.without("lime")));
    expect(quickSearchKey(quick.source("Smitten Kitchen"))).toBe("source:smitten kitchen");
    expect(quickSearchKey(quick.search("abc"))).toBe("search:abc");
    expect(quickSearchKey(quick.made("recent"))).not.toBe(quickSearchKey(quick.made("never")));
  });

  it("offer choices for the time, stars, last made and serves only", () => {
    expect(quickChoices(quick.time(30)).map(quickSearchKey)).toEqual([
      "time:15",
      "time:30",
      "time:45",
      "time:60",
      "time:90",
      "time:120",
    ]);
    expect(quickChoices(quick.rating("4")).map(quickSearchKey)).toEqual([
      "rating:5",
      "rating:4",
      "rating:3",
      "rating:none",
    ]);
    expect(quickChoices(quick.made("never")).map(quickSearchKey)).toEqual([
      "made:recent",
      "made:never",
      "made:old",
    ]);
    expect(quickChoices(quick.serves(4))).toHaveLength(5);
    for (const item of [quick.favorites, quick.photo, quick.with("lime"), quick.search("a")]) {
      expect(quickChoices(item)).toEqual([]);
    }
  });
});

describe("+ Add's common ones", () => {
  it("are the owner's seven, in order", () => {
    expect(QUICK_PRESETS.map((p) => quickFilterLabel(p))).toEqual([
      "Favorites",
      "30 minutes or less",
      "Made lately",
      "Never made",
      "4 stars and up",
      "Not rated yet",
      "Has a photo",
    ]);
  });

  it("are ticked by a time line of any time, and the others by the same choice", () => {
    expect(presetMatches(quick.time(30), quick.time(45))).toBe(true);
    expect(presetMatches(quick.rating("4"), quick.rating("5"))).toBe(false);
    expect(presetMatches(quick.made("recent"), quick.made("recent"))).toBe(true);
    expect(presetMatches(quick.favorites, quick.search("favorites"))).toBe(false);
    const items = [quick.photo, quick.time(90)];
    expect(presetIndex(quick.time(30), items)).toBe(1);
    expect(presetIndex(quick.favorites, items)).toBe(-1);
  });
});

describe("checking a list sent to the server", () => {
  it("takes well-formed lines", () => {
    expect(isQuickSearchList([])).toBe(true);
    expect(
      isQuickSearchList([
        ...DEFAULT_QUICK_SEARCHES,
        quick.rating("none"),
        quick.made("old"),
        quick.serves(12),
        quick.photo,
        quick.nutrition,
        quick.with("lime"),
        quick.without("lime"),
        quick.source("Aunt June"),
        quick.search("0b6c1a9e-5f2d-4c1e-9a7b-2d3e4f5a6b7c"),
      ]),
    ).toBe(true);
  });

  it("turns away anything else", () => {
    const bad: unknown[] = [
      { type: "filter", filter: "time", minutes: 31 },
      { type: "filter", filter: "time", minutes: "30" },
      { type: "filter", filter: "serves", value: 5 },
      { type: "filter", filter: "rating", value: "favorite" },
      { type: "filter", filter: "made", value: "lately" },
      { type: "filter", filter: "favorites", value: true },
      { type: "filter", filter: "with", word: "" },
      { type: "filter", filter: "with", word: " lime" },
      { type: "filter", filter: "with", word: "x".repeat(41) },
      { type: "filter", filter: "source", value: "y".repeat(81) },
      { type: "filter", filter: "category", value: "desserts" },
      { type: "search", id: "has spaces" },
      { type: "search", id: "z".repeat(65) },
      { type: "search" },
      "favorites",
      null,
      [],
    ];
    for (const item of bad) {
      expect(isQuickSearchItem(item)).toBe(false);
      expect(isQuickSearchList([item])).toBe(false);
    }
    expect(isQuickSearchList("[]")).toBe(false);
    expect(isQuickSearchList({})).toBe(false);
  });

  it("turns away a line twice and too many lines", () => {
    expect(isQuickSearchList([quick.favorites, quick.favorites])).toBe(false);
    expect(isQuickSearchList([quick.without("Mushroom"), quick.without("mushroom")])).toBe(false);
    expect(isQuickSearchList([quick.search("a"), quick.search("a")])).toBe(false);
    expect(isQuickSearchList([quick.time(30), quick.time(60)])).toBe(true);
    const words = Array.from({ length: MAX_QUICK_SEARCHES + 1 }, (_, i) => quick.with(`w${i}`));
    expect(isQuickSearchList(words.slice(0, MAX_QUICK_SEARCHES))).toBe(true);
    expect(isQuickSearchList(words)).toBe(false);
    const searches = Array.from({ length: MAX_SAVED_SEARCHES + 1 }, (_, i) =>
      quick.search(`s${i}`),
    );
    expect(isQuickSearchList(searches.slice(0, MAX_SAVED_SEARCHES))).toBe(true);
    expect(isQuickSearchList(searches)).toBe(false);
  });

  it("always has room for every saved search beside the tick lines", () => {
    const words = Array.from({ length: MAX_QUICK_SEARCHES }, (_, i) => quick.with(`w${i}`));
    const searches = Array.from({ length: MAX_SAVED_SEARCHES }, (_, i) => ({
      id: `s${i}`,
      createdAt: `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const merged = mergeQuickSearches(words, searches);
    expect(merged).toHaveLength(MAX_QUICK_SEARCHES + MAX_SAVED_SEARCHES);
    expect(isQuickSearchList(merged)).toBe(true);
    expect(readQuickSearches(JSON.stringify(merged))).toEqual(merged);
    expect(quickSearchFull(merged, quick.photo)).toBe(true);
    expect(quickSearchFull(words.slice(1), quick.photo)).toBe(false);
  });
});

describe("reading the stored list", () => {
  it("gives the starting list when never set or not readable", () => {
    expect(readQuickSearches(null)).toEqual(DEFAULT_QUICK_SEARCHES);
    expect(readQuickSearches(undefined)).toEqual(DEFAULT_QUICK_SEARCHES);
    expect(readQuickSearches("{oops")).toEqual(DEFAULT_QUICK_SEARCHES);
    expect(readQuickSearches('{"a":1}')).toEqual(DEFAULT_QUICK_SEARCHES);
  });

  it("keeps an emptied list empty and leaves out lines it doesn't understand", () => {
    expect(readQuickSearches("[]")).toEqual([]);
    const text = JSON.stringify([
      quick.photo,
      { type: "filter", filter: "later" },
      quick.photo,
      quick.time(45),
    ]);
    expect(keys(readQuickSearches(text))).toEqual(["photo", "time:45"]);
  });
});

describe("the lines shown", () => {
  const searches = [
    { id: "new", createdAt: "2026-11-03T00:00:00Z" },
    { id: "old", createdAt: "2026-10-01T00:00:00Z" },
    { id: "named", createdAt: "2026-09-01T00:00:00Z" },
  ];

  it("add saved searches the list doesn't name at the end, newest last", () => {
    const items = [quick.favorites, quick.search("named"), quick.time(30)];
    expect(keys(mergeQuickSearches(items, searches))).toEqual([
      "favorites",
      "search:named",
      "time:30",
      "search:old",
      "search:new",
    ]);
  });

  it("skip a saved search that is gone", () => {
    const items = [quick.search("gone"), quick.favorites];
    expect(keys(mergeQuickSearches(items, []))).toEqual(["favorites"]);
  });

  it("keep the stored lines as they are while the saved searches aren't known", () => {
    const items = [quick.search("gone"), quick.favorites];
    expect(mergeQuickSearches(items, null)).toBe(items);
  });
});

describe("changing the list", () => {
  const items = [quick.favorites, quick.time(30), quick.photo];

  it("adds at the end, once, and not past the cap", () => {
    expect(keys(addQuickSearch(items, quick.made("recent")))).toEqual([
      "favorites",
      "time:30",
      "photo",
      "made:recent",
    ]);
    expect(addQuickSearch(items, quick.photo)).toBe(items);
    const full = Array.from({ length: MAX_QUICK_SEARCHES }, (_, i) => quick.with(`w${i}`));
    expect(addQuickSearch(full, quick.photo)).toBe(full);
    // Saved searches don't take a tick line's room.
    const searches = Array.from({ length: 70 }, (_, i) => quick.search(`s${i}`));
    expect(addQuickSearch(searches, quick.photo)).toHaveLength(71);
  });

  it("removes by key", () => {
    expect(keys(removeQuickSearch(items, "time:30"))).toEqual(["favorites", "photo"]);
  });

  it("changes a line in place, removing another that is now the same", () => {
    expect(keys(replaceQuickSearch(items, "time:30", quick.time(45)))).toEqual([
      "favorites",
      "time:45",
      "photo",
    ]);
    const two = [quick.time(60), quick.favorites, quick.time(30)];
    expect(keys(replaceQuickSearch(two, "time:30", quick.time(60)))).toEqual([
      "favorites",
      "time:60",
    ]);
    expect(replaceQuickSearch(items, "time:90", quick.time(45))).toBe(items);
  });

  it("moves a line to a place, or before another", () => {
    expect(keys(moveQuickSearch(items, "photo", 0))).toEqual(["photo", "favorites", "time:30"]);
    expect(keys(moveQuickSearch(items, "favorites", 99))).toEqual([
      "time:30",
      "photo",
      "favorites",
    ]);
    expect(keys(moveQuickSearchBefore(items, "photo", "time:30"))).toEqual([
      "favorites",
      "photo",
      "time:30",
    ]);
    expect(keys(moveQuickSearchBefore(items, "favorites", null))).toEqual([
      "time:30",
      "photo",
      "favorites",
    ]);
    expect(moveQuickSearchBefore(items, "favorites", "favorites")).toBe(items);
    expect(moveQuickSearchBefore(items, "nothing", null)).toBe(items);
    expect(moveQuickSearchBefore(items, "photo", "nothing")).toBe(items);
  });
});
