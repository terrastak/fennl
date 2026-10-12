import { describe, expect, it } from "vitest";
import { findDuplicates, pageKey, type DuplicateCandidate } from "./duplicates";

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
