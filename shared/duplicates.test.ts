import { describe, expect, it } from "vitest";
import {
  findDuplicatePairs,
  findDuplicates,
  pageKey,
  pairKey,
  type DuplicateCandidate,
  type PairCandidate,
} from "./duplicates";

const lines = (...texts: string[]) => texts.map((text) => ({ text, heading: false }));

const library: DuplicateCandidate[] = [
  {
    id: "sponge",
    title: "Victoria Sponge Cake",
    urls: ["https://www.cakes.example.com/victoria-sponge/", null],
    ingredients: lines("225g butter", "225g caster sugar", "4 eggs", "225g self-raising flour"),
  },
  {
    id: "sponge-mine",
    title: "Victoria sponge cake",
    urls: [null],
    ingredients: [
      { text: "Cake", heading: true },
      ...lines("225 g butter", "225 g caster sugar", "4 large eggs", "225 g self-raising flour"),
    ],
  },
  {
    id: "lemon",
    title: "Lemon Drizzle Cake",
    urls: ["https://cakes.example.com/lemon"],
    ingredients: lines("225g butter", "225g sugar", "4 eggs", "2 lemons"),
  },
  {
    id: "sponge-other",
    title: "Victoria Sponge Cake",
    urls: [],
    ingredients: lines("1 cup flour", "2 bananas", "1 tsp cinnamon"),
  },
];

describe("pageKey", () => {
  it("treats links to the same page alike", () => {
    const key = pageKey("https://www.cakes.example.com/victoria-sponge/");
    expect(pageKey("http://cakes.example.com/victoria-sponge")).toBe(key);
    expect(pageKey("https://cakes.example.com/victoria-sponge/?utm_source=x&fbclid=y#recipe")).toBe(
      key,
    );
    expect(pageKey("https://cakes.example.com/victoria-sponge/amp/")).toBe(key);
  });

  it("keeps what tells pages apart", () => {
    expect(pageKey("https://cakes.example.com/recipe?id=1")).not.toBe(
      pageKey("https://cakes.example.com/recipe?id=2"),
    );
    expect(pageKey("https://cakes.example.com/a")).not.toBe(pageKey("https://pies.example.com/a"));
  });

  it("is null for anything that isn't a web address", () => {
    expect(pageKey(null)).toBeNull();
    expect(pageKey("Grandma")).toBeNull();
    expect(pageKey("mailto:june@example.com")).toBeNull();
  });
});

describe("findDuplicates", () => {
  it("finds the same page first, then recipes alike in title and ingredients", () => {
    const found = findDuplicates(
      {
        title: "Victoria Sponge Cake",
        urls: ["https://cakes.example.com/victoria-sponge?utm_medium=email"],
        ingredients: ["225g butter", "225g caster sugar", "4 eggs", "225g self-raising flour"],
      },
      library,
    );
    expect(found).toEqual([
      { id: "sponge", reason: "same_page" },
      { id: "sponge-mine", reason: "similar" },
    ]);
  });

  it("doesn't call a recipe with the same name but other ingredients a duplicate", () => {
    const found = findDuplicates(
      { title: "Victoria Sponge Cake", urls: [], ingredients: ["2 cups flour", "3 apples"] },
      library,
    );
    expect(found).toEqual([]);
  });

  it("needs the same title when there are no ingredients to compare", () => {
    expect(
      findDuplicates({ title: "Victoria Sponge Cake", urls: [], ingredients: [] }, library).map(
        (m) => m.id,
      ),
    ).toEqual(["sponge", "sponge-mine", "sponge-other"]);
    expect(
      findDuplicates({ title: "Victoria Sponge", urls: [], ingredients: [] }, library),
    ).toEqual([]);
  });

  it("finds nothing for a new recipe", () => {
    expect(
      findDuplicates(
        { title: "Black Bean Soup", urls: ["https://soup.example.com/"], ingredients: ["beans"] },
        library,
      ),
    ).toEqual([]);
  });
});

