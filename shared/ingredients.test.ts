import { describe, expect, it } from "vitest";
import { UNITS, readIngredient, standardIngredient, standardUnits } from "./ingredients";

// Phase E2: the ingredient reader against real-world lines. Each case is written as
// "quantity | unit | item | note", with "·" for nothing and the other amounts after "+".

const n = (v: number) => String(Math.round(v * 1000) / 1000);

function summary(line: string): string {
  const r = readIngredient(line);
  const q = r.quantity
    ? `${n(r.quantity.low)}${r.quantity.high !== null ? `-${n(r.quantity.high)}` : ""}`
    : "·";
  const others = r.amounts
    .filter((a) => a.role !== "main")
    .map(
      (a) =>
        `${a.role} ${n(a.low)}${a.high !== null ? `-${n(a.high)}` : ""}${a.unit ? ` ${a.unit}` : ""}`,
    );
  return [q, r.unit ?? "·", r.item ?? "·", r.note ?? "·", ...others.map((o) => `+ ${o}`)].join(
    " | ",
  );
}

const CASES: [string, string][] = [
  // Whole numbers, fractions, mixed numbers, decimals.
  ["2 cups flour", "2 | cup | flour | ·"],
  ["1/2 cup sugar", "0.5 | cup | sugar | ·"],
  ["2 1/4 cup flour", "2.25 | cup | flour | ·"],
  ["1-1/2 cups milk", "1.5 | cup | milk | ·"],
  ["1 and 1/2 cups milk", "1.5 | cup | milk | ·"],
  ["1.5 cups milk", "1.5 | cup | milk | ·"],
  [".5 cup water", "0.5 | cup | water | ·"],
  ["1,5 kg potatoes", "1.5 | kilogram | potatoes | ·"],
  // Unicode fractions, joined or spaced, and the fraction slash.
  ["½ cup sugar", "0.5 | cup | sugar | ·"],
  ["1½ cups (190 g) flour, sifted", "1.5 | cup | flour | sifted | + alternate 190 gram"],
  ["1 ½ cups (190 g) flour, sifted", "1.5 | cup | flour | sifted | + alternate 190 gram"],
  ["¾ teaspoon baking soda", "0.75 | teaspoon | baking soda | ·"],
  ["⅓ cup honey", "0.333 | cup | honey | ·"],
  ["1⁄2 teaspoon salt", "0.5 | teaspoon | salt | ·"],
  ["2 ⅔ cups oats", "2.667 | cup | oats | ·"],
  // Ranges.
  ["2–3 large eggs", "2-3 | · | large eggs | ·"],
  ["2-3 tablespoons butter", "2-3 | tablespoon | butter | ·"],
  ["2 to 3 cups stock", "2-3 | cup | stock | ·"],
  ["1/2-3/4 cup buttermilk", "0.5-0.75 | cup | buttermilk | ·"],
  ["1 ½–2 pounds chicken thighs", "1.5-2 | pound | chicken thighs | ·"],
  ["3 or 4 sprigs thyme", "3-4 | sprig | thyme | ·"],
  // Words.
  ["One onion, chopped", "1 | · | onion | chopped"],
  [
    "Two 28-ounce cans good-quality peeled whole plum tomatoes, crushed",
    "2 | can | good-quality peeled whole plum tomatoes | crushed | + size 28 ounce",
  ],
  ["a 14-oz can coconut milk", "1 | can | coconut milk | · | + size 14 ounce"],
  ["half a cup of cream", "0.5 | cup | cream | ·"],
  ["a couple of eggs", "2 | · | eggs | ·"],
  ["a few sprigs of thyme", "· | · | a few sprigs of thyme | ·"],
  ["A pinch of salt", "· | pinch | salt | ·"],
  ["Pinch crushed red pepper flakes, optional", "· | pinch | crushed red pepper flakes | optional"],
  ["a dash of hot sauce", "· | dash | hot sauce | ·"],
  ["2 pinches nutmeg", "2 | pinch | nutmeg | ·"],
  ["a handful of basil leaves", "· | handful | basil leaves | ·"],
  ["a dozen eggs", "1 | dozen | eggs | ·"],
  ["4 doz. cookies", "4 | dozen | cookies | ·"],
  // Abbreviations, and "t" against "T".
  ["1 tsp. vanilla", "1 | teaspoon | vanilla | ·"],
  ["1 t salt", "1 | teaspoon | salt | ·"],
  ["1 T sugar", "1 | tablespoon | sugar | ·"],
  ["2 Tbsp olive oil", "2 | tablespoon | olive oil | ·"],
  ["2 tbs. butter", "2 | tablespoon | butter | ·"],
  ["1 C walnuts", "1 | cup | walnuts | ·"],
  ["2 c. milk", "2 | cup | milk | ·"],
  ["8 oz. cream cheese, softened", "8 | ounce | cream cheese | softened"],
  ["1 lb ground beef", "1 | pound | ground beef | ·"],
  ["2 lbs. potatoes", "2 | pound | potatoes | ·"],
  ["1# butter", "1 | pound | butter | ·"],
  ["200g caster sugar", "200 | gram | caster sugar | ·"],
  ["200 gr dark chocolate", "200 | gram | dark chocolate | ·"],
  ["1kg beef chuck", "1 | kilogram | beef chuck | ·"],
  ["250ml whole milk", "250 | milliliter | whole milk | ·"],
  ["250 mL double cream", "250 | milliliter | double cream | ·"],
  ["1 l chicken stock", "1 | liter | chicken stock | ·"],
  ["1.5 litres water", "1.5 | liter | water | ·"],
  ["2 dl cream", "2 | deciliter | cream | ·"],
  ["4 fl oz orange juice", "4 | fluid ounce | orange juice | ·"],
  ["4 fl. oz. rum", "4 | fluid ounce | rum | ·"],
  ["1 pt heavy cream", "1 | pint | heavy cream | ·"],
  ["1 qt. buttermilk", "1 | quart | buttermilk | ·"],
  ["1 gallon water", "1 | gallon | water | ·"],
  ["500 mg ascorbic acid", "500 | milligram | ascorbic acid | ·"],
  // Weights and volumes said two ways.
  ["1 cup (240 ml) milk", "1 | cup | milk | · | + alternate 240 milliliter"],
  ["1 cup/240 ml milk", "1 | cup | milk | · | + alternate 240 milliliter"],
  [
    "6 ounces (about 3/4 cup) cool water, 70 degrees F",
    "6 | ounce | cool water | 70 degrees F | + alternate 0.75 cup",
  ],
  [
    "1 pound 4 ounces (about 5 cups) unbleached white bread flour, plus extra for dusting",
    "1.25 | pound | unbleached white bread flour | plus extra for dusting | + alternate 5 cup",
  ],
  ["1 cup 2 tablespoons flour", "1.125 | cup | flour | ·"],
  ["1 cup plus 2 tablespoons sugar", "1.125 | cup | sugar | ·"],
  ["1 cup + ¼ cup chicken broth", "1.25 | cup | chicken broth | ·"],
  ["1 cup plus more for dusting", "1 | cup | plus more for dusting | ·"],
  [
    "1 ounce (1 tablespoon) food-grade lye or 2 egg yolks mixed with a teaspoon of water",
    "1 | ounce | food-grade lye or 2 egg yolks mixed with a teaspoon of water | · | + alternate 1 tablespoon",
  ],
  [
    "225g (1 cup) unsalted butter, softened",
    "225 | gram | unsalted butter | softened | + alternate 1 cup",
  ],
  // Package sizes.
  [
    "1 (14-ounce) can black beans, drained and rinsed",
    "1 | can | black beans | drained and rinsed | + size 14 ounce",
  ],
  ["1 (8 oz) frozen whipped topping", "1 | · | frozen whipped topping | · | + size 8 ounce"],
  ["1 (1 lb 5 oz) can cherry pie filling", "1 | can | cherry pie filling | · | + size 1.313 pound"],
  ["2 x 400g tins chopped tomatoes", "2 | can | chopped tomatoes | · | + size 400 gram"],
  ["2 (15 oz.) cans chickpeas", "2 | can | chickpeas | · | + size 15 ounce"],
  [
    "1 1/4-ounce envelope active dry yeast",
    "1 | envelope | active dry yeast | · | + size 0.25 ounce",
  ],
  ["1 (2-inch) piece fresh ginger, peeled", "1 | piece | fresh ginger | peeled | + size 2 inch"],
  ["1-inch piece ginger, grated", "· | piece | ginger | grated | + size 1 inch"],
  // Found in a real Paprika library (phase E2).
  ["One 15-ounce tub whole-milk ricotta", "1 | tub | whole-milk ricotta | · | + size 15 ounce"],
  [
    "1 8-ounce block cream cheese, cut into pieces",
    "1 | block | cream cheese | cut into pieces | + size 8 ounce",
  ],
  [
    "1 16 oz container creamy peanut butter",
    "1 | container | creamy peanut butter | · | + size 16 ounce",
  ],
  [
    "One 28- to 32-ounce bag frozen hash brown potatoes",
    "1 | bag | frozen hash brown potatoes | · | + size 28-32 ounce",
  ],
  [
    "1 4- to 5-pound chicken, cut into ten pieces",
    "1 | · | chicken | cut into ten pieces | + size 4-5 pound",
  ],
  ["1 12-to-14-pound fresh turkey", "1 | · | fresh turkey | · | + size 12-14 pound"],
  ["Three 15‐ounce cans crushed tomatoes", "3 | can | crushed tomatoes | · | + size 15 ounce"],
  [
    "two 4-ounce (226g) semi-sweet chocolate bars, coarsely chopped",
    "2 | · | semi-sweet chocolate bars | coarsely chopped | + size 4 ounce | + alternate 226 gram",
  ],
  [
    '2 1½"-thick New York strip steaks (about 1½ lb. total)',
    "2 | · | thick New York strip steaks | about 1½ lb. total | + size 1.5 inch | + other 1.5 pound",
  ],
  [
    "8 tablespoons 1 stick unsalted butter, room temperature (113g)",
    "8 | tablespoon | unsalted butter | room temperature; 113g | + alternate 1 stick | + other 113 gram",
  ],
  ["10 ounces, weight (2 Sleeves) Graham Crackers", "10 | ounce | Graham Crackers | 2 Sleeves"],
  ["1 cup, loosely packed steamed white rice", "1 | cup | loosely packed steamed white rice | ·"],
  ["3 tablespoons 2% milk", "3 | tablespoon | 2% milk | ·"],
  ["3 pounds 80/20 ground beef", "3 | pound | 80/20 ground beef | ·"],
  [
    "10 cups (1250g) 1/4-inch-thick apple slices (about 8 large peeled and cored apples)*",
    "10 | cup | 1/4-inch-thick apple slices | about 8 large peeled and cored apples | + alternate 1250 gram | + other 0.25 inch",
  ],
  [
    "1 loaf French bread, cut into ¼-inch slices",
    "1 | loaf | French bread | cut into ¼-inch slices | + other 0.25 inch",
  ],
  // Count units.
  ["3 cloves garlic, minced", "3 | clove | garlic | minced"],
  ["2 large garlic cloves, minced", "2 | · | large garlic cloves | minced"],
  [
    "1 bunch lacinato kale, stems removed, cut into ribbons",
    "1 | bunch | lacinato kale | stems removed, cut into ribbons",
  ],
  ["1 sprig basil", "1 | sprig | basil | ·"],
  ["2 sticks butter, softened", "2 | stick | butter | softened"],
  ["4 slices bacon", "4 | slice | bacon | ·"],
  ["2 stalks celery, diced", "2 | stalk | celery | diced"],
  ["1 head garlic", "1 | head | garlic | ·"],
  ["6 drops red food coloring", "6 | drop | red food coloring | ·"],
  ["1 pkg. cream cheese", "1 | package | cream cheese | ·"],
  ["1 jar marinara sauce", "1 | jar | marinara sauce | ·"],
  ["2 sheets puff pastry, thawed", "2 | sheet | puff pastry | thawed"],
  // Plain counts and sizes.
  ["1 large egg, lightly beaten", "1 | · | large egg | lightly beaten"],
  ["3 eggs", "3 | · | eggs | ·"],
  ["1 small onion, diced", "1 | · | small onion | diced"],
  ["8 green cardamom pods", "8 | · | green cardamom pods | ·"],
  ["2 medium carrots, peeled and sliced", "2 | · | medium carrots | peeled and sliced"],
  ["12 jumbo shrimp, peeled and deveined", "12 | · | jumbo shrimp | peeled and deveined"],
  // Not "can" in "candied", not "T" in "Tomatoes".
  ["1 candied cherry", "1 | · | candied cherry | ·"],
  ["2 Tomatoes, quartered", "2 | · | Tomatoes | quartered"],
  ["2 cupcakes", "2 | · | cupcakes | ·"],
  ["3 large Gala apples", "3 | · | large Gala apples | ·"],
  // Notes: commas, parentheses, dashes.
  ["1 cup Crispy Chickpeas (page 102), crushed", "1 | cup | Crispy Chickpeas | crushed; page 102"],
  [
    "1 recipe Raisin Brioche Dough, minus raisins (see page 120)",
    "1 | · | recipe Raisin Brioche Dough | minus raisins; see page 120",
  ],
  [
    "3 tablespoons grated Parmigiano-Reggiano, plus more for topping",
    "3 | tablespoon | grated Parmigiano-Reggiano | plus more for topping",
  ],
  ["1 cup walnuts (optional)", "1 | cup | walnuts | optional"],
  ["2 cups spinach - roughly chopped", "2 | cup | spinach | roughly chopped"],
  ["1/2 cup butter; melted", "0.5 | cup | butter | melted"],
  ["2 cups of flour", "2 | cup | flour | ·"],
  // Other amounts on the line.
  [
    "1/2 vanilla bean or 1 teaspoon vanilla extract",
    "0.5 | · | vanilla bean or 1 teaspoon vanilla extract | · | + other 1 teaspoon",
  ],
  [
    "2 ounces anchovies in olive oil, approximately 1/2 4.25-ounce can, finely chopped",
    "2 | ounce | anchovies in olive oil | approximately 1/2 4.25-ounce can, finely chopped | + other 4.25 ounce",
  ],
  ["Juice of 1 lemon", "· | · | Juice of 1 lemon | ·"],
  ["1 cup milk, warmed to 110°F", "1 | cup | milk | warmed to 110°F"],
  // No amount at all.
  [
    "Kosher salt and freshly ground black pepper",
    "· | · | Kosher salt and freshly ground black pepper | ·",
  ],
  ["Salt, to taste", "· | · | Salt | to taste"],
  ["Freshly ground black pepper", "· | · | Freshly ground black pepper | ·"],
  ["Vegetable oil, for frying", "· | · | Vegetable oil | for frying"],
  ["Avocado", "· | · | Avocado | ·"],
  ["An onion", "1 | · | onion | ·"],
  ["", "· | · | · | ·"],
  ["3", "· | · | 3 | ·"],
  // "About" before the amount.
  ["about 2 cups chicken stock", "2 | cup | chicken stock | ·"],
  ["approximately 1 pound green beans", "1 | pound | green beans | ·"],
];

