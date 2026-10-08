import { describe, expect, it } from "vitest";
import type { Category } from "../../shared/recipe";
import type { CategoryChange, RecipeCategoryChange } from "../../shared/sync";
import {
  canMove,
  categoryTree,
  createCategory,
  deleteCategory,
  fileRecipes,
  moveCategory,
  parsePath,
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

function cat(label: string, name: string, parent: string | null, owner = ME): Category {
  return {
    id: id(label),
    ownerUserId: owner,
    parentId: parent ? id(parent) : null,
    name,
    sortOrder: 0,
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
