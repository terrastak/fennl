import { describe, expect, it } from "vitest";
import { emptyRecipeContent, type RecipeContent } from "./recipe";
import { ingredientsFromText, directionsFromText } from "./recipeLines";
import { linesScore, matchRecipes, normalize, scoreRecipe, textScore } from "./importScore";

const lines = (...texts: string[]) => texts.map((text) => ({ text, heading: false }));

function recipe(
  fields: Partial<RecipeContent> & { ingredientText?: string; directionText?: string },
) {
  const { ingredientText, directionText, ...rest } = fields;
  return {
    ...emptyRecipeContent(),
    ...(ingredientText ? { ingredients: ingredientsFromText(ingredientText, []) } : {}),
    ...(directionText ? { directions: directionsFromText(directionText, []) } : {}),
    ...rest,
  };
}

describe("normalizing text", () => {
  it("forgives what doesn't matter to a cook", () => {
    expect(normalize("  1½ Cups  FLOUR, sifted. ")).toBe("1 1/2 cups flour, sifted");
    expect(normalize("• ½ cup sugar")).toBe("1/2 cup sugar");
    expect(normalize("Step 2: Don’t stir")).toBe("don't stir");
    expect(normalize("3) Bake 10–12 minutes")).toBe("bake 10-12 minutes");
  });
});

describe("text scores", () => {
  it("is 1 for the same text, and lower the more it differs", () => {
    expect(textScore("Walnut Cherry Cake", "walnut cherry cake")).toBe(1);
    expect(textScore("Walnut Cherry Cake", "Walnut Cheny Cake")).toBeGreaterThan(0.85);
    expect(textScore("Walnut Cherry Cake", "Sugar Butter Balls")).toBeLessThan(0.4);
    expect(textScore("", "")).toBe(1);
    expect(textScore("Something", "")).toBe(0);
  });
});

describe("line lists", () => {
  it("counts exact, missing and extra lines", () => {
    const { score, counts } = linesScore(
      lines("1 cup butter", "1/2 cup sugar", "2 1/4 cup flour"),
      lines("1 cup butter", "2 1/4 cups flour", "a pinch of salt"),
    );
    expect(counts).toEqual({ expected: 3, found: 3, exact: 1, missing: 1, extra: 1 });
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(0.67);
  });

  it("doesn't care about order, and halves a heading taken for a line", () => {
    expect(linesScore(lines("a b c", "d e f"), lines("d e f", "a b c")).score).toBe(1);
    const heading = linesScore(
      [{ text: "For the sauce:", heading: true }],
      [{ text: "For the sauce:", heading: false }],
    );
    expect(heading.score).toBe(0.5);
  });

  it("is 1 for two empty lists", () => {
    expect(linesScore([], []).score).toBe(1);
  });
});

describe("scoring a recipe", () => {
  const expected = {
    title: "Sugar Butter Balls",
    ingredients: ["1 cup butter", "1 tsp. vanilla", "1/2 tsp. salt"],
    directions: ["Mix butter, sugar and vanilla, sift flour and salt, add nuts."],
    servings: { count: 48, yield: "4 doz." },
    times: { total: null },
  };

  it("scores only the fields the correct answer gives", () => {
    const score = scoreRecipe(
      expected,
      recipe({
        title: "Sugar Butter Balls",
        ingredientText: "1 cup butter\n1 tsp. vanilla\n½ tsp. salt",
        directionText: "Mix butter, sugar and vanilla, sift flour and salt, add nuts.",
        servings: { count: 48, yield: "4 doz." },
        description: "Anything at all",
      }),
    );
    expect(score.fields).toEqual({
      title: 1,
      description: null,
      ingredients: 1,
      directions: 1,
      times: 1,
      servings: 1,
      notes: null,
      source: null,
    });
    expect(score.overall).toBe(1);
  });

  it("counts what's wrong", () => {
    const score = scoreRecipe(
      expected,
      recipe({
        title: "Sugar Butter Bals",
        ingredientText: "1 cup butter",
        servings: { count: 4, yield: "4 doz." },
        times: {
          prep: { minutes: null, text: null },
          cook: { minutes: null, text: null },
          total: { minutes: 20, text: null },
        },
      }),
    );
    expect(score.fields.ingredients).toBeCloseTo(1 / 3);
    expect(score.fields.directions).toBe(0);
    expect(score.fields.servings).toBe(0.5);
    expect(score.fields.times).toBe(0);
    expect(score.ingredients).toMatchObject({ exact: 1, missing: 2 });
    expect(score.overall).toBeLessThan(0.5);
  });
});

describe("files of several recipes", () => {
  it("pairs recipes by title", () => {
    const found = [recipe({ title: "Pretzels" }), recipe({ title: "Bagels" })];
    expect(matchRecipes([{ title: "Hamburger Buns" }, { title: "Pretzels" }], found)).toEqual({
      pairs: [
        { expected: 0, found: null },
        { expected: 1, found: 0 },
      ],
      extra: 1,
    });
  });
});
