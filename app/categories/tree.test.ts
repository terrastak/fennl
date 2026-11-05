import { describe, expect, it } from "vitest";
import type { Category } from "../../shared/recipe";
import type { CategoryChange, RecipeCategoryChange } from "../../shared/sync";
import {
  canMove,
  categoryTree,
  checkInside,
  checkPlace,
  createCategory,
  deleteCategory,
  fileRecipeUnder,
  fileRecipes,
  moveCategory,
  ORDER_BASE,
  ORDER_STEP,
  parsePath,
  placeCategory,
  renameCategory,
  unfileRecipes,
  underPath,
  type CategoryData,
  type PlanContext,
} from "./tree";

const ME = "brian";
const PARTNER = "sarah";

let n = 0;
const id = (label: string) =>
  `00000000-0000-4000-8000-${label.padStart(12, "0").replace(/[^0-9a-f]/g, "a")}`;

function cat(
  label: string,
  name: string,
  parent: string | null,
  owner = ME,
  sortOrder = 0,
): Category {
  return {
    id: id(label),
    ownerUserId: owner,
    parentId: parent ? id(parent) : null,
    name,
    sortOrder,
    updatedAt: "2026-10-08T00:00:00Z",
    deletedAt: null,
    serverSeq: 1,
  };
}

/** Desserts › Cakes and Soups for me; desserts › cakes and Breads for my partner. */
function data(): CategoryData {
  return {
    categories: [
      cat("1", "Desserts", null),
      cat("2", "Cakes", "1"),
      cat("3", "Soups", null),
      cat("4", "desserts", null, PARTNER),
      cat("5", "cakes", "4", PARTNER),
      cat("6", "Breads", null, PARTNER),
    ],
    links: [
      { recipeId: "r-cake", categoryId: id("2") },
      { recipeId: "r-stew", categoryId: id("3") },
      { recipeId: "r-torte", categoryId: id("5") },
      { recipeId: "r-pudding", categoryId: id("1") },
    ],
    recipeOwners: {
      "r-cake": ME,
      "r-stew": ME,
      "r-pudding": ME,
      "r-torte": PARTNER,
      "r-loaf": PARTNER,
    },
  };
}

const ctx = (): PlanContext => ({
  me: ME,
  now: 1000,
  newId: () => id(`new${++n}`),
});

describe("the tree", () => {
  it("shows same-named categories as one, with counts that include what's inside", () => {
    const tree = categoryTree(data(), ME);
    expect(tree.nodes.map((node) => [node.path, node.depth, node.count])).toEqual([
      ["Breads", 0, 0],
      ["Desserts", 0, 3],
      ["Desserts › Cakes", 1, 2],
      ["Soups", 0, 1],
    ]);
    expect(tree.byKey.get("desserts › cakes")?.ids).toEqual([id("2"), id("5")]);
  });

  it("matches a filter on the category and what's inside it", () => {
    expect(underPath("Desserts › Cakes", "desserts")).toBe(true);
    expect(underPath("Desserts", "Desserts")).toBe(true);
    expect(underPath("Dessert wines", "Desserts")).toBe(false);
  });

  it("reads typed paths", () => {
    expect(parsePath("Desserts > Cakes")).toEqual(["Desserts", "Cakes"]);
    expect(parsePath(" Weeknight  dinners ")).toEqual(["Weeknight dinners"]);
    expect(parsePath("Desserts >")).toBeNull();
    expect(parsePath("")).toBeNull();
  });
});

