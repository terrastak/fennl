import { describe, expect, it } from "vitest";
import { emptyRecipeContent, type RecipeContent, type RecipeOpinion } from "../../shared/recipe";
import { ingredientsFromText } from "../../shared/recipeLines";
import type { RecipeVersion } from "../../shared/versions";
import { restoreChanges, versionDifferences } from "./versions";

const me = "user-me";
const recipeId = "6f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";

const before: RecipeContent = {
  ...emptyRecipeContent(),
  title: "Fajitas",
  ingredients: ingredientsFromText("1 onion\n2 peppers"),
};
const version: RecipeVersion = {
  id: "a".repeat(32),
  recipeId,
  reason: "paprika_update",
  createdAt: "2026-10-21T12:00:00.000Z",
  authorUserId: me,
  snapshot: { content: before, opinion: { userId: me, rating: 4, note: "Less onion" } },
};
const now: RecipeContent = {
  ...before,
  title: "Chicken Fajitas",
  ingredients: ingredientsFromText("1 onion\n3 peppers", before.ingredients),
};
const mine: RecipeOpinion = {
  recipeId,
  userId: me,
  rating: 5,
  favorite: false,
  note: "Less onion",
  updatedAt: "2026-10-21T12:00:00.000Z",
  deletedAt: null,
  serverSeq: 3,
};

describe("an earlier version", () => {
  it("is compared field by field, with the person's own stars", () => {
    expect(versionDifferences(now, version, mine, me)).toEqual([
      { key: "title", name: "Title", now: "Chicken Fajitas", before: "Fajitas" },
      {
        key: "ingredients",
        name: "Ingredients",
        now: "1 onion\n3 peppers",
        before: "1 onion\n2 peppers",
      },
      { key: "rating", name: "Your stars", now: "5 of 5", before: "4 of 5" },
    ]);
    // A partner sees only the recipe's own differences.
    expect(versionDifferences(now, version, null, "user-partner").map((d) => d.key)).toEqual([
      "title",
      "ingredients",
    ]);
  });

  it("is put back as it was, lines and all", () => {
    const changes = restoreChanges(recipeId, now, version, mine, me, 10);
    expect(changes).toEqual([
      {
        kind: "recipe",
        id: recipeId,
        fields: { title: "Fajitas", ingredients: before.ingredients },
        changedAt: 10,
      },
      { kind: "opinion", recipeId, fields: { rating: 4 }, changedAt: 10 },
    ]);
    expect(restoreChanges(recipeId, before, version, { ...mine, rating: 4 }, me, 10)).toEqual([]);
  });
});
