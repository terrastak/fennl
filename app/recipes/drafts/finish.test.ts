import { describe, expect, it } from "vitest";
import { emptyDraftData } from "../../../shared/drafts";
import { emptyRecipeContent, type Recipe } from "../../../shared/recipe";
import type { RecipeDetail } from "../../sync/dbProtocol";
import type { SyncClient } from "../../sync/tabs";
import type { SyncChange } from "../../../shared/sync";
import { applyDraft, partnerChanges, savedState } from "./finish";

// Done's question (U27 part 3): households aren't built yet (G1), so this is checked here with a
// stand-in for the device's copy.

const ME = "me";
const SARAH = "sarah";
const ID = "33333333-3333-4333-8333-333333333333";

function detail(recipe: Partial<Recipe>, members = [ME, SARAH]): RecipeDetail {
  return {
    recipe: {
      ...emptyRecipeContent(),
      title: "Stew",
      id: ID,
      ownerUserId: ME,
      updatedByUserId: SARAH,
      createdAt: "2026-11-01T00:00:00.000Z",
      copiedFrom: null,
      import: null,
      updatedAt: "2026-11-02T00:00:00.000Z",
      deletedAt: null,
      serverSeq: 3,
      ...recipe,
    },
    waiting: false,
    opinions: [],
    made: [],
    notes: [],
    categories: ["Dinner", "Desserts › Cakes"],
    members: members.map((userId) => ({
      userId,
      name: userId === SARAH ? "Sarah Lee" : "Brian Lee",
    })),
    photos: [],
    linked: {},
  };
}

const client = (found: RecipeDetail) =>
  ({ userId: ME, getRecipe: () => Promise.resolve(found) }) as unknown as SyncClient;

describe("partnerChanges", () => {
  const data = {
    ...emptyDraftData(),
    fields: { notes: "Mine", title: "Stew" },
    base: { notes: "Old", title: "Stew" },
  };

  it("names the partner and the parts they changed too", async () => {
    const found = detail({ notes: "Sarah's", fieldBy: { notes: SARAH } });
    expect(await partnerChanges(client(found), ID, data, 0)).toEqual([
      { name: "Sarah", parts: ["Notes"] },
    ]);
  });

  it("asks nothing when the change was mine, or I'm on my own", async () => {
    expect(
      await partnerChanges(client(detail({ notes: "Again", fieldBy: { notes: ME } })), ID, data, 0),
    ).toEqual([]);
    expect(await partnerChanges(client(detail({ notes: "Sarah's" }, [ME])), ID, data, 0)).toEqual(
      [],
    );
  });
});

describe("partnerChanges for photos and categories", () => {
  const STARTED = Date.parse("2026-11-03T00:00:00.000Z");
  const data = {
    ...emptyDraftData(),
    categories: [["Dinner"], ["Soups"]],
    baseCategories: ["dinner"],
  };
  const withLinks = (by: string, at: string) => ({
    ...detail({}),
    categories: ["Dinner", "Quick"],
    changes: { photos: [], categories: [{ userId: by, at }] },
  });

  it("names the partner who changed the categories since the draft began", async () => {
    const found = withLinks(SARAH, "2026-11-04T00:00:00.000Z");
    expect(await partnerChanges(client(found), ID, data, STARTED)).toEqual([
      { name: "Sarah", parts: ["Categories"] },
    ]);
  });

  it("asks nothing when I changed them, or the partner's change was before the draft", async () => {
    const mine = withLinks(ME, "2026-11-04T00:00:00.000Z");
    expect(await partnerChanges(client(mine), ID, data, STARTED)).toEqual([]);
    const before = withLinks(SARAH, "2026-11-02T00:00:00.000Z");
    expect(await partnerChanges(client(before), ID, data, STARTED)).toEqual([]);
  });
});

describe("applyDraft", () => {
  const data = { ...emptyDraftData(), fields: { title: "Better stew" }, base: { title: "Stew" } };
  const stub = (found: RecipeDetail | null, newer = false) => {
    const sent: SyncChange[][] = [];
    const fake = {
      userId: ME,
      getRecipe: () => Promise.resolve(found),
      getCategories: () => Promise.resolve({ categories: [], links: [], recipeOwners: {} }),
      finishDraft: (_id: string, changes: SyncChange[]) => {
        if (newer) return Promise.resolve(false);
        sent.push(changes);
        return Promise.resolve(true);
      },
    } as unknown as SyncClient;
    return { fake, sent };
  };
  const args = { recipeId: ID, data, startedAt: 0, skip: new Set<never>(), version: 3 };

  it("sends nothing for a recipe moved to Trash meanwhile (never a new recipe in its place)", async () => {
    const { fake, sent } = stub(detail({ deletedAt: "2026-11-04T00:00:00.000Z" }));
    expect(await applyDraft({ ...args, client: fake, isNew: false })).toBe("gone");
    expect(sent).toEqual([]);
  });

  it("sends nothing for a saved recipe no longer here", async () => {
    const { fake, sent } = stub(null);
    expect(await applyDraft({ ...args, client: fake, isNew: false })).toBe("gone");
    expect(sent).toEqual([]);
  });

  it("sends only the changed fields of a saved recipe", async () => {
    const { fake, sent } = stub(detail({}));
    expect(await applyDraft({ ...args, client: fake, isNew: false })).toBe("applied");
    expect(sent[0]).toEqual([
      expect.objectContaining({ kind: "recipe", fields: { title: "Better stew" } }),
    ]);
    expect(sent[0]?.[0]).not.toHaveProperty("create");
  });

  it("says when a newer version of the draft is here (nothing sent)", async () => {
    const { fake, sent } = stub(detail({}), true);
    expect(await applyDraft({ ...args, client: fake, isNew: false })).toBe("newer");
    expect(sent).toEqual([]);
  });
});

describe("savedState", () => {
  it("reads category paths back into names", () => {
    expect(savedState(detail({})).categories).toEqual([["Dinner"], ["Desserts", "Cakes"]]);
  });
});
