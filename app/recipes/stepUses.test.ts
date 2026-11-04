import { describe, expect, it } from "vitest";
import { directionsFromText, ingredientsFromText } from "../../shared/recipeLines";
import type { ShownLine, ShowOptions } from "../../shared/scale";
import { stepIngredients } from "../../shared/stepIngredients";
import { shownUses } from "./stepUses";

// U14: the ingredients under each step, in words, scaled and converted as the page shows them.

const text = (line: ShownLine) => line.pieces.map((p) => p.text).join("");
const changed = (line: ShownLine) =>
  line.pieces
    .filter((p) => p.changed)
    .map((p) => p.text)
    .join("|");

function shown(
  ingredients: string,
  directions: string,
  options: Partial<ShowOptions> & { short?: boolean; capital?: boolean; held?: string[] } = {},
) {
  let n = 0;
  const lines = ingredientsFromText(ingredients, [], () => `i${n++}`);
  let m = 0;
  const steps = directionsFromText(directions, [], () => `s${m++}`);
  const map = stepIngredients(lines, steps);
  const scaling = {
    factor: options.factor ?? 1,
    units: options.units ?? "written",
    held: new Set(options.held ?? []),
  };
  return steps.map((step) =>
    shownUses(map.get(step.id) ?? [], {
      step,
      lines,
      steps,
      scaling,
      short: options.short ?? false,
      capital: options.capital ?? false,
    }),
  );
}

const SNICKERDOODLES = [
  "1 cup sugar, divided\n1/2 cup butter, softened\n1 large egg",
  "Beat the butter and 3/4 cup of the sugar until fluffy. Beat in the egg.\nMix the remaining sugar with the cinnamon.",
] as const;

describe("a step's ingredients in words", () => {
  it("as written: the step's own amount, the rest worked out", () => {
    const [first, second] = shown(...SNICKERDOODLES);
    expect(first?.map((u) => text(u.line))).toEqual([
      "1/2 cup butter, softened",
      "3/4 cup sugar",
      "1 large egg",
    ]);
    expect(second?.map((u) => text(u.line))).toEqual(["the remaining ¼ cup sugar"]);
    expect(second?.[0]?.unsure).toBeNull();
  });

  it("doubled: the step's amount as the step shows it, the rest scaled, both highlighted", () => {
    const [first, second] = shown(...SNICKERDOODLES, { factor: 2 });
    expect(text(first?.[1]?.line ?? { pieces: [], changed: false })).toBe("1 1/2 cups sugar");
    expect(changed(first?.[1]?.line ?? { pieces: [], changed: false })).toBe("1 1/2 cups");
    expect(text(second?.[0]?.line ?? { pieces: [], changed: false })).toBe(
      "the remaining ½ cup sugar",
    );
    expect(changed(second?.[0]?.line ?? { pieces: [], changed: false })).not.toBe("");
  });

  it("in metric, the rest in words: rounded amounts wouldn't add up to the line", () => {
    // ¾ cup is shown as 175 ml and 1 cup as 235 ml, so "the remaining 59 ml" would be off.
    const [first, second] = shown(...SNICKERDOODLES, { units: "metric" });
    expect(text(first?.[1]?.line ?? { pieces: [], changed: false })).toMatch(/^\d+ ml sugar$/u);
    expect(text(second?.[0]?.line ?? { pieces: [], changed: false })).toBe("the remaining sugar");
    // A line nobody converts keeps its worked-out amount.
    const [, metric] = shown(
      "200 g sugar, divided\n1 egg",
      "Beat the egg with 150 g of the sugar.\nSprinkle with the remaining sugar.",
      { units: "metric" },
    );
    expect(text(metric?.[0]?.line ?? { pieces: [], changed: false })).toBe(
      "the remaining 50 g sugar",
    );
  });

  it("a line kept as written stays as written", () => {
    const [first] = shown("2 cups flour\n1 cup milk", "Whisk the flour and milk.", {
      factor: 2,
      held: ["i0"],
    });
    expect(first?.map((u) => text(u.line))).toEqual(["2 cups flour", "2 cups milk"]);
  });

  it("says when it isn't sure, in words", () => {
    const [, second] = shown(
      "1 cup sugar, divided\n2 eggs",
      "Beat the eggs.\nAdd the sugar gradually.",
    );
    expect(text(second?.[0]?.line ?? { pieces: [], changed: false })).toBe(
      "some of the 1 cup sugar",
    );
    expect(second?.[0]?.unsure).toEqual({
      short: "not sure how much",
      long: "Not sure how much: the recipe doesn't say",
    });
    const [cheese] = shown(
      "1 cup shredded cheddar cheese\n1/2 cup grated Parmesan cheese",
      "Sprinkle with the cheese.",
      { capital: true },
    );
    expect(text(cheese?.[0]?.line ?? { pieces: [], changed: false })).toBe("Cheese");
    expect(cheese?.[0]?.unsure?.long).toBe("Not sure which: cheddar or Parmesan");
  });

  it("a little of the butter in the step's words, and a mixture from its step", () => {
    const [first, second] = shown(
      "4 tablespoons butter\n2 cups flour\n1 tsp salt",
      "Grease the pan with a little of the butter. Whisk the flour and salt.\nAdd the flour mixture.",
      { capital: true },
    );
    expect(text(first?.[0]?.line ?? { pieces: [], changed: false })).toBe("A little of the butter");
    expect(first?.[0]?.unsure).toBeNull();
    expect(text(second?.[0]?.line ?? { pieces: [], changed: false })).toBe("The flour mixture");
    expect(second?.[0]?.from?.number).toBe(1);
  });

  it("in cook mode, the amount and the name, without how it's cut", () => {
    const words = (ingredients: string, step: string) =>
      (shown(ingredients, step, { short: true })[0] ?? []).map((u) => text(u.line));
    expect(words("2 lb pork shoulder, cut into 1-inch cubes", "Season the pork.")).toEqual([
      "2 lb pork shoulder",
    ]);
    // Not "4 boneless": the name comes after the comma.
    expect(
      words(
        "4 boneless, skinless chicken breasts (about 1½ pounds), halved horizontally",
        "Season the chicken.",
      ),
    ).toEqual(["4 boneless, skinless chicken breasts (about 1½ pounds)"]);
    expect(words("350 grams (just over 12 ounces) bread flour, sifted", "Mix the flour.")).toEqual([
      "350 grams (just over 12 ounces) bread flour",
    ]);
  });
});

