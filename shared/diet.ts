import { CATEGORY_SEPARATOR, DIET_CATEGORY } from "./recipe";
import { list } from "./schemaRecipe";
import { cleanText } from "./webText";

/**
 * Diet labels a recipe page lists, as categories under "Diet" ("Diet › Gluten-free"; C1). From
 * Schema.org's `suitableForDiet`, which says it outright, and from the page's own keywords and
 * categories ("vegan", "gluten free"), which only suggest it (phase E3).
 */

/** Schema.org's RestrictedDiet values. */
const SCHEMA_DIETS: Record<string, string> = {
  DiabeticDiet: "Diabetic",
  GlutenFreeDiet: "Gluten-free",
  HalalDiet: "Halal",
  HinduDiet: "Hindu",
  KosherDiet: "Kosher",
  LowCalorieDiet: "Low-calorie",
  LowFatDiet: "Low-fat",
  LowLactoseDiet: "Low-lactose",
  LowSaltDiet: "Low-salt",
  VeganDiet: "Vegan",
  VegetarianDiet: "Vegetarian",
};

/** Keywords that name a diet, and the label each becomes. */
const DIET_WORDS: [RegExp, string][] = [
  [/^vegan$/, "Vegan"],
  [/^vegetarian$/, "Vegetarian"],
  [/^pescatarian$/, "Pescatarian"],
  [/^gluten[ -]?free$/, "Gluten-free"],
  [/^dairy[ -]?free$/, "Dairy-free"],
  [/^egg[ -]?free$/, "Egg-free"],
  [/^nut[ -]?free$/, "Nut-free"],
  [/^(?:keto|ketogenic)$/, "Keto"],
  [/^paleo$/, "Paleo"],
  [/^whole ?30$/, "Whole30"],
  [/^low[ -]?carb$/, "Low-carb"],
  [/^low[ -]?fat$/, "Low-fat"],
  [/^low[ -]?(?:sodium|salt)$/, "Low-salt"],
  [/^sugar[ -]?free$/, "Sugar-free"],
  [/^kosher$/, "Kosher"],
  [/^halal$/, "Halal"],
];

export interface DietLabels {
  /** Category paths: "Diet › Vegan". */
  paths: string[];
  /** Whether the page said so outright (`suitableForDiet`) rather than only in its keywords. */
  stated: boolean;
}

function words(value: unknown): string[] {
  return list(value).flatMap((v) =>
    cleanText(v, true)
      .split(/[,;|]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** The diet labels a recipe lists, from its Schema.org data. */
export function dietLabels(recipe: Record<string, unknown>): DietLabels {
  const labels = new Set<string>();
  let stated = false;
  for (const value of list(recipe.suitableForDiet)) {
    const name = cleanText(value, true).replace(/^.*[/:#]/, "");
    const label = SCHEMA_DIETS[name];
    if (label) {
      labels.add(label);
      stated = true;
    }
  }
  for (const word of [
    ...words(recipe.keywords),
    ...words(recipe.recipeCategory),
    ...words(recipe.recipeCuisine),
  ]) {
    const label = DIET_WORDS.find(([pattern]) => pattern.test(word))?.[1];
    if (label) labels.add(label);
  }
  return {
    paths: [...labels].map((label) => `${DIET_CATEGORY}${CATEGORY_SEPARATOR}${label}`),
    stated,
  };
}
