import { describe, expect, it } from "vitest";
import type { IngredientLine } from "./recipe";
import {
  cleanLine,
  directionsFromText,
  ingredientsFromText,
  looksLikeHeading,
  setHeading,
  textFromLines,
} from "./recipeLines";

/** Predictable IDs: id-1, id-2, … */
function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

// Real ingredient lines from the owner's Paprika library (shared with permission, 2026-10-07).
const PAPRIKA_FAJITAS = `4 tablespoons vegetable oil, divided
2 tablespoons lemon juice
1½  teaspoons dried oregano
¾ -1 teaspoon chili powder
6 flour tortillas (8 inch), warmed
Shredded cheddar cheese
Sour cream

AVOCADO CREMA:
¼ cup light sour cream
½ - ¾ of a lemon, juiced
S & P to taste`;

describe("headings", () => {
  it("are lines ending in a colon, or short ALL-CAPS lines, without an amount", () => {
    for (const heading of [
      "AVOCADO CREMA:",
      "For the crust:",
      "THIS IS ALL YOU’LL NEED:",
      "CHICKEN",
      "TACOS",
      "TO MAKE AVOCADO CREMA:",
    ]) {
      expect(looksLikeHeading(heading), heading).toBe(true);
    }
    for (const line of [
      "S & P to taste",
      "Kosher salt",
      "¼ cup + 3 tablespoons chili powder",
      "1 8 ounce can tomato sauce",
      "FOR THE GRAVY: Toast chiles and cumin in 12-inch skillet",
      "Juice of 1 lemon",
    ]) {
      expect(looksLikeHeading(line), line).toBe(false);
    }
  });
});

describe("cleaning pasted lines", () => {
  it("removes bullets, checkboxes and step numbers, but never amounts", () => {
    expect(cleanLine("• 2 cups flour", "ingredients")).toBe("2 cups flour");
    expect(cleanLine("▢ 1 teaspoon salt  ", "ingredients")).toBe("1 teaspoon salt");
    expect(cleanLine("- 1 onion", "ingredients")).toBe("1 onion");
    expect(cleanLine("1 - 2 cups cheddar cheese", "ingredients")).toBe("1 - 2 cups cheddar cheese");
    expect(cleanLine("2. Cut the avocado in half", "directions")).toBe("Cut the avocado in half");
    expect(cleanLine("Step 3: Bake", "directions")).toBe("Bake");
    expect(cleanLine("350 degrees is right", "directions")).toBe("350 degrees is right");
    // Ingredients keep their numbers: "2. " isn't a step number there.
    expect(cleanLine("2 ripe Hass avocados", "ingredients")).toBe("2 ripe Hass avocados");
  });
});

describe("ingredients from the text box", () => {
  it("make one line each, with headings, and give the same text back", () => {
    const lines = ingredientsFromText(PAPRIKA_FAJITAS, [], ids());
    expect(lines).toHaveLength(11);
    expect(lines.filter((l) => l.heading).map((l) => l.text)).toEqual(["AVOCADO CREMA:"]);
    expect(lines[2]!.text).toBe("1½  teaspoons dried oregano");
    // Blank lines go; everything else comes back exactly.
    expect(textFromLines(lines)).toBe(PAPRIKA_FAJITAS.replace("\n\n", "\n"));
  });

  it("keep IDs and links for lines that are still there, even edited or moved", () => {
    const first = ingredientsFromText("1 cup BBQ sauce\n2 pounds ribs\nSalt", [], ids());
    const linked: IngredientLine[] = first.map((l) =>
      l.text === "1 cup BBQ sauce"
        ? {
            ...l,
            linkedRecipeId: "8a1b2c3d-0000-4000-8000-000000000001",
            parsed: {
              quantity: { low: 1, high: null },
              unit: "cup",
              item: "BBQ sauce",
              note: null,
            },
          }
        : l,
    );
    const next = ingredientsFromText(
      "Salt\n1½ cups BBQ sauce\n2 pounds ribs\n1 lemon",
      linked,
      () => "new",
    );
    const sauce = next.find((l) => l.text === "1½ cups BBQ sauce")!;
    expect(sauce.id).toBe(first[0]!.id);
    expect(sauce.linkedRecipeId).toBe("8a1b2c3d-0000-4000-8000-000000000001");
    // The amount changed, so it's read again.
    expect(sauce.parsed).toBeUndefined();
    expect(next.find((l) => l.text === "2 pounds ribs")!.id).toBe(first[1]!.id);
    expect(next.find((l) => l.text === "Salt")!.id).toBe(first[2]!.id);
    expect(next.find((l) => l.text === "1 lemon")!.id).toBe("new");
  });

  it("drop the link when its line is deleted or rewritten", () => {
    const first = ingredientsFromText("1 cup BBQ sauce\n2 pounds ribs", [], ids());
    const linked = first.map((l, i) =>
      i === 0 ? { ...l, linkedRecipeId: "8a1b2c3d-0000-4000-8000-000000000001" } : l,
    );
    expect(ingredientsFromText("2 pounds ribs", linked).some((l) => l.linkedRecipeId)).toBe(false);
    const rewritten = ingredientsFromText(
      "A splash of hot sauce\n2 pounds ribs",
      linked,
      () => "x",
    );
    expect(rewritten[0]).toEqual({ id: "x", text: "A splash of hot sauce", heading: false });
  });

  it("keep a heading chosen with the heading button", () => {
    const first = ingredientsFromText("Spice rub\n1 tablespoon paprika", [], ids());
    const marked = setHeading(first, first[0]!.id, true);
    const again = ingredientsFromText("Spice rubs\n1 tablespoon paprika", marked);
    expect(again[0]).toMatchObject({ heading: true, headingByHand: true, id: first[0]!.id });
    // And the button can say "not a heading" for a line that looks like one.
    const unmarked = setHeading(again, again[0]!.id, false);
    expect(ingredientsFromText("SPICE RUBS\n1 tablespoon paprika", unmarked)[0]!.heading).toBe(
      false,
    );
  });
});

describe("directions from the text box", () => {
  it("drop step numbers and blank lines, and find headings", () => {
    const text =
      "FOR THE CHICKEN: \n\n1. Pat chicken dry with paper towels.\n\n2. Heat oil in a Dutch oven.\n\nTO MAKE AVOCADO CREMA:\n\nDice and combine all ingredients.";
    const steps = directionsFromText(text, [], ids());
    expect(steps.map((s) => [s.text, s.heading])).toEqual([
      ["FOR THE CHICKEN:", true],
      ["Pat chicken dry with paper towels.", false],
      ["Heat oil in a Dutch oven.", false],
      ["TO MAKE AVOCADO CREMA:", true],
      ["Dice and combine all ingredients.", false],
    ]);
  });
});
