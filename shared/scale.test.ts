import { describe, expect, it } from "vitest";
import {
  amountText,
  factorName,
  recipeScale,
  scaledServings,
  showIngredient,
  showStep,
  type ShownLine,
  type UnitSystem,
} from "./scale";

// Phase F1: scaling and converting a recipe for reading (spec.md F1).

/** A shown line with Fennl's changes in [brackets] and what it left as written in {braces}. */
const marked = (line: ShownLine) =>
  line.pieces
    .map((p) => (p.changed ? `[${p.text}]` : p.unchanged ? `{${p.text}}` : p.text))
    .join("");

const show = (text: string, factor: number, units: UnitSystem = "written", held = false) =>
  marked(showIngredient(text, { factor, units }, held));

describe("scaling an ingredient", () => {
  it("leaves the recipe exactly as written when nothing is chosen", () => {
    const line = showIngredient("1 bag (16 oz) chocolate chips", { factor: 1, units: "written" });
    expect(line).toEqual({ pieces: [{ text: "1 bag (16 oz) chocolate chips" }], changed: false });
  });

  it("keeps a package size after a container word, and says each", () => {
    expect(show("1 bag (16 oz) chocolate chips", 2)).toBe(
      "[2 bags] ([16 oz each]) chocolate chips",
    );
    expect(show("1 can (14 oz) coconut milk", 2)).toBe("[2 cans] ([14 oz each]) coconut milk");
    expect(show("1 stick (8 Tbsp) butter", 3)).toBe("[3 sticks] ([8 Tbsp each]) butter");
    // A count that isn't whole: the total too, in the size's own unit.
    expect(show("1 bag (16 oz) chocolate chips", 1.5)).toBe(
      "[1 1/2 bags] ([16 oz each, 24 oz in all]) chocolate chips",
    );
    expect(show("1 stick (8 Tbsp) butter", 0.5)).toBe(
      "[1/2 stick] ([8 Tbsp each, 4 Tbsp in all]) butter",
    );
    const line = showIngredient("1 bag (16 oz) chips", { factor: 1.5, units: "written" });
    expect(line.total).toBe("24 oz in all");
    // Never "each" twice when the recipe already says it.
    expect(show("2 cans (15 oz each) black beans", 2)).toBe("[4 cans] (15 oz each) black beans");
  });

  it("never scales a size written before the container", () => {
    expect(show("2 (14.5-oz) cans diced tomatoes", 2)).toBe("[4] (14.5-oz) cans diced tomatoes");
    expect(show("1 (14.5-oz) can tomatoes", 2)).toBe("[2] (14.5-oz) [cans] tomatoes");
    expect(show("2 (14.5-oz) cans diced tomatoes", 0.5)).toBe("[1] (14.5-oz) [can] diced tomatoes");
    expect(show("Two 28-ounce cans tomatoes", 2)).toBe("[Four] 28-ounce cans tomatoes");
    expect(show("2 x 400 g tins chickpeas", 1.5)).toBe("[3] x 400 g tins chickpeas");
    expect(show("1 1/4-ounce envelope yeast", 2)).toBe("[2] 1/4-ounce [envelopes] yeast");
  });

  it("scales an equivalent amount after a measuring unit with it", () => {
    expect(show("1 cup (240 g) flour", 2)).toBe("[2 cups] ([480 g]) flour");
    expect(show("1 cup / 240 ml milk", 0.5)).toBe("[1/2 cup] / [120 ml] milk");
    expect(show("2 lb (900 g) chicken", 2)).toBe("[4 lb] ([1.8 kg]) chicken");
  });

  it("leaves a bracket it can't place as written, and marks it", () => {
    expect(show("2 slices (1 oz each) cheese", 2)).toBe("[4 slices] ({1 oz} each) cheese");
    expect(show("3 cloves (15 g) garlic", 2)).toBe("[6 cloves] ({15 g}) garlic");
  });

  it("writes amounts the friendly way", () => {
    expect(show("8 tablespoons butter", 2)).toBe("[1 cup] butter");
    expect(show("8 tablespoons butter", 1.5)).toBe("[3/4 cup] butter");
    expect(show("8 Tbsp butter", 0.5)).toBe("[1/4 cup] butter");
    expect(show("2 teaspoons vanilla", 1.5)).toBe("[1 Tbsp] vanilla");
    // Not "1 1/3 Tbsp".
    expect(show("2 teaspoons vanilla", 2)).toBe("[4 teaspoons] vanilla");
    expect(show("1 tablespoon sugar", 0.5)).toBe("[1 1/2 tsp] sugar");
    // Not "5/8 cup".
    expect(show("1 cup plus 2 tablespoons flour", 0.5)).toBe("[9 Tbsp] flour");
    expect(show("8 oz cream cheese", 2)).toBe("[1 lb] cream cheese");
    expect(show("½ cup sugar", 1.5)).toBe("[¾ cup] sugar");
    expect(show("about 2 cups stock", 2)).toBe("[about 4 cups] stock");
    expect(show("2-3 cloves garlic", 2)).toBe("[4-6 cloves] garlic");
    expect(show("1 cup sugar or 1 tablespoon honey", 2)).toBe(
      "[2 cups] sugar or [2 tablespoons] honey",
    );
  });

  it("counts and items follow the amount", () => {
    expect(show("1 large egg", 2)).toBe("[2] large [eggs]");
    expect(show("3 large eggs", 1.5)).toBe("[4 1/2] large eggs");
    expect(show("1 tomato, diced", 2)).toBe("[2] [tomatoes], diced");
    expect(show("2 eggs", 0.5)).toBe("[1] [egg]");
  });

  it("leaves a pinch alone, and a held line at its amount", () => {
    expect(show("pinch of salt", 2)).toBe("pinch of salt");
    expect(show("2 cups flour", 2, "written", true)).toBe("2 cups flour");
    // Held still converts.
    expect(show("8 oz cream cheese", 2, "metric", true)).toBe("[225 g] cream cheese");
  });
});