describe("reading ingredient lines", () => {
  it.each(CASES)("%s", (line, expected) => {
    expect(summary(line)).toBe(expected);
  });

  it("records where each amount is written, so scaling can change it in place", () => {
    const line = "1 ½ cups (190 g) flour, sifted";
    const r = readIngredient(line);
    expect(r.amounts.map((a) => line.slice(a.start, a.end))).toEqual(["1 ½ cups", "190 g"]);
    const cans = "Two 28-ounce cans tomatoes";
    expect(readIngredient(cans).amounts.map((a) => cans.slice(a.start, a.end))).toEqual([
      "Two",
      "28-ounce",
    ]);
    const other = "1/2 vanilla bean or 1 teaspoon vanilla extract";
    expect(readIngredient(other).amounts.map((a) => other.slice(a.start, a.end))).toEqual([
      "1/2",
      "1 teaspoon",
    ]);
  });

  it("marks approximate amounts", () => {
    const r = readIngredient("6 ounces (about 3/4 cup) cool water");
    expect(r.amounts.map((a) => a.approximate)).toEqual([false, true]);
    expect(readIngredient("about 2 cups stock").amounts[0]?.approximate).toBe(true);
  });

  it("places every amount inside the line, in order, without overlaps", () => {
    for (const [line] of CASES) {
      let after = 0;
      for (const a of readIngredient(line).amounts) {
        expect(a.start, line).toBeGreaterThanOrEqual(after);
        expect(a.end, line).toBeGreaterThan(a.start);
        expect(a.end, line).toBeLessThanOrEqual(line.length);
        after = a.end;
      }
    }
  });

  it("never throws, whatever it's given", () => {
    for (const line of [
      "((((",
      "1/0 cup",
      "1 - - 2",
      "½½½",
      "x x x",
      "1 (",
      "9".repeat(400),
      "🍰 2 cups",
    ]) {
      expect(() => readIngredient(line)).not.toThrow();
    }
  });
});

