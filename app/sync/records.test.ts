import { describe, expect, it } from "vitest";
import { emptyRecipeContent, type Recipe, type RecipeOpinion } from "../../shared/recipe";
import type { SyncChange } from "../../shared/sync";
import {
  applyChange,
  batches,
  keyOf,
  recordOf,
  stampedAsSent,
  withPending,
  type ApplyContext,
} from "./records";

const me = "user-me";
const ctx: ApplyContext = {
  userId: me,
  now: "2026-10-07T12:00:00.000Z",
  ownerOf: () => "user-partner",
};
const recipeId = "6f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";

const create: SyncChange = {
  kind: "recipe",
  id: recipeId,
  create: { createdAt: "2026-10-01T00:00:00.000Z", import: null },
  fields: { ...emptyRecipeContent(), title: "Salsa verde" },
  changedAt: 1,
};

describe("applying a change here", () => {
  it("makes a new recipe owned by the person, not yet synced", () => {
    const recipe = applyChange(null, create, ctx) as Recipe;
    expect(recipe).toMatchObject({
      id: recipeId,
      ownerUserId: me,
      title: "Salsa verde",
      serverSeq: 0,
      deletedAt: null,
    });
  });

  it("edits only the fields sent, and moves to Trash and back", () => {
    const server = { ...(applyChange(null, create, ctx) as Recipe), serverSeq: 7, notes: "Kept" };
    const edited = applyChange(
      server,
      {
        kind: "recipe",
        id: recipeId,
        fields: { title: "Salsa roja" },
        deleted: true,
        changedAt: 2,
      },
      ctx,
    ) as Recipe;
    expect(edited).toMatchObject({ title: "Salsa roja", notes: "Kept", deletedAt: ctx.now });
    const back = applyChange(
      edited,
      { kind: "recipe", id: recipeId, fields: {}, deleted: false, changedAt: 3 },
      ctx,
    ) as Recipe;
    expect(back.deletedAt).toBeNull();
  });

  it("ignores an edit of a recipe that isn't here", () => {
    expect(
      applyChange(
        null,
        { kind: "recipe", id: recipeId, fields: { title: "?" }, changedAt: 1 },
        ctx,
      ),
    ).toBeNull();
  });

  it("starts an opinion empty, as the person's own", () => {
    const opinion = applyChange(
      null,
      { kind: "opinion", recipeId, fields: { rating: 4 }, changedAt: 1 },
      ctx,
    ) as RecipeOpinion;
    expect(opinion).toMatchObject({ userId: me, rating: 4, favorite: false, note: "" });
  });
});

describe("waiting changes on top of the server's copy", () => {
  it("re-applies them in order after a newer copy arrives", () => {
    const server = { ...(applyChange(null, create, ctx) as Recipe), notes: "From the partner" };
    const pending: SyncChange[] = [
      { kind: "recipe", id: recipeId, fields: { title: "First" }, changedAt: 1 },
      { kind: "recipe", id: recipeId, fields: { title: "Second" }, changedAt: 2 },
    ];
    expect(withPending(server, pending, ctx)).toMatchObject({
      title: "Second",
      notes: "From the partner",
    });
    expect(withPending(server, [], ctx)).toBe(server);
  });
});

describe("keys", () => {
  it("match between a change and the server's row", () => {
    const opinion: SyncChange = {
      kind: "opinion",
      recipeId,
      fields: { favorite: true },
      changedAt: 1,
    };
    const row = applyChange(null, opinion, ctx)!;
    expect(recordOf(opinion, me)).toEqual({ kind: "opinion", key: keyOf("opinion", row) });
    expect(recordOf(create, me)).toEqual({ kind: "recipe", key: recipeId });
  });
});

describe("changes sent without offline editing", () => {
  it("are stamped as sent, keeping their order", () => {
    const rating = (n: number): SyncChange => ({
      kind: "opinion",
      recipeId: "6f1c2a4e-8a1b-4c3d-9e2f-0a1b2c3d4e5f",
      fields: { rating: n },
      changedAt: 5,
    });
    expect(stampedAsSent([rating(4), rating(5)], 1000).map((c) => c.changedAt)).toEqual([
      999, 1000,
    ]);
  });
});

describe("splitting a queue into pushes", () => {
  it("respects the count and size limits", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ seq: i, change: create }));
    expect(batches(entries, 2, 1e9).map((b) => b.length)).toEqual([2, 2, 1]);
    const size = JSON.stringify(create).length + 1;
    expect(batches(entries, 100, size * 2).map((b) => b.length)).toEqual([2, 2, 1]);
    // One change bigger than the limit still goes, on its own.
    expect(batches(entries.slice(0, 2), 100, 10).map((b) => b.length)).toEqual([1, 1]);
  });
});
