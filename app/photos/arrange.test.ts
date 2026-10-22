import { describe, expect, it } from "vitest";
import type { RecipePhoto } from "../../shared/recipe";
import { arrangeChanges } from "./arrange";

const photo = (id: string, sortOrder: number, more: Partial<RecipePhoto> = {}): RecipePhoto => ({
  id,
  recipeId: "r",
  imageHash: id.padEnd(64, "0"),
  role: "photo",
  width: 100,
  height: 100,
  sortOrder,
  addedByUserId: "u",
  updatedAt: "",
  deletedAt: null,
  serverSeq: 0,
  ...more,
});

describe("saving Fennl's order", () => {
  it("numbers the photos in the new order, each marked as Fennl's", () => {
    const gallery = [photo("a", 1), photo("b", 2), photo("c", 3)];
    expect(arrangeChanges(gallery, ["c", "a", "b"], 100)).toEqual([
      {
        kind: "photo",
        id: "c",
        recipeId: "r",
        fields: { sortOrder: 1, arrangedBy: "fennl" },
        changedAt: 100,
      },
      {
        kind: "photo",
        id: "a",
        recipeId: "r",
        fields: { sortOrder: 2, arrangedBy: "fennl" },
        changedAt: 101,
      },
      {
        kind: "photo",
        id: "b",
        recipeId: "r",
        fields: { sortOrder: 3, arrangedBy: "fennl" },
        changedAt: 102,
      },
    ]);
  });

  it("changes nothing when Fennl's order is already there", () => {
    const gallery = [
      photo("a", 1, { arrangedBy: "fennl" }),
      photo("b", 2, { arrangedBy: "fennl" }),
    ];
    expect(arrangeChanges(gallery, ["a", "b"], 100)).toEqual([]);
  });

  it("keeps a photo the answer didn't know at the end", () => {
    const gallery = [photo("a", 1), photo("new", 2), photo("b", 3)];
    expect(arrangeChanges(gallery, ["b", "a"], 100).map((c) => c.id)).toEqual(["b", "a", "new"]);
  });
});
