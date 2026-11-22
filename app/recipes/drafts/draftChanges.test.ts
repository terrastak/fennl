import { describe, expect, it } from "vitest";
import { emptyDraftData, type DraftData, type DraftPhoto } from "../../../shared/drafts";
import { emptyRecipeContent, type Category, type RecipePhoto } from "../../../shared/recipe";
import { categoryTree } from "../../categories/tree";
import { draftChanges, type DraftChangesInput } from "./draftChanges";

const ME = "me";
const RECIPE = "11111111-1111-4111-8111-111111111111";
const NOW = 1_800_000_000_000;
const sync = { updatedAt: "2026-11-01T00:00:00.000Z", deletedAt: null, serverSeq: 1 };

const cat = (id: string, name: string, parentId: string | null = null): Category => ({
  id,
  ownerUserId: ME,
  parentId,
  name,
  sortOrder: 0,
  ...sync,
});

const tree = categoryTree(
  {
    categories: [cat("c-dinner", "Dinner"), cat("c-soups", "Soups"), cat("c-desserts", "Desserts")],
    links: [{ recipeId: RECIPE, categoryId: "c-dinner" }],
    recipeOwners: { [RECIPE]: ME },
  },
  ME,
);

const stored = (id: string, sortOrder: number): RecipePhoto => ({
  id,
  recipeId: RECIPE,
  imageHash: id.repeat(64).slice(0, 64),
  role: "photo",
  width: 10,
  height: 10,
  sortOrder,
  addedByUserId: ME,
  ...sync,
});

const asDraft = (photo: RecipePhoto): DraftPhoto => ({
  id: photo.id,
  imageHash: photo.imageHash,
  width: photo.width,
  height: photo.height,
  takenAt: null,
});

const savedContent = () => ({
  ...emptyRecipeContent(),
  title: "Stew",
  notes: "Hot",
  description: "Sarah's words",
});
const gallery = [stored("a", 1), stored("b", 2)];

let ids = 0;
function input(
  data: Partial<DraftData>,
  extra: Partial<DraftChangesInput> = {},
): DraftChangesInput {
  return {
    recipeId: RECIPE,
    isNew: false,
    startedAt: NOW - 60_000,
    data: { ...emptyDraftData(), ...data },
    saved: { content: savedContent(), gallery },
    tree,
    me: ME,
    now: NOW,
    newId: () => `new-${++ids}`,
    ...extra,
  };
}