describe("units", () => {
  it("gives every volume and weight a size, for converting", () => {
    for (const u of UNITS.filter((u) => u.kind === "volume" || u.kind === "weight")) {
      expect(u.base, u.name).toBeGreaterThan(0);
    }
  });

  it("spells each unit only one way", () => {
    const seen = new Map<string, string>();
    for (const u of UNITS) {
      for (const w of u.words) {
        expect(seen.get(w.toLowerCase()), w).toBeUndefined();
        seen.set(w.toLowerCase(), u.name);
      }
    }
  });
});

describe("standard abbreviations (owner's choice 2026-10-21)", () => {
  it.each([
    ["1/2 teas salt", "1/2 tsp salt"],
    ["4 teasp. grated cheese", "4 tsp grated cheese"],
    ["1T butter", "1 Tbsp butter"],
    ["1 Tbs. butter", "1 Tbsp butter"],
    ["2C rich milk", "2 cups rich milk"],
    ["1 c nuts", "1 cup nuts"],
    ["1/4 C walnuts", "1/4 cup walnuts"],
    ["1½c peanut butter", "1½ cups peanut butter"],
    ["1 1/2 lbs beef", "1 1/2 lb beef"],
    ["8-oz can tomatoes", "8-oz can tomatoes"],
    // Written out in full, or not one of these units: as written.
    ["2 cups sugar", "2 cups sugar"],
    ["1 teaspoon salt", "1 teaspoon salt"],
    ["1/2 pound mushrooms", "1/2 pound mushrooms"],
    ["4 tins tomatoes", "4 tins tomatoes"],
    ["few drops onion juice", "few drops onion juice"],
    // "Soda" by the spoon is baking soda; a drink stays one.
    ["1/2 t soda", "1/2 tsp baking soda"],
    ["1 tsp. Soda, sifted", "1 tsp Baking soda, sifted"],
    ["pinch of soda", "pinch of baking soda"],
    ["1 can soda", "1 can soda"],
    ["1 c club soda", "1 cup club soda"],
    ["1 tsp baking soda", "1 tsp baking soda"],
  ])("%s", (written, standard) => {
    expect(standardIngredient(written)).toBe(standard);
  });

  it("keeps a full stop that ends a sentence in a step", () => {
    expect(standardUnits("Add 2 C. Stir well.", "step")).toBe("Add 2 cups. Stir well.");
    expect(standardUnits("Add 1/2 tsp. salt and mix", "step")).toBe("Add 1/2 tsp salt and mix");
    expect(standardUnits("Bake at 350 for 1 hr.", "step")).toBe("Bake at 350 for 1 hr.");
    expect(standardUnits("Drop by teaspoon on waxed paper.", "step")).toBe(
      "Drop by teaspoon on waxed paper.",
    );
  });
});
