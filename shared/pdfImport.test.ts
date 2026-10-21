import { describe, expect, it } from "vitest";
import { PDF_RULES, editedRecipes, pageKind, pdfRecipes } from "./pdfImport";

// Phase E12: which PDF pages are read from their own text, and the list of a PDF's recipes.

describe("a PDF page", () => {
  it("is read from its text when it has real text, and as a picture when scanned", () => {
    expect(
      pageKind("Lemon Bars\n1 cup flour\n2 eggs\nMix well, then bake for 20 minutes.", 0),
    ).toBe("text");
    expect(pageKind("", 0)).toBe("picture");
    expect(pageKind("12", 0.1)).toBe("picture");
    // A scan with a text layer added by the scanner (often wrong): read as the picture.
    expect(
      pageKind("Lemon Bars\n1 cup flour\n2 eggs\nMix well, then bake for 20 minutes.", 0.9),
    ).toBe("picture");
  });
});

describe("the recipes found in a PDF", () => {
  it("keeps titled recipes, within the PDF, in order, each at most a few pages", () => {
    expect(
      pdfRecipes(
        {
          recipes: [
            { title: " Lemon\n Bars ", firstPage: 1, lastPage: 2 },
            { title: "", firstPage: 3, lastPage: 3 },
            { title: "Soup", firstPage: 0, lastPage: 99 },
            { title: "Stew", firstPage: 5, lastPage: 4 },
            { title: "Pie", firstPage: 1.5, lastPage: 2 },
          ],
        },
        12,
      ),
    ).toEqual([
      { title: "Lemon Bars", firstPage: 1, lastPage: 2 },
      // Not before the recipe before it, and no longer than PDF_RULES.recipePages.
      { title: "Soup", firstPage: 1, lastPage: PDF_RULES.recipePages },
      { title: "Stew", firstPage: 5, lastPage: 5 },
    ]);
    expect(pdfRecipes({ recipes: "none" }, 3)).toBeNull();
    expect(pdfRecipes(null, 3)).toBeNull();
    expect(pdfRecipes({ recipes: [] }, 3)).toEqual([]);
  });

  it("accepts the person's changes only when every recipe has a title and real pages", () => {
    const ok = [{ title: " Soup ", firstPage: 2, lastPage: 3 }];
    expect(editedRecipes(ok, 3)).toEqual([{ title: "Soup", firstPage: 2, lastPage: 3 }]);
    expect(editedRecipes([{ title: "", firstPage: 1, lastPage: 1 }], 3)).toBeNull();
    expect(editedRecipes([{ title: "Soup", firstPage: 3, lastPage: 2 }], 3)).toBeNull();
    expect(editedRecipes([{ title: "Soup", firstPage: 1, lastPage: 4 }], 3)).toBeNull();
    expect(
      editedRecipes([{ title: "Soup", firstPage: 1, lastPage: PDF_RULES.recipePages + 1 }], 50),
    ).toBeNull();
  });
});
