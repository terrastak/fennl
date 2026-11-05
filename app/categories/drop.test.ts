import { describe, expect, it } from "vitest";
import type { Category } from "../../shared/recipe";
import { checkDrop, dropAt, type RowBox } from "./drop";
import { categoryTree } from "./tree";

const ME = "me";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cat = (n: number, name: string, parent: number | null): Category => ({
  id: id(n),
  ownerUserId: ME,
  parentId: parent === null ? null : id(parent),
  name,
  sortOrder: 0,
  updatedAt: "2026-11-04T00:00:00Z",
  deletedAt: null,
  serverSeq: 1,
});

/** Bars, Christmas, Dessert with Cakes inside (open), Entrees: rows 20 px high from 100. */
function setup() {
  const tree = categoryTree(
    {
      categories: [
        cat(1, "Bars", null),
        cat(2, "Christmas", null),
        cat(3, "Dessert", null),
        cat(4, "Cakes", 3),
        cat(5, "Entrees", null),
      ],
      links: [],
      recipeOwners: {},
    },
    ME,
  );
  const rows: RowBox[] = tree.nodes.map((node, i) => ({
    node,
    top: 100 + i * 20,
    bottom: 120 + i * 20,
  }));
  const node = (key: string) => tree.byKey.get(key)!;
  return { tree, rows, node };
}

describe("dropping a dragged category", () => {
  it("goes inside a row when dropped on its middle", () => {
    const { rows, node } = setup();
    expect(dropAt(rows, 150)).toEqual({ kind: "inside", target: node("dessert") });
  });

  it("goes between two rows near their edge, at the lower row's level", () => {
    const { rows, node } = setup();
    // The bottom of Christmas and the top of Dessert are the same place.
    const between = {
      kind: "between",
      place: { parent: null, before: node("dessert") },
      y: 140,
      depth: 0,
    };
    expect(dropAt(rows, 138)).toEqual(between);
    expect(dropAt(rows, 141)).toEqual(between);
    // Just under an open Dessert: first inside it, before Cakes.
    expect(dropAt(rows, 158)).toMatchObject({
      place: { parent: node("dessert"), before: node("dessert › cakes") },
      depth: 1,
    });
    // Under Cakes, before Entrees: back at the top level.
    expect(dropAt(rows, 178)).toMatchObject({
      place: { parent: null, before: node("entrees") },
      depth: 0,
    });
  });

  it("goes last inside a list of subcategories when moved a level in at its end", () => {
    const { tree, rows, node } = setup();
    // Under Cakes, before Entrees, moved one level in: last inside Dessert.
    const last = { place: { parent: node("dessert"), before: null }, y: 180, depth: 1 };
    expect(dropAt(rows, 178, 1)).toMatchObject(last);
    expect(dropAt(rows, 182, 4)).toMatchObject(last);
    // Not moved in (or moved out): the top level, before Entrees.
    expect(dropAt(rows, 178, -2)).toMatchObject({
      place: { parent: null, before: node("entrees") },
    });
    // Elsewhere the level changes nothing: between Bars and Christmas is the top level.
    expect(dropAt(rows, 119, 3)).toMatchObject({
      place: { parent: null, before: node("christmas") },
    });
    // Below the last row, when that's a subcategory.
    const open = rows.slice(0, 4);
    expect(dropAt(open, 400, 1)).toMatchObject(last);
    expect(dropAt(open, 400)).toMatchObject({ place: { parent: null, before: null }, depth: 0 });
    // Cakes there already, so nothing changes; Bars can go there.
    expect(checkDrop(tree, node("dessert › cakes"), dropAt(rows, 178, 1)!)).toBe("same");
    expect(checkDrop(tree, node("bars"), dropAt(rows, 178, 1)!)).toBe("ok");
  });

  it("goes first above every row and last below them", () => {
    const { rows, node } = setup();
    expect(dropAt(rows, 50)).toMatchObject({ place: { parent: null, before: node("bars") } });
    expect(dropAt(rows, 400)).toMatchObject({ place: { parent: null, before: null }, y: 200 });
    expect(dropAt([], 100)).toBeNull();
  });

  it("refuses its own subcategories and changes nothing where it already is", () => {
    const { tree, rows, node } = setup();
    const dessert = node("dessert");
    expect(checkDrop(tree, dessert, dropAt(rows, 170)!)).toBe("refused"); // onto Cakes
    expect(checkDrop(tree, dessert, dropAt(rows, 158)!)).toBe("refused"); // before Cakes
    expect(checkDrop(tree, dessert, dropAt(rows, 150)!)).toBe("refused"); // onto itself
    expect(checkDrop(tree, dessert, dropAt(rows, 141)!)).toBe("same");
    expect(checkDrop(tree, node("dessert › cakes"), dropAt(rows, 150)!)).toBe("same");
    expect(checkDrop(tree, node("christmas"), dropAt(rows, 150)!)).toBe("ok");
    expect(checkDrop(tree, node("dessert › cakes"), dropAt(rows, 178)!)).toBe("ok");
  });
});