describe("editing categories", () => {
  it("creates only the parts that are missing", () => {
    const tree = categoryTree(data(), ME);
    const plan = createCategory(tree, ["Soups", "Stews", "Chili"], ctx());
    const created = plan.changes as CategoryChange[];
    expect(created.map((c) => [c.fields.name, c.fields.parentId])).toEqual([
      ["Stews", id("3")],
      ["Chili", created[0]?.id],
    ]);
    expect(created.every((c) => c.create && !c.create.ownerUserId)).toBe(true);
    expect(plan.undo.every((c) => (c as CategoryChange).deleted)).toBe(true);
  });

  it("renames every person's category of that path", () => {
    const tree = categoryTree(data(), ME);
    const plan = renameCategory(tree.byKey.get("desserts › cakes")!, "Layer cakes", ctx());
    expect(
      plan.changes.map((c) => [(c as CategoryChange).id, (c as CategoryChange).fields]),
    ).toEqual([
      [id("2"), { name: "Layer cakes" }],
      [id("5"), { name: "Layer cakes" }],
    ]);
    expect((plan.undo[0] as CategoryChange).fields).toEqual({ name: "Cakes" });
  });

  it("moves under each owner's own parent, creating it if needed", () => {
    const tree = categoryTree(data(), ME);
    const cakes = tree.byKey.get("desserts › cakes")!;
    const plan = moveCategory(tree, cakes, tree.byKey.get("soups")!, ctx());
    const changes = plan.changes as CategoryChange[];
    // My Cakes goes under my Soups; my partner has no Soups, so one is made for them.
    expect(changes.find((c) => c.id === id("2"))?.fields).toEqual({ parentId: id("3") });
    const partnersSoups = changes.find((c) => c.create?.ownerUserId === PARTNER);
    expect(partnersSoups?.fields).toMatchObject({ name: "Soups", parentId: null });
    expect(changes.find((c) => c.id === id("5"))?.fields).toEqual({ parentId: partnersSoups?.id });
    expect(plan.undo).toEqual([
      expect.objectContaining({ id: id("2"), fields: { parentId: id("1") } }),
      expect.objectContaining({ id: id("5"), fields: { parentId: id("4") } }),
    ]);
  });

  it("never moves a category into itself", () => {
    const tree = categoryTree(data(), ME);
    const desserts = tree.byKey.get("desserts")!;
    expect(canMove(desserts, tree.byKey.get("desserts › cakes")!)).toBe(false);
    expect(canMove(desserts, desserts)).toBe(false);
    expect(canMove(desserts, null)).toBe(false);
    expect(canMove(tree.byKey.get("desserts › cakes")!, null)).toBe(true);
  });

  it("deletes what's inside too, takes recipes out, and can be undone", () => {
    const tree = categoryTree(data(), ME);
    const plan = deleteCategory(tree, tree.byKey.get("desserts")!, ctx());
    const links = plan.changes.filter((c) => c.kind === "recipeCategory") as RecipeCategoryChange[];
    expect(links.map((l) => l.recipeId).sort()).toEqual(["r-cake", "r-pudding", "r-torte"]);
    expect(plan.changes.filter((c) => c.kind === "category")).toHaveLength(4);
    // Undo brings the categories back before their links.
    expect(plan.undo[0]?.kind).toBe("category");
    expect(plan.undo.every((c) => (c as { deleted?: boolean }).deleted === false)).toBe(true);
  });
});

describe("filing recipes", () => {
  it("files each recipe under its owner's category, skipping those already there", () => {
    const tree = categoryTree(data(), ME);
    const plan = fileRecipes(tree, ["r-cake", "r-stew", "r-loaf"], ["Desserts", "Cakes"], ctx());
    expect(plan.added).toEqual(["r-stew", "r-loaf"]);
    const links = plan.changes.filter((c) => c.kind === "recipeCategory") as RecipeCategoryChange[];
    expect(links).toEqual([
      expect.objectContaining({ recipeId: "r-stew", categoryId: id("2"), deleted: false }),
      expect.objectContaining({ recipeId: "r-loaf", categoryId: id("5"), deleted: false }),
    ]);
    expect(plan.undo.every((c) => (c as RecipeCategoryChange).deleted)).toBe(true);
  });

  it("creates the category when the owner doesn't have it", () => {
    const tree = categoryTree(data(), ME);
    const plan = fileRecipes(tree, ["r-loaf", "r-cake"], ["Breads"], ctx());
    const made = plan.changes.filter((c) => c.kind === "category") as CategoryChange[];
    // My partner has Breads already; I don't.
    expect(made).toEqual([
      expect.objectContaining({ fields: { name: "Breads", parentId: null, sortOrder: 0 } }),
    ]);
    expect(made[0]?.create).toEqual({});
  });

  it("files a new recipe under several categories, making a shared parent once", () => {
    const tree = categoryTree(data(), ME);
    const plan = fileRecipeUnder(
      tree,
      "r-new",
      [
        ["Diet", "Vegan"],
        ["Diet", "Gluten-free"],
        ["desserts", "CAKES"],
        ["Desserts", "Cakes"],
      ],
      ctx(),
    );
    const made = plan.changes.filter((c) => c.kind === "category") as CategoryChange[];
    expect(made.map((c) => c.fields.name)).toEqual(["Diet", "Vegan", "Gluten-free"]);
    expect(made[2]?.fields.parentId).toBe(made[0]?.id);
    const links = plan.changes.filter((c) => c.kind === "recipeCategory") as RecipeCategoryChange[];
    expect(links.map((l) => l.categoryId)).toEqual([made[1]?.id, made[2]?.id, id("2")]);
    expect(plan.undo).toHaveLength(3);
  });

  it("takes recipes out of only that category", () => {
    const tree = categoryTree(data(), ME);
    const plan = unfileRecipes(
      tree,
      ["r-cake", "r-torte", "r-pudding"],
      tree.byKey.get("desserts › cakes")!,
      ctx(),
    );
    expect(plan.removed.sort()).toEqual(["r-cake", "r-torte"]);
    expect(plan.undo.every((c) => (c as RecipeCategoryChange).deleted === false)).toBe(true);
  });
});

