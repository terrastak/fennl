import { describe, expect, it } from "vitest";
import { ingredientKeywords, MAX_SUGGESTIONS, suggestCategories } from "./suggest";

const lines = (...texts: string[]) => texts.map((text) => ({ text, heading: false }));

describe("ingredient keywords", () => {
  it("takes the ingredient's name, not its amount, unit or note", () => {
    expect(
      ingredientKeywords(lines("2 cups sliced mushrooms, patted dry", "1 lb pork shoulder")),
    ).toEqual(expect.arrayContaining(["mushroom", "pork", "shoulder"]));
    const words = ingredientKeywords(lines("2 cups sliced mushrooms, patted dry"));
    expect(words).not.toContain("cups");
    expect(words).not.toContain("patted");
    expect(words).not.toContain("2");
  });

  it("leaves out words that are in nearly everything", () => {
    const words = ingredientKeywords(
      lines("1 teaspoon salt", "2 tablespoons olive oil", "1 cup water", "3 cloves garlic"),
    );
    expect(words).toEqual(["clove", "garlic"].filter((w) => words.includes(w)));
    expect(words).not.toContain("salt");
    expect(words).not.toContain("oil");
    expect(words).not.toContain("water");
  });

  it("reduces plurals to one root", () => {
    expect(
      ingredientKeywords(lines("3 tomatoes", "2 cups berries", "4 eggs", "2 potatoes")),
    ).toEqual(["tomato", "berry", "egg", "potato"]);
  });

  it("ignores section headings, accents and repeats, and keeps only a few", () => {
    expect(ingredientKeywords([{ text: "For the sauce:", heading: true }])).toEqual([]);
    expect(ingredientKeywords(lines("1 jalapeño", "2 jalapeno"))).toEqual(["jalapeno"]);
    const many = lines(
      ...Array.from(
        { length: 30 },
        (_, i) => `1 cup ingredient${"abcdefghijklmnopqrstuvwxyzabcd"[i]}x`,
      ),
    );
    expect(ingredientKeywords(many).length).toBeLessThanOrEqual(10);
  });

  it("gives nothing for no ingredients", () => {
    expect(ingredientKeywords([])).toEqual([]);
  });
});

describe("suggesting categories", () => {
  it("suggests the categories the like recipes share", () => {
    const like = [["Soups", "Mexican"], ["Soups"], ["Soups", "Dinner"], ["Desserts"]];
    expect(suggestCategories(like, [])).toEqual(["Soups"]);
  });

  it("needs enough like recipes to learn from", () => {
    expect(suggestCategories([["Soups"], ["Soups"]], [])).toEqual([]);
  });

  it("needs more than one like recipe to agree, and a fair share of them", () => {
    expect(suggestCategories([["Soups"], ["Stews"], ["Salads"], ["Pies"]], [])).toEqual([]);
    const crowd = Array.from({ length: 10 }, (_, i) => (i < 2 ? ["Soups"] : ["Other"]));
    expect(suggestCategories(crowd, [])).toEqual(["Other"]);
  });

  it("doesn't suggest what the recipe is already in, or a wider category that holds one", () => {
    const like = [["Dinner › Soups"], ["Dinner › Soups"], ["Dinner"], ["Dinner"]];
    expect(suggestCategories(like, [])).toEqual(["Dinner", "Dinner › Soups"]);
    expect(suggestCategories(like, ["Dinner › Soups"])).toEqual([]);
    expect(suggestCategories(like, ["dinner › soups"])).toEqual([]);
    // In "Dinner" only: the narrower one is still worth suggesting.
    expect(suggestCategories(like, ["Dinner"])).toEqual(["Dinner › Soups"]);
  });

  it("puts the most agreed first, then by name, and offers only a few", () => {
    const like = [["B", "A", "C", "D"], ["B", "A", "C", "D"], ["B", "A", "C", "D"], ["B"]];
    const out = suggestCategories(like, []);
    expect(out).toEqual(["B", "A", "C"]);
    expect(out).toHaveLength(MAX_SUGGESTIONS);
  });

  it("counts a category once per like recipe, ignoring case", () => {
    const like = [["Soups", "soups"], ["SOUPS"], ["Pies"], ["Pies"], ["Salads"]];
    expect(suggestCategories(like, [])).toEqual(["Pies", "Soups"]);
  });
});
