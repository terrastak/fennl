import { describe, expect, it } from "vitest";
import { dietLabels } from "./diet";

// Phase E3: diet labels a recipe page lists, as categories under "Diet".

describe("dietLabels", () => {
  it("reads Schema.org's diets, which say so outright", () => {
    expect(
      dietLabels({
        suitableForDiet: ["https://schema.org/GlutenFreeDiet", "http://schema.org/VeganDiet"],
      }),
    ).toEqual({ paths: ["Diet › Gluten-free", "Diet › Vegan"], stated: true });
  });

  it("reads diets named in keywords and categories", () => {
    expect(
      dietLabels({
        keywords: ["snack", "vegan", "Nut Free", "deep fry"],
        recipeCategory: "Dessert, Gluten free",
        recipeCuisine: "Keto",
      }),
    ).toEqual({
      paths: ["Diet › Vegan", "Diet › Nut-free", "Diet › Gluten-free", "Diet › Keto"],
      stated: false,
    });
  });

  it("ignores words that only mention a diet", () => {
    expect(
      dietLabels({ keywords: "vegan recipes, not gluten-free friendly, Low Protein" }).paths,
    ).toEqual([]);
    expect(dietLabels({}).paths).toEqual([]);
  });
});