describe("converting units", () => {
  it("converts to metric, keeping spoons, and never weight to volume", () => {
    expect(show("8 oz cream cheese", 1, "metric")).toBe("[225 g] cream cheese");
    expect(show("½ cup sugar", 1, "metric")).toBe("[120 ml] sugar");
    expect(show("2 lb chicken thighs", 1, "metric")).toBe("[905 g] chicken thighs");
    expect(show("3 lb beef", 1, "metric")).toBe("[1.36 kg] beef");
    expect(show("2 teaspoons vanilla", 1, "metric")).toBe("2 teaspoons vanilla");
    // Spoons stay spoons in metric, never a cup.
    expect(show("2 tablespoons sugar", 2, "metric")).toBe("[4 tablespoons] sugar");
    expect(show("2 cups buttermilk", 2, "metric")).toBe("[950 ml] buttermilk");
    expect(show("6 cups stock", 2, "metric")).toBe("[2.85 l] stock");
    expect(show("1 bag (16 oz) chocolate chips", 2, "metric")).toBe(
      "[2 bags] ([455 g each]) chocolate chips",
    );
    expect(show("2 (14.5-oz) cans diced tomatoes", 1, "metric")).toBe(
      "2 ([410 g]) cans diced tomatoes",
    );
  });

  it("converts to US", () => {
    expect(show("500 g flour", 1, "us")).toBe("[17 2/3 oz] flour");
    expect(show("1 kg potatoes", 1, "us")).toBe("[2 1/4 lb] potatoes");
    expect(show("250 ml milk", 1, "us")).toBe("[1 cup] milk");
    expect(show("15 ml oil", 1, "us")).toBe("[1 Tbsp] oil");
  });

  it("leaves a line that already gives the other system", () => {
    expect(show("1 cup / 240 ml milk", 1, "metric")).toBe("1 cup / 240 ml milk");
    expect(show("1 cup (240 g) flour", 1, "metric")).toBe("1 cup (240 g) flour");
    expect(show("2 lb (900 g) chicken", 1, "us")).toBe("2 lb (900 g) chicken");
  });
});

