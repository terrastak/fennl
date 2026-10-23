import { describe, expect, it } from "vitest";
import type { IngredientLine } from "./recipe";
import {
  MAX_LINK_DEPTH,
  linkView,
  linkedIds,
  reachable,
  wouldLoop,
  type LinkedRecipe,
} from "./subRecipes";

// Phase F3: linked sub-recipes.

const line = (
  text: string,
  linkedRecipeId: string | null = null,
  heading = false,
): IngredientLine => ({
  id: text,
  text,
  heading,
  linkedRecipeId,
});

const recipe = (id: string, status: LinkedRecipe["status"] = "ok"): LinkedRecipe => ({
  id,
  title: id,
  status,
  servings: null,
  ingredients: [],
  directions: [],
});

describe("links", () => {
  it("lists the recipes a list links to, once each, never from a heading", () => {
    expect(
      linkedIds([
        line("For the sauce:", "x", true),
        line("1 cup BBQ sauce", "bbq"),
        line("2 lb ribs"),
        line("more BBQ sauce", "bbq"),
        line("1 cup rub", "rub"),
      ]),
    ).toEqual(["bbq", "rub"]);
  });

  it("follows links as far as they go, or only so deep", () => {
    const links: Record<string, string[]> = { a: ["b"], b: ["c", "d"], c: ["e"], d: [], e: [] };
    const linksOf = (id: string) => links[id] ?? [];
    expect([...reachable("a", linksOf)].sort()).toEqual(["b", "c", "d", "e"]);
    expect([...reachable("a", linksOf, 2)].sort()).toEqual(["b", "c", "d"]);
  });

  it("refuses a link that would go round in a circle", () => {
    const links: Record<string, string[]> = { ribs: ["bbq"], bbq: ["rub"], rub: [] };
    const linksOf = (id: string) => links[id] ?? [];
    // The rub linking to the ribs would make ribs → BBQ sauce → rub → ribs.
    expect(wouldLoop("rub", "ribs", linksOf)).toBe(true);
    expect(wouldLoop("rub", "bbq", linksOf)).toBe(true);
    expect(wouldLoop("ribs", "ribs", linksOf)).toBe(true);
    expect(wouldLoop("ribs", "rub", linksOf)).toBe(false);
    // A circle already in the data (made on two devices at once) doesn't hang the check.
    const circle: Record<string, string[]> = { a: ["b"], b: ["a"] };
    expect(wouldLoop("c", "a", (id) => circle[id] ?? [])).toBe(false);
  });
});

describe("showing a link", () => {
  const found: Record<string, LinkedRecipe> = {
    bbq: recipe("bbq"),
    old: recipe("old", "trash"),
    lost: recipe("lost", "gone"),
  };
  const find = (id: string) => found[id];

  it("shows the recipe, says when it's in Trash, and when it's gone", () => {
    expect(linkView("bbq", ["ribs"], find)).toEqual({ kind: "recipe", recipe: found.bbq });
    expect(linkView("old", ["ribs"], find)).toEqual({ kind: "recipe", recipe: found.old });
    expect(linkView("lost", ["ribs"], find)).toEqual({ kind: "gone" });
    expect(linkView("never-here", ["ribs"], find)).toEqual({ kind: "gone" });
  });

  it("never goes round in a circle, and stops a few levels down", () => {
    expect(linkView("bbq", ["ribs", "bbq", "rub"], find).kind).toBe("loop");
    const path = Array.from({ length: MAX_LINK_DEPTH }, (_, i) => `level-${i}`);
    expect(linkView("bbq", path, find).kind).toBe("recipe");
    expect(linkView("bbq", [...path, "one-more"], find).kind).toBe("deep");
  });
});