describe("draftChanges", () => {
  it("sends only the fields still changed, stamped with Done's time", () => {
    const changes = draftChanges(
      input({
        fields: { notes: "Very hot", title: "Stew" },
        base: { notes: "Hot", title: "Stew" },
      }),
    );
    // The partner's description is left alone; the title is already what the draft has.
    expect(changes).toEqual([
      { kind: "recipe", id: RECIPE, fields: { notes: "Very hot" }, changedAt: NOW },
    ]);
  });

  it("leaves out skipped parts (Keep Sarah's)", () => {
    const changes = draftChanges(
      input(
        {
          fields: { notes: "Very hot", description: "Mine" },
          categories: [["Soups"]],
        },
        { skip: new Set(["Notes", "Categories"]) },
      ),
    );
    expect(changes).toEqual([
      { kind: "recipe", id: RECIPE, fields: { description: "Mine" }, changedAt: NOW },
    ]);
  });

  it("creates a new recipe first, then its photos, then its categories (made now)", () => {
    const photo: DraftPhoto = {
      id: "p-new",
      imageHash: "c".repeat(64),
      width: 4,
      height: 3,
      takenAt: 7,
    };
    const changes = draftChanges(
      input(
        {
          fields: { title: "Pie" },
          photos: [photo],
          categories: [["Desserts", "Pies"], ["Dinner"]],
        },
        { isNew: true, saved: null, recipeId: "22222222-2222-4222-8222-222222222222" },
      ),
    );
    expect(changes[0]).toMatchObject({
      kind: "recipe",
      create: { createdAt: new Date(NOW - 60_000).toISOString(), import: null },
      fields: { ...emptyRecipeContent(), title: "Pie" },
    });
    expect(changes[1]).toMatchObject({
      kind: "photo",
      id: "p-new",
      create: { imageHash: "c".repeat(64), role: "photo", takenAt: 7 },
      fields: { sortOrder: 1 },
    });
    // Pies is made inside the existing Desserts; Dinner exists.
    const kinds = changes.slice(2).map((c) => c.kind);
    expect(kinds).toEqual(["category", "recipeCategory", "recipeCategory"]);
    expect(changes[2]).toMatchObject({ fields: { name: "Pies", parentId: "c-desserts" } });
    expect(changes.every((c) => c.changedAt === NOW)).toBe(true);
  });

  it("takes photos out before adding, and adds new ones at the end without moving any", () => {
    const added: DraftPhoto = {
      id: "p-new",
      imageHash: "d".repeat(64),
      width: 1,
      height: 1,
      takenAt: null,
    };
    const changes = draftChanges(
      input({ photos: [asDraft(gallery[1]!), added], basePhotos: ["a", "b"] }),
    );
    expect(changes).toEqual([
      expect.objectContaining({ kind: "photo", id: "a", deleted: true }),
      expect.objectContaining({ kind: "photo", id: "p-new", fields: { sortOrder: 3 } }),
    ]);
  });

  it("puts every photo in place when the person moved them, marked as theirs", () => {
    const added: DraftPhoto = {
      id: "p-new",
      imageHash: "d".repeat(64),
      width: 1,
      height: 1,
      takenAt: null,
    };
    const changes = draftChanges(
      input({
        photos: [added, asDraft(gallery[1]!), asDraft(gallery[0]!)],
        basePhotos: ["a", "b"],
        photosArranged: true,
      }),
    );
    expect(changes).toEqual([
      expect.objectContaining({ id: "p-new", fields: { sortOrder: 1, arrangedBy: "person" } }),
      expect.objectContaining({ id: "a", fields: { sortOrder: 3, arrangedBy: "person" } }),
    ]);
  });

  it("brings back, as a new photo, one a partner removed meanwhile", () => {
    const changes = draftChanges(
      input(
        { photos: [asDraft(gallery[0]!), asDraft(gallery[1]!)], basePhotos: ["a", "b"] },
        { saved: { content: savedContent(), gallery: [gallery[0]!] } },
      ),
    );
    expect(changes).toEqual([
      expect.objectContaining({
        kind: "photo",
        id: expect.stringMatching(/^new-/),
        create: expect.objectContaining({ imageHash: gallery[1]!.imageHash }),
      }),
    ]);
  });

  it("takes the recipe out of categories no longer in the draft", () => {
    const changes = draftChanges(input({ categories: [["Soups"]], baseCategories: ["dinner"] }));
    expect(changes).toEqual([
      expect.objectContaining({ kind: "recipeCategory", categoryId: "c-soups", deleted: false }),
      expect.objectContaining({ kind: "recipeCategory", categoryId: "c-dinner", deleted: true }),
    ]);
  });

  it("applies only what the draft added and took out, so a rename meanwhile stays", () => {
    // The draft ticked Soups when the recipe was in "Dinner"; since then "Dinner" was renamed
    // "Suppers" (still linked). Done neither makes "Dinner" again nor takes the recipe out of
    // "Suppers".
    const renamed = categoryTree(
      {
        categories: [cat("c-dinner", "Suppers"), cat("c-soups", "Soups")],
        links: [{ recipeId: RECIPE, categoryId: "c-dinner" }],
        recipeOwners: { [RECIPE]: ME },
      },
      ME,
    );
    const changes = draftChanges({
      ...input({ categories: [["Dinner"], ["Soups"]], baseCategories: ["dinner"] }),
      tree: renamed,
    });
    expect(changes).toEqual([
      expect.objectContaining({ kind: "recipeCategory", categoryId: "c-soups", deleted: false }),
    ]);
    // Taking out a category that has since been renamed leaves the renamed one alone.
    const out = draftChanges({
      ...input({ categories: [], baseCategories: ["dinner"] }),
      tree: renamed,
    });
    expect(out).toEqual([]);
  });
});