describe("the person's own order", () => {
  const placed = (i: number) => ORDER_BASE + i * ORDER_STEP;
  /** Top level: Bars, Bread, Christmas, Dessert (with Cakes, Pies), Entrees; all A to Z. */
  function levels(orders: Record<string, number> = {}): CategoryData {
    const o = (label: string) => orders[label] ?? 0;
    return {
      categories: [
        cat("b1", "Bread", null, ME, o("b1")),
        cat("b2", "Bars", null, ME, o("b2")),
        cat("c1", "Christmas", null, ME, o("c1")),
        cat("d1", "Dessert", null, ME, o("d1")),
        cat("d2", "Pies", "d1", ME, o("d2")),
        cat("d3", "Cakes", "d1", ME, o("d3")),
        cat("e1", "Entrees", null, ME, o("e1")),
        // My partner's Dessert, shown as one with mine.
        cat("d9", "dessert", null, PARTNER, o("d9")),
      ],
      links: [],
      recipeOwners: {},
    };
  }
  const names = (data: CategoryData) => categoryTree(data, ME).nodes.map((n) => n.path);
  /** Applies a plan's category changes to the data, as syncing them would. */
  function apply(data: CategoryData, changes: unknown[]): CategoryData {
    const categories = data.categories.map((c) => {
      const change = (changes as CategoryChange[]).find((x) => x.id === c.id);
      return change ? { ...c, ...change.fields } : c;
    });
    return { ...data, categories };
  }

  it("starts A to Z, and the small orders sample categories got still read A to Z", () => {
    expect(names(levels())).toEqual([
      "Bars",
      "Bread",
      "Christmas",
      "Dessert",
      "Dessert › Cakes",
      "Dessert › Pies",
      "Entrees",
    ]);
    expect(names(levels({ e1: 1, d1: 2, c1: 3, b1: 4, b2: 5 }))[0]).toBe("Bars");
  });

  it("shows placed categories in their order, then any others A to Z", () => {
    const data = levels({ e1: placed(0), b1: placed(1) });
    expect(categoryTree(data, ME).roots.map((n) => n.name)).toEqual([
      "Entrees",
      "Bread",
      "Bars",
      "Christmas",
      "Dessert",
    ]);
  });

  it("places a category between two, numbering the whole level once", () => {
    const data = levels();
    const tree = categoryTree(data, ME);
    const christmas = tree.byKey.get("christmas")!;
    const plan = placeCategory(
      tree,
      christmas,
      { parent: null, before: tree.byKey.get("bars")! },
      ctx(),
    );
    const after = apply(data, plan.changes);
    expect(categoryTree(after, ME).roots.map((n) => n.name)).toEqual([
      "Christmas",
      "Bars",
      "Bread",
      "Dessert",
      "Entrees",
    ]);
    // Both people's Dessert get the same place.
    const changes = plan.changes as CategoryChange[];
    expect(changes.find((c) => c.id === id("d1"))?.fields).toEqual({ sortOrder: placed(3) });
    expect(changes.find((c) => c.id === id("d9"))?.fields).toEqual({ sortOrder: placed(3) });
    // Undo puts every order back, so the level reads A to Z again.
    expect(names(apply(after, plan.undo))).toEqual(names(data));
  });

  it("changes only the orders that move once a level is arranged", () => {
    const data = levels({
      b2: placed(0),
      b1: placed(1),
      c1: placed(2),
      d1: placed(3),
      d9: placed(3),
      e1: placed(4),
    });
    const tree = categoryTree(data, ME);
    const plan = placeCategory(
      tree,
      tree.byKey.get("bread")!,
      { parent: null, before: tree.byKey.get("dessert")! },
      ctx(),
    );
    expect((plan.changes as CategoryChange[]).map((c) => c.id).sort()).toEqual(
      [id("b1"), id("c1")].sort(),
    );
  });

  it("brings a subcategory out to the top level, with a place there", () => {
    const data = levels();
    const tree = categoryTree(data, ME);
    const plan = placeCategory(
      tree,
      tree.byKey.get("dessert › pies")!,
      { parent: null, before: tree.byKey.get("entrees")! },
      ctx(),
    );
    const pies = (plan.changes as CategoryChange[]).find((c) => c.id === id("d2"));
    expect(pies?.fields).toEqual({ parentId: null, sortOrder: placed(4) });
    expect(categoryTree(apply(data, plan.changes), ME).roots.map((n) => n.name)).toEqual([
      "Bars",
      "Bread",
      "Christmas",
      "Dessert",
      "Pies",
      "Entrees",
    ]);
    expect(plan.undo.find((c) => (c as CategoryChange).id === id("d2"))).toMatchObject({
      fields: { parentId: id("d1"), sortOrder: 0 },
    });
  });

  it("puts a category inside another last when that level is arranged, by name when not", () => {
    const tree = categoryTree(levels(), ME);
    const plan = moveCategory(
      tree,
      tree.byKey.get("christmas")!,
      tree.byKey.get("dessert")!,
      ctx(),
    );
    expect((plan.changes as CategoryChange[]).find((c) => c.id === id("c1"))?.fields).toEqual({
      parentId: id("d1"),
    });

    const arranged = categoryTree(levels({ d2: placed(0), d3: placed(1), c1: placed(5) }), ME);
    const again = moveCategory(
      arranged,
      arranged.byKey.get("christmas")!,
      arranged.byKey.get("dessert")!,
      ctx(),
    );
    expect((again.changes as CategoryChange[]).find((c) => c.id === id("c1"))?.fields).toEqual({
      parentId: id("d1"),
      sortOrder: placed(2),
    });
  });

  it("never places a category in itself or inside its own subcategories", () => {
    const tree = categoryTree(levels(), ME);
    const dessert = tree.byKey.get("dessert")!;
    const cakes = tree.byKey.get("dessert › cakes")!;
    expect(checkPlace(tree, dessert, { parent: dessert, before: null })).toBe("refused");
    expect(checkPlace(tree, dessert, { parent: dessert, before: cakes })).toBe("refused");
    expect(checkInside(dessert, cakes)).toBe("refused");
    expect(checkInside(dessert, dessert)).toBe("refused");
    expect(placeCategory(tree, dessert, { parent: dessert, before: cakes }, ctx()).changes).toEqual(
      [],
    );
  });

  it("knows a drop where the category already is changes nothing", () => {
    const tree = categoryTree(levels(), ME);
    const christmas = tree.byKey.get("christmas")!;
    const dessert = tree.byKey.get("dessert")!;
    expect(checkPlace(tree, christmas, { parent: null, before: christmas })).toBe("same");
    expect(checkPlace(tree, christmas, { parent: null, before: dessert })).toBe("same");
    expect(checkPlace(tree, christmas, { parent: null, before: null })).toBe("ok");
    expect(checkInside(tree.byKey.get("dessert › cakes")!, dessert)).toBe("same");
    expect(checkInside(christmas, dessert)).toBe("ok");
  });
});