describe("scaling a step", () => {
  it("scales measured amounts, never times, temperatures, pans or counts", () => {
    const step =
      "Stir in 1/2 cup of the sugar and bake 25 minutes at 350°F in a 9-inch pan with 2 eggs.";
    expect(marked(showStep(step, { factor: 2, units: "written" }))).toBe(
      "Stir in [1 cup] of the sugar and bake 25 minutes at 350°F in a 9-inch pan with 2 eggs.",
    );
    expect(marked(showStep(step, { factor: 1, units: "metric" }))).toBe(
      "Stir in [120 ml] of the sugar and bake 25 minutes at 350°F in a 9-inch pan with 2 eggs.",
    );
    expect(showStep(step, { factor: 1, units: "written" }).changed).toBe(false);
  });

  it("keeps one piece's size: more cookies, not bigger ones", () => {
    const doubled = { factor: 2, units: "written" } as const;
    const cookies =
      "With clean hands, roll ¼ cupfuls (60 ml) of the mixture into balls. Bake for 20 minutes.";
    expect(showStep(cookies, doubled).changed).toBe(false);
    for (const step of [
      "Pour in ¼ cup of batter per pancake.",
      "Drop 2 tablespoons of dough onto the tray, 5 cm apart.",
      "Spoon 1/3 cup into each muffin case.",
      "Roll 1 tablespoon into balls and flatten slightly.",
      "Drop heaped tablespoonfuls (30 ml) onto the tray.",
      "Use 2 tablespoons per cookie.",
    ]) {
      expect(showStep(step, doubled).changed, step).toBe(false);
    }
    // Still converted to the units chosen.
    expect(
      marked(showStep("Pour in ¼ cup of batter per pancake.", { factor: 2, units: "metric" })),
    ).toBe("Pour in [59 ml] of batter per pancake.");
    // The rest of the step still scales.
    expect(marked(showStep("Reserve 1 cup of the mixture for the topping.", doubled))).toBe(
      "Reserve [2 cups] of the mixture for the topping.",
    );
    expect(marked(showStep("Add 1/2 cup sugar, then roll 1 tablespoon into balls.", doubled))).toBe(
      "Add [1 cup] sugar, then roll 1 tablespoon into balls.",
    );
  });
});

describe("servings and the scale itself", () => {
  it("scales the count and the words that give it", () => {
    expect(scaledServings({ count: 12, yield: "12 regular muffins" }, 2)).toEqual({
      count: 24,
      yield: "24 regular muffins",
    });
    expect(scaledServings({ count: 4, yield: "Serves 4 to 6" }, 1.5)).toEqual({
      count: 6,
      yield: "Serves 6 to 9",
    });
    expect(scaledServings({ count: 1, yield: "One 12x17-inch loaf" }, 2)).toEqual({
      count: 2,
      yield: "Two 12x17-inch loaves",
    });
    expect(scaledServings({ count: 10, yield: "one 9-inch cake" }, 2).yield).toBe(
      "two 9-inch cakes",
    );
    expect(scaledServings({ count: 10, yield: "two 9-inch cakes" }, 0.5).yield).toBe(
      "one 9-inch cake",
    );
    expect(scaledServings({ count: null, yield: "1 pie" }, 2)).toEqual({
      count: null,
      yield: "2 pies",
    });
    expect(scaledServings({ count: 4, yield: "about 12 pancakes" }, 2)).toEqual({
      count: 8,
      yield: "about 24 pancakes",
    });
    expect(scaledServings({ count: 8, yield: "1 (9-inch) pie" }, 0.5)).toEqual({
      count: 4,
      yield: "1/2 (9-inch) pie",
    });
  });

  it("names a factor, and writes amounts", () => {
    expect(factorName(2)).toBe("Doubled");
    expect(factorName(0.5)).toBe("Halved");
    expect(factorName(1.5)).toBe("1½×");
    expect(factorName(1.828)).toBe("about 1¾×");
    expect(amountText(0.33, "cup")).toBe("1/3");
    expect(amountText(0.01, "cup")).toBe("1/8");
    expect(amountText(453.6, "gram")).toBe("455");
    expect(amountText(1.357, "kilogram")).toBe("1.36");
  });

  it("checks a stored scale", () => {
    expect(recipeScale({ factor: 2, held: ["a"] })).toEqual({ factor: 2, held: ["a"] });
    expect(recipeScale({ factor: 0, held: [] })).toBeNull();
    expect(recipeScale({ factor: 1000, held: [] })).toBeNull();
    expect(recipeScale({ factor: 2, held: [1] })).toBeNull();
    expect(recipeScale({ factor: Number.NaN, held: [] })).toBeNull();
    expect(recipeScale(null)).toBeNull();
    // Scaled for another pan (phase F2).
    const pan = {
      shape: "square",
      width: 8,
      length: null,
      depth: null,
      unit: "in",
      cups: null,
      count: 1,
    };
    const pans = { recipe: pan, yours: { ...pan, shape: "rectangle", width: 9, length: 13 } };
    expect(recipeScale({ factor: 1.83, held: [], pans })).toEqual({ factor: 1.83, held: [], pans });
    expect(recipeScale({ factor: 1.83, held: [], pans: { recipe: pan } })).toBeNull();
  });
});
