import { describe, expect, it } from "vitest";
import { draftIssues } from "./importDraft";
import { onlyWebAddress, readPastedText, type PastedRead } from "./pastedText";

const read = (text: string): PastedRead => readPastedText(text, () => crypto.randomUUID());
const recipeOf = (text: string) => {
  const result = read(text);
  if (result.kind !== "recipe") throw new Error(`expected a recipe, got ${result.kind}`);
  return result.draft;
};

const LAID_OUT = `Grandma's Banana Bread

Serves 8
Prep time: 15 minutes
Cook time: 1 hour

The loaf we make every Sunday.

Ingredients
- 3 ripe bananas
- 1/2 cup butter, melted
* 3/4 cup sugar
2 cups flour

Directions
1. Mash the bananas and stir in the butter and sugar.
2. Fold in the flour.
3. Bake at 350°F for 60 minutes.

Notes
Keeps three days wrapped.`;

describe("readPastedText", () => {
  it("reads a clearly laid out recipe", () => {
    const draft = recipeOf(LAID_OUT);
    expect(draftIssues(draft)).toEqual([]);
    expect(draft.source).toBe("text");
    expect(draft.producer).toEqual({ importer: "pasted-text", model: null });
    expect(draft.fields.title?.value).toBe("Grandma's Banana Bread");
    expect(draft.fields.ingredients?.value.map((l) => l.text)).toEqual([
      "3 ripe bananas",
      "1/2 cup butter, melted",
      "3/4 cup sugar",
      "2 cups flour",
    ]);
    expect(draft.fields.directions?.value.map((l) => l.text)).toEqual([
      "Mash the bananas and stir in the butter and sugar.",
      "Fold in the flour.",
      "Bake at 350°F for 60 minutes.",
    ]);
    expect(draft.fields.servings?.value.count).toBe(8);
    expect(draft.fields.times?.value.prep.minutes).toBe(15);
    expect(draft.fields.times?.value.cook.minutes).toBe(60);
    expect(draft.fields.description?.value).toBe("The loaf we make every Sunday.");
    expect(draft.fields.notes?.value).toBe("Keeps three days wrapped.");
    expect(draft.lineConfidence.ingredients).toEqual(["high", "high", "high", "high"]);
  });

  it("accepts markdown and upper-case headings, and either order of the two lists", () => {
    const draft = recipeOf(
      `# Quick Soup\n\n## DIRECTIONS:\nSimmer everything.\nServe.\n\n## INGREDIENTS:\n2 cups stock\n1 onion`,
    );
    expect(draft.fields.title?.value).toBe("Quick Soup");
    expect(draft.fields.ingredients?.value).toHaveLength(2);
    expect(draft.fields.directions?.value).toHaveLength(2);
  });

  it("keeps section headings inside a list as headings", () => {
    const draft = recipeOf(
      `Cake\n\nIngredients\nFor the cake:\n2 cups flour\n1 cup sugar\nFor the icing:\n1 cup powdered sugar\n\nMethod\nBake it.`,
    );
    const lines = draft.fields.ingredients?.value ?? [];
    expect(lines.map((l) => l.heading)).toEqual([true, false, false, true, false]);
  });

  it("takes a line written wholly in bold as a heading", () => {
    const draft = recipeOf(
      `Soup\n\nIngredients\n**For the soup**\n2 cups stock\n1 onion\n**To finish**\n1/2 cup cream\n\nDirections\nSimmer.`,
    );
    const lines = draft.fields.ingredients?.value ?? [];
    expect(lines.map((l) => [l.text, l.heading])).toEqual([
      ["For the soup", true],
      ["2 cups stock", false],
      ["1 onion", false],
      ["To finish", true],
      ["1/2 cup cream", false],
    ]);
  });

  it("takes the number in 'Makes 24 cookies' as the servings count", () => {
    const draft = recipeOf(LAID_OUT.replace("Serves 8", "Makes 24 cookies"));
    expect(draft.fields.servings?.value).toEqual({ count: 24, yield: "24 cookies" });
  });

  it("copes with Windows line endings and non-breaking spaces", () => {
    const draft = recipeOf(LAID_OUT.replace(/\n/g, "\r\n").replace("3 ripe", "3 ripe"));
    expect(draft.fields.ingredients?.value[0]?.text).toBe("3 ripe bananas");
  });

  it("turns a lone web address away, and never reads it as a recipe", () => {
    expect(read("  https://example.com/banana-bread\n")).toEqual({
      kind: "web_address",
      url: "https://example.com/banana-bread",
    });
    expect(onlyWebAddress("see https://example.com")).toBeNull();
    expect(onlyWebAddress("https://example.com/a b")).toBeNull();
  });

  it.each([
    ["no headings", "Mix 2 cups flour with 1 cup sugar and bake at 350 for 30 minutes."],
    [
      "two recipes",
      `A\n\nIngredients\n1 egg\n2 cups milk\nDirections\nWhisk.\n\nB\n\nIngredients\n1 pear\n2 cups sugar\nDirections\nPoach.`,
    ],
    ["no title", `Ingredients\n1 egg\n2 cups milk\nDirections\nWhisk.`],
    ["a single ingredient", `Eggs\n\nIngredients\n1 egg\nDirections\nBoil.`],
    ["empty directions", `Eggs\n\nIngredients\n1 egg\n2 cups milk\nDirections\n`],
    ["ingredients only", `Eggs\n\nIngredients\n1 egg\n2 cups milk`],
  ])("leaves %s to the AI", (_name, text) => {
    expect(read(text).kind).toBe("unclear");
  });

  it("does not mistake a sentence for a heading", () => {
    // "Directions" inside a sentence is not a heading line.
    expect(
      read(
        `Pie\n\nI lost the directions for this pie, but the ingredients were 2 cups flour and 1 egg.`,
      ).kind,
    ).toBe("unclear");
  });
});