/** The words of each step's uses, at a scale. */
const at = (
  ingredients: string,
  directions: string,
  options: Partial<ShowOptions> & { held?: string[] } = {},
) => shown(ingredients, directions, options).map((step) => step.map((u) => text(u.line)));

describe("a step's ingredients add up at every scale (reviewers' cases, 2026-11-04)", () => {
  it("counts the step writes stay as written, so the rest is in words once scaled", () => {
    const eggs = [
      "4 eggs, divided\n1 cup milk",
      "Beat 2 of the eggs with the milk.\nAdd the remaining eggs.",
    ] as const;
    expect(at(...eggs)).toEqual([["2 eggs", "1 cup milk"], ["the remaining 2 eggs"]]);
    // Halved, "2 of the eggs" is still 2 in the step, and 2 is all of them: no sum to show.
    expect(at(...eggs, { factor: 0.5 })).toEqual([
      ["2 eggs", "1/2 cup milk"],
      ["the remaining eggs"],
    ]);
    expect(at(...eggs, { factor: 2 })[1]).toEqual(["the remaining eggs"]);
  });

  it("measures the step writes scale with the line, so the rest is worked out scaled", () => {
    expect(at(...SNICKERDOODLES, { factor: 2 })[1]).toEqual(["the remaining ½ cup sugar"]);
  });

  it("a line kept as written while the step's measures scale: the rest in words", () => {
    expect(
      at(
        "1/2 cup sugar, divided\n2 eggs",
        "Beat 3 tablespoons of the sugar with the eggs.\nAdd the remaining sugar.",
        { factor: 2, held: ["i0"] },
      ),
    ).toEqual([["6 tablespoons sugar", "4 eggs"], ["the remaining sugar"]]);
  });

  it("one piece's amount is shown as the step shows it, with what it's for", () => {
    expect(
      at(
        "1/2 cup jam\n2 cups flour",
        "Shape the dough into 24 balls. Press 1 teaspoon of the jam into each ball.",
        { factor: 2 },
      ),
    ).toEqual([["1 teaspoon of the jam into each ball"]]);
  });

  it("units and names read as a cook writes them: 2 tbsp, 1 egg", () => {
    expect(
      at(
        "4 tbsp. butter, divided\n4 tsp vanilla, divided",
        "Add 1 tbsp. of the butter and 2 tsp of the vanilla.\nAdd the remaining butter and vanilla.",
      )[1],
    ).toEqual(["the remaining 3 tbsp. butter", "the remaining 2 tsp vanilla"]);
    expect(
      at("3 eggs\n1 cup flour", "Beat 2 eggs with the flour.\nBrush with the remaining egg.")[1],
    ).toEqual(["the remaining 1 egg"]);
  });

  it('"some of" an amount that\'s only about says so in its own words', () => {
    expect(
      at("About 2 cups sugar, divided", "Add the sugar gradually.\nAdd the remaining sugar.")[0],
    ).toEqual(["some of the sugar (about 2 cups)"]);
  });

  it("the same mixture named twice in a step is one use", () => {
    expect(
      at(
        "2 cups flour\n1 tsp salt\n1 cup milk",
        "Whisk the flour and salt.\nAdd half the flour mixture, then the milk, then the rest of the flour mixture.",
      )[1],
    ).toEqual(["half the flour mixture", "1 cup milk", "the rest of the flour mixture"]);
  });
});