describe("finding pairs in a whole library (phase C14)", () => {
  const mine = (candidate: DuplicateCandidate, ownerId = "me"): PairCandidate => ({
    ...candidate,
    ownerId,
  });
  const sponge = library[0] as DuplicateCandidate;
  const spongeMine = library[1] as DuplicateCandidate;
  const lemon = library[2] as DuplicateCandidate;
  const spongeOther = library[3] as DuplicateCandidate;
  const keys = (pairs: { a: string; b: string }[]) => pairs.map((p) => pairKey(p.a, p.b));

  it("pairs the same recipe saved twice, the surest first", () => {
    const pairs = findDuplicatePairs([sponge, spongeMine, lemon, spongeOther].map((r) => mine(r)));
    expect(pairs).toEqual([{ a: "sponge", b: "sponge-mine", reason: "similar" }]);
  });

  it("pairs recipes from the same page even with different titles, and puts them first", () => {
    const pairs = findDuplicatePairs([
      mine({
        id: "x1",
        title: "Aunt June's soup",
        urls: ["https://a.example/soup?utm_source=z"],
        ingredients: [],
      }),
      mine({
        id: "x2",
        title: "Soup, a classic",
        urls: ["https://www.a.example/soup/"],
        ingredients: [],
      }),
      ...[sponge, spongeMine].map((r) => mine(r)),
    ]);
    expect(pairs.map((p) => p.reason)).toEqual(["same_page", "similar"]);
    expect(keys(pairs)[0]).toBe("x1|x2");
  });

  it("gives every pair one spelling, once", () => {
    const pairs = findDuplicatePairs([spongeMine, sponge].map((r) => mine(r)));
    expect(pairs).toEqual([{ a: "sponge", b: "sponge-mine", reason: "similar" }]);
    const three = findDuplicatePairs(
      ["p", "q", "r"].map((id) =>
        mine({ id, title: id, urls: ["https://s.example/same"], ingredients: [] }),
      ),
    );
    expect(keys(three).sort()).toEqual(["p|q", "p|r", "q|r"]);
  });

  it("doesn't pair a similar title with different ingredients", () => {
    expect(findDuplicatePairs([sponge, spongeOther].map((r) => mine(r)))).toEqual([]);
  });

  it("only pairs one person's own recipes", () => {
    const pairs = findDuplicatePairs([mine(sponge, "me"), mine(spongeMine, "them")]);
    expect(pairs).toEqual([]);
  });

  it("pairs titles with no ingredients only when they read the same", () => {
    const bare = (id: string, title: string) => mine({ id, title, urls: [], ingredients: [] });
    expect(findDuplicatePairs([bare("a", "Pancakes"), bare("b", "pancakes")])).toHaveLength(1);
    expect(findDuplicatePairs([bare("a", "Pancakes"), bare("b", "Pancake mix")])).toHaveLength(0);
  });

  it("finds a pair even when the shared title word is in many recipes, by its other words", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      mine({
        id: `c${i}`,
        title: `Chicken dish number ${i}`,
        urls: [],
        ingredients: lines(`${i} chicken`),
      }),
    );
    const pairs = findDuplicatePairs([
      ...many,
      mine({
        id: "t1",
        title: "Tarragon chicken",
        urls: [],
        ingredients: lines("2 chicken breasts", "1 tarragon"),
      }),
      mine({
        id: "t2",
        title: "Tarragon chicken",
        urls: [],
        ingredients: lines("2 chicken breasts", "1 tarragon"),
      }),
    ]);
    expect(keys(pairs)).toContain("t1|t2");
  });

  it("gives no more than the most asked for", () => {
    const same = Array.from({ length: 10 }, (_, i) =>
      mine({ id: `s${i}`, title: "Pancakes", urls: [], ingredients: lines("1 cup flour") }),
    );
    expect(findDuplicatePairs(same, { maxPairs: 5 })).toHaveLength(5);
    expect(findDuplicatePairs(same)).toHaveLength(45);
  });

  it("stays quick on a big library", () => {
    const words = [
      "lemon",
      "garlic",
      "roast",
      "spicy",
      "creamy",
      "baked",
      "fresh",
      "smoky",
      "honey",
      "herb",
    ];
    const big = Array.from({ length: 5000 }, (_, i) =>
      mine({
        id: `r${i}`,
        title: `${words[i % 10]} ${words[(i * 7 + 3) % 10]} dish ${i}`,
        urls: [],
        ingredients: lines(`${i} item`, `${i % 13} thing`),
      }),
    );
    const started = Date.now();
    findDuplicatePairs(big);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
