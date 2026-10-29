import { describe, expect, it } from "vitest";
import { clockText, durationText, stepIngredients, stepTimes, timerName } from "./cook";
import type { DirectionStep, IngredientLine } from "./recipe";

// Phase F5: cook mode.

const lines = (text: string): IngredientLine[] =>
  text.split("\n").map((t, i) => ({ id: `i${i}`, text: t, heading: t.endsWith(":") }));
const steps = (text: string): DirectionStep[] =>
  text.split("\n").map((t, i) => ({ id: `s${i}`, text: t, heading: false }));

const used = (ingredients: string, method: string) => {
  const map = stepIngredients(steps(method), lines(ingredients));
  return [...map.values()].map((list) => list.map((l) => l.text));
};

describe("the ingredients each step uses", () => {
  it("finds them by name in the step", () => {
    expect(
      used(
        `2 cups all-purpose flour
2 tablespoons sugar
2 teaspoons baking powder
½ teaspoon baking soda
½ teaspoon salt
2 cups buttermilk
2 large eggs
3 tablespoons butter, melted, plus more for the pan`,
        `Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.
In another bowl, whisk the buttermilk, eggs and melted butter.
Pour the wet ingredients into the dry and stir just until combined.`,
      ),
    ).toEqual([
      [
        "2 cups all-purpose flour",
        "2 tablespoons sugar",
        "2 teaspoons baking powder",
        "½ teaspoon baking soda",
        "½ teaspoon salt",
      ],
      ["2 cups buttermilk", "2 large eggs", "3 tablespoons butter, melted, plus more for the pan"],
      [],
    ]);
  });

  it("looks for the last word first, and the others only when no step names it", () => {
    expect(
      used(
        `For the stew:
2 lb pork shoulder, cut into 1-inch cubes
1 tablespoon salt, divided
Warm flour tortillas
1 cup flour`,
        `Season the pork with half the salt.
Dust with the flour.
Serve with warm tortillas and the rest of the salt.`,
      ),
    ).toEqual([
      ["2 lb pork shoulder, cut into 1-inch cubes", "1 tablespoon salt, divided"],
      ["1 cup flour"],
      ["1 tablespoon salt, divided", "Warm flour tortillas"],
    ]);
  });
});

describe("the times a step gives", () => {
  const times = (text: string) => stepTimes(text).map((t) => [t.text, t.seconds]);

  it("reads minutes, hours, seconds, ranges and words", () => {
    expect(times("Bake 25 to 30 minutes, until golden.")).toEqual([["25 to 30 minutes", 1500]]);
    expect(times("Simmer for 1 hour 15 minutes.")).toEqual([["1 hour 15 minutes", 4500]]);
    expect(times("Cover and simmer about 1½ hours. Rest 10 min.")).toEqual([
      ["1½ hours", 5400],
      ["10 min", 600],
    ]);
    expect(times("Stir for 30 seconds, then an hour more.")).toEqual([
      ["30 seconds", 30],
      ["an hour", 3600],
    ]);
    expect(times("Flip after 2 minutes, then cook 1 minute more.")).toEqual([
      ["2 minutes", 120],
      ["1 minute", 60],
    ]);
  });

  it("knows a range's other end, for a timer of either", () => {
    expect(stepTimes("Bake for 9-11 minutes.")[0]).toMatchObject({ seconds: 540, upTo: 660 });
    expect(stepTimes("Bake 25 to 30 minutes.")[0]).toMatchObject({ seconds: 1500, upTo: 1800 });
    expect(stepTimes("Simmer for 1 hour 15 minutes.")[0]?.upTo).toBeUndefined();
  });

  it("names a timer from its step, as the earlier Fennl did", () => {
    const name = (text: string, i = 0) => timerName(text, stepTimes(text)[i]!);
    expect(name("Bake for 9-11 minutes.")).toBe("Bake");
    expect(name("Bake 25 to 30 minutes or until golden.")).toBe("Bake until golden");
    expect(name("Add 2 cups water and simmer for 18 minutes, then rest 5 minutes.")).toBe(
      "Add 2 cups water and simmer",
    );
    expect(name("Add 2 cups water and simmer for 18 minutes, then rest 5 minutes.", 1)).toBe(
      "Rest",
    );
    expect(name("Preheat the oven. Bake about 25 minutes.")).toBe("Bake");
    expect(name("Let rise until doubled, about 1 hour.")).toBe("Let rise until doubled");
    expect(name("15 minutes")).toBe("15 minutes");
  });

  it("ignores what isn't a time", () => {
    expect(times("Heat to 350°F in a 9x13-inch pan with 2 eggs.")).toEqual([]);
  });

  it("writes a timer's time", () => {
    expect(clockText(1500)).toBe("25:00");
    expect(clockText(59.2)).toBe("1:00");
    expect(clockText(4500)).toBe("1:15:00");
    expect(clockText(-3)).toBe("0:00");
    expect(durationText(4500)).toBe("1 hour 15 minutes");
    expect(durationText(30)).toBe("30 seconds");
  });
});
