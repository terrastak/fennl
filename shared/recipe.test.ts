import { describe, expect, it } from "vitest";
import {
  emptyRecipeContent,
  isCategoryName,
  isRating,
  recipeBytes,
  recipeIssues,
  type RecipeContent,
} from "./recipe";
import { directionsFromText, ingredientsFromText } from "./recipeLines";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** A recipe close to one from the owner's Paprika library. */
function fajitas(): RecipeContent {
  return {
    ...emptyRecipeContent(),
    title: "Chicken Fajitas With Avocado Crema",
    ingredients: ingredientsFromText(
      "4 tablespoons vegetable oil, divided\n¾ -1 teaspoon chili powder\n\nAVOCADO CREMA:\n1 large avocado",
      [],
      uuid,
    ),
    directions: directionsFromText(
      "1. Combine oil and seasonings.\n2. Cook chicken 5-6 minutes.",
      [],
      uuid,
    ),
    times: {
      prep: { minutes: 20, text: null },
      cook: { minutes: 5, text: null },
      total: { minutes: null, text: null },
    },
    servings: { count: 6, yield: "6 servings" },
    source: {
      kind: "website",
      name: "Tasteofhome.com",
      url: "http://www.tasteofhome.com/recipes/flavorful-chicken-fajitas",
      author: null,
      page: null,
    },
    nutrition: {
      perServing: { calories: 369, fat: 15, saturatedFat: 2, cholesterol: 63, sodium: 689 },
      text: "1 serving (1 each) equals 369 calories, 15 g fat (2 g saturated fat)…",
      source: "paprika",
    },
  };
}

describe("recipeIssues", () => {
  it("accepts a complete recipe", () => {
    expect(recipeIssues(fajitas(), null)).toEqual([]);
    expect(recipeIssues(fajitas(), 256 * 1024)).toEqual([]);
  });

  it("needs a title, and refuses broken parts", () => {
    const broken = {
      ...fajitas(),
      title: "  ",
      difficulty: "fiendish",
      servings: { count: 0, yield: null },
      source: { kind: "website", name: null, url: "javascript:alert(1)", author: null, page: null },
      times: { prep: { minutes: -5, text: null }, cook: { minutes: null, text: null } },
      nutrition: { perServing: { vitaminZ: 3 }, text: null, source: "paprika" },
    };
    expect(recipeIssues(broken, null)).toEqual(
      expect.arrayContaining([
        { path: "title", problem: "missing" },
        { path: "difficulty", problem: "invalid" },
        { path: "servings.count", problem: "invalid" },
        { path: "source.url", problem: "invalid" },
        { path: "times.prep.minutes", problem: "invalid" },
        { path: "times.total", problem: "invalid" },
        { path: "nutrition.perServing.vitaminZ", problem: "invalid" },
      ]),
    );
  });

  it("checks every line: an ID used once, text, and links", () => {
    const recipe = fajitas();
    recipe.ingredients[1] = { ...recipe.ingredients[1]!, id: recipe.ingredients[0]!.id };
    recipe.ingredients[2] = { ...recipe.ingredients[2]!, text: "" };
    recipe.ingredients[3] = { ...recipe.ingredients[3]!, linkedRecipeId: "not-an-id" };
    expect(recipeIssues(recipe, null)).toEqual([
      { path: "ingredients.1.id", problem: "duplicate_id" },
      { path: "ingredients.2.text", problem: "missing" },
      { path: "ingredients.3.linkedRecipeId", problem: "invalid" },
    ]);
  });

  it("holds a recipe to the plan's size limit, counted in bytes", () => {
    const recipe = fajitas();
    const size = recipeBytes(recipe);
    expect(recipeIssues(recipe, size)).toEqual([]);
    expect(recipeIssues(recipe, size - 1)).toEqual([{ path: "", problem: "too_large" }]);
  });

  it("refuses things that aren't recipes at all", () => {
    expect(recipeIssues(null, null)).toEqual([{ path: "", problem: "invalid" }]);
    expect(recipeIssues({}, null).length).toBeGreaterThan(5);
  });
});

describe("small rules", () => {
  it("ratings are whole stars from 1 to 5, or none", () => {
    expect([null, 1, 5].every(isRating)).toBe(true);
    expect([0, 6, 2.5, "3"].some(isRating)).toBe(false);
  });

  it("category names can't be empty or contain the path separator", () => {
    expect(isCategoryName("Gluten-free")).toBe(true);
    expect(isCategoryName("Untested")).toBe(true);
    expect(isCategoryName(" ")).toBe(false);
    expect(isCategoryName("Desserts › Cakes")).toBe(false);
  });
});
