import { describe, expect, it } from "vitest";
import { tidyFractions, tidyTemperatures, tidyText } from "./tidy";

describe("tidyFractions", () => {
  it.each([
    ["1 1/2 cups flour", "1½ cups flour"],
    ["1-1/2 cups flour", "1½ cups flour"],
    ["1 and 1/2 cups apples (1/2 inch chunks)", "1½ cups apples (½ inch chunks)"],
    ["2 1⁄4 teaspoons yeast", "2¼ teaspoons yeast"],
    ["1/2 cup sugar", "½ cup sugar"],
    ["1⁄3 cup oil", "⅓ cup oil"],
    ["1 ½ cups milk", "1½ cups milk"],
    ["3/4 to 1 cup water", "¾ to 1 cup water"],
    ["Bake 1 1/2 to 2 hours.", "Bake 1½ to 2 hours."],
    ["one 2 1/2-inch piece ginger", "one 2½-inch piece ginger"],
  ])("%s → %s", (input, output) => {
    expect(tidyFractions(input)).toBe(output);
  });

  it.each([
    "Made 1/2/2026",
    "11/24 by the oven clock",
    "a 9/13 pan",
    "1/2.5 ratio",
    "24/7",
    "2 1/9 is odd",
    "½ cup already tidy",
  ])("leaves %s alone", (input) => {
    expect(tidyFractions(input)).toBe(input);
  });
});

describe("tidyTemperatures", () => {
  it.each([
    ["Preheat to 350 degrees F.", "Preheat to 350°F."],
    ["Preheat to 350 degrees Fahrenheit", "Preheat to 350°F"],
    ["Heat oven to 180 degrees C (350 degrees F)", "Heat oven to 180°C (350°F)"],
    ["Bake at 425° F until golden", "Bake at 425°F until golden"],
    ["Bake at 425 ºF", "Bake at 425°F"],
    ["Bake at 400 deg. F", "Bake at 400°F"],
    ["Oven at 375F", "Oven at 375°F"],
    ["Oven at 220 C, fan 200 C", "Oven at 220°C, fan 200°C"],
    ["Heat to 160 degrees celsius", "Heat to 160°C"],
  ])("%s → %s", (input, output) => {
    expect(tidyTemperatures(input)).toBe(output);
  });

  it.each([
    "2 C flour",
    "Bake at 350 degrees for 20 minutes",
    "Cook 15 degrees covered",
    "Add 2 c sugar",
    "Use a 12F pan",
  ])("leaves %s alone", (input) => {
    expect(tidyTemperatures(input)).toBe(input);
  });
});

it("tidyText does both", () => {
  expect(tidyText("Add 1 1/2 cups milk; bake at 350 degrees F.")).toBe(
    "Add 1½ cups milk; bake at 350°F.",
  );
});
