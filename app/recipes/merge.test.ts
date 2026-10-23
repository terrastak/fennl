import { describe, expect, it } from "vitest";
import {
  emptyRecipeContent,
  type Category,
  type Recipe,
  type RecipeMade,
  type RecipeOpinion,
  type RecipePhoto,
} from "../../shared/recipe";
import type { SyncChange } from "../../shared/sync";
import { categoryTree, type CategoryData } from "../categories/tree";
import type { RecipeDetail } from "../sync/dbProtocol";
import {
  defaultChoices,
  differingRows,
  emptyRow,
  mergedContent,
  MERGE_ROWS,
  planMerge,
  rowLines,
  sameRow,
  suggestKeeper,
  type MergeRow,
  type Side,
} from "./merge";

const ME = "brian";
const NOW = 1_800_000_000_000;
const lines = (...texts: string[]) =>
  texts.map((text, i) => ({ id: `line-${i}-${text.length}`, text, heading: false }));

let n = 0;
const uid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    ...emptyRecipeContent(),
    id: uid("aaaaaaaa"),
    ownerUserId: ME,
    updatedByUserId: ME,
    createdAt: "2026-01-01T00:00:00Z",
    copiedFrom: null,
    import: null,
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    serverSeq: 1,
    ...over,
  };
}

function detail(r: Recipe, extra: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    recipe: r,
    waiting: false,
    opinions: [],
    made: [],
    categories: [],
    members: [{ userId: ME, name: "Brian" }],
    photos: [],
    linked: {},
    ...extra,
  };
}

const made = (r: Recipe, madeOn: string, userId = ME): RecipeMade => ({
  id: uid("bbbbbbbb"),
  recipeId: r.id,
  userId,
  madeOn,
  updatedAt: "x",
  deletedAt: null,
  serverSeq: 1,
});

const opinion = (r: Recipe, over: Partial<RecipeOpinion> = {}): RecipeOpinion => ({
  recipeId: r.id,
  userId: ME,
  rating: null,
  favorite: false,
  note: "",
  updatedAt: "x",
  deletedAt: null,
  serverSeq: 1,
  ...over,
});

const photo = (r: Recipe, hash: string, over: Partial<RecipePhoto> = {}): RecipePhoto => ({
  id: uid("cccccccc"),
  recipeId: r.id,
  imageHash: hash,
  role: "photo",
  width: 100,
  height: 80,
  sortOrder: 0,
  addedByUserId: ME,
  updatedAt: "x",
  deletedAt: null,
  serverSeq: 1,
  ...over,
});

function category(name: string, parent: Category | null = null): Category {
  return {
    id: uid("dddddddd"),
    ownerUserId: ME,
    parentId: parent?.id ?? null,
    name,
    sortOrder: 0,
    updatedAt: "x",
    deletedAt: null,
    serverSeq: 1,
  };
}

function treeOf(categories: Category[]) {
  const data: CategoryData = { categories, links: [], recipeOwners: {} };
  return categoryTree(data, ME);
}

const keepAll = () =>
  Object.fromEntries(MERGE_ROWS.map((r) => [r.id, "keeper"])) as Record<MergeRow, Side>;
const takeOther = (...rows: MergeRow[]) => {
  const choices = keepAll();
  for (const row of rows) choices[row] = "other";
  return choices;
};

function ids() {
  let i = 0;
  return () => `new-id-${++i}`;
}

function plan(
  keeper: RecipeDetail,
  other: RecipeDetail,
  choices = keepAll(),
  extra: Partial<Parameters<typeof planMerge>[0]> = {},
) {
  return planMerge({
    keeper,
    other,
    choices,
    me: ME,
    now: NOW,
    tree: treeOf([]),
    photos: { enabled: true, maxPerRecipe: 10, maxFileBytes: null },
    newId: ids(),
    ...extra,
  });
}

const ofKind = <K extends SyncChange["kind"]>(changes: SyncChange[], kind: K) =>
  changes.filter((c): c is Extract<SyncChange, { kind: K }> => c.kind === kind);

describe("comparing", () => {
  const a = recipe({ title: "Pancakes", ingredients: lines("1 cup flour", "2 eggs") });
  const b = recipe({
    title: "Pancakes ",
    ingredients: lines("1 cup flour", "2 eggs"),
    notes: "Freezes well",
  });

  it("sees the same words as the same, ignoring spacing and line ids", () => {
    expect(sameRow(a, b, "title")).toBe(true);
    expect(
      sameRow(
        a,
        { ...b, ingredients: lines("1 cup flour", "2 eggs").map((l) => ({ ...l, id: "other" })) },
        "ingredients",
      ),
    ).toBe(true);
    expect(sameRow(a, b, "notes")).toBe(false);
  });

  it("lists only the rows that differ", () => {
    expect(differingRows(a, b)).toEqual(["notes"]);
  });

  it("knows what says nothing", () => {
    const empty = recipe();
    for (const { id } of MERGE_ROWS) expect(emptyRow(empty, id)).toBe(true);
    expect(
      emptyRow(recipe({ times: { ...empty.times, prep: { minutes: 5, text: null } } }), "times"),
    ).toBe(false);
    expect(emptyRow(recipe({ ingredients: lines("  ") }), "ingredients")).toBe(true);
  });

  it("shows rows as words", () => {
    const r = recipe({
      title: "T",
      servings: { count: 4, yield: null },
      times: {
        prep: { minutes: 10, text: null },
        cook: { minutes: null, text: null },
        total: { minutes: 30, text: null },
      },
    });
    expect(rowLines(r, "servings")).toEqual(["Serves 4"]);
    expect(rowLines(r, "times")).toEqual(["Prep 10 min", "Total 30 min"]);
    expect(rowLines(recipe(), "title")).toEqual([]);
  });

  it("starts by keeping the kept recipe's, except where it says nothing", () => {
    const keeper = recipe({ title: "A", notes: "" });
    const other = recipe({ title: "B", notes: "Handy" });
    const choices = defaultChoices(keeper, other);
    expect(choices.title).toBe("keeper");
    expect(choices.notes).toBe("other");
    expect(choices.description).toBe("keeper");
  });

  it("suggests keeping the fuller recipe, then the older", () => {
    const full = recipe({ ingredients: lines("1 cup flour", "2 eggs") });
    const thin = recipe({ ingredients: lines("1 cup flour") });
    expect(suggestKeeper(thin, full)[0].id).toBe(full.id);
    const old = recipe({ createdAt: "2020-01-01T00:00:00Z" });
    const young = recipe({ createdAt: "2025-01-01T00:00:00Z" });
    expect(suggestKeeper(young, old)[0].id).toBe(old.id);
    expect(suggestKeeper(old, young)[0].id).toBe(old.id);
  });
});

describe("what the kept recipe becomes", () => {
  it("takes only the chosen rows from the other", () => {
    const keeper = recipe({ title: "A", notes: "Mine", description: "Kept" });
    const other = recipe({ title: "B", notes: "Theirs", description: "Other" });
    const merged = mergedContent(keeper, other, takeOther("title", "notes"));
    expect(merged.title).toBe("B");
    expect(merged.notes).toBe("Theirs");
    expect(merged.description).toBe("Kept");
    // The recipe itself isn't changed.
    expect(keeper.title).toBe("A");
  });

  it("with no choices is the kept recipe's own content", () => {
    const keeper = recipe({ title: "A" });
    expect(mergedContent(keeper, recipe({ title: "B" }), keepAll())).toEqual(keeper);
  });
});

describe("the merge", () => {
  it("with nothing to take just moves the other recipe to Trash, and undoes that", () => {
    const keeper = detail(recipe({ title: "A" }));
    const other = detail(recipe({ title: "A" }));
    const p = plan(keeper, other);
    expect(p.changes).toEqual([
      { kind: "recipe", id: other.recipe.id, fields: {}, deleted: true, changedAt: NOW },
    ]);
    expect(p.undo).toEqual([
      { kind: "recipe", id: other.recipe.id, fields: {}, deleted: false, changedAt: NOW },
    ]);
    expect(p.willDo).toEqual(["Move “A” to Trash, where you can put it back for 30 days."]);
    expect(p.cannot).toEqual([]);
  });

  it("takes the chosen rows from the other recipe, and undoes it with the old values", () => {
    const keeper = detail(recipe({ title: "Pancakes", notes: "Mine" }));
    const other = detail(
      recipe({ title: "Buttermilk pancakes", notes: "Theirs", description: "Fluffy" }),
    );
    const p = plan(keeper, other, takeOther("title", "description"));
    const [edit] = ofKind(p.changes, "recipe");
    expect(edit).toMatchObject({
      id: keeper.recipe.id,
      fields: { title: "Buttermilk pancakes", description: "Fluffy" },
    });
    // Notes weren't chosen: not touched.
    expect(edit?.fields).not.toHaveProperty("notes");
    const back = ofKind(p.undo, "recipe").find((c) => c.id === keeper.recipe.id);
    expect(back?.fields).toEqual({ title: "Pancakes", description: "" });
    expect(p.willDo[0]).toBe("Use the other recipe's title, about.");
  });

  it("takes both difficulty fields together", () => {
    const keeper = detail(recipe({ difficulty: "easy", difficultyText: null }));
    const other = detail(recipe({ difficulty: null, difficultyText: "Fiddly" }));
    const [edit] = ofKind(plan(keeper, other, takeOther("difficulty")).changes, "recipe");
    expect(edit?.fields).toEqual({ difficulty: null, difficultyText: "Fiddly" });
  });

  it("ignores a choice for a row that says the same", () => {
    const keeper = detail(recipe({ title: "A" }));
    const other = detail(recipe({ title: "A" }));
    const p = plan(keeper, other, takeOther("title"));
    expect(ofKind(p.changes, "recipe")).toHaveLength(1);
  });

  it("files the kept recipe under the other's categories too, once each", () => {
    const desserts = category("Desserts");
    const cakes = category("Cakes", desserts);
    const soups = category("Soups");
    const tree = treeOf([desserts, cakes, soups]);
    const keeper = detail(recipe(), { categories: ["Soups"] });
    const other = detail(recipe(), { categories: ["Desserts › Cakes", "soups"] });
    const p = plan(keeper, other, keepAll(), { tree });
    const links = ofKind(p.changes, "recipeCategory");
    expect(links).toEqual([
      expect.objectContaining({ recipeId: keeper.recipe.id, categoryId: cakes.id, deleted: false }),
    ]);
    expect(ofKind(p.undo, "recipeCategory")).toEqual([
      expect.objectContaining({ recipeId: keeper.recipe.id, categoryId: cakes.id, deleted: true }),
    ]);
    expect(p.willDo).toContain("File it under Desserts › Cakes too.");
  });

  it("shows the other's photos on the kept recipe, after its own, skipping ones it already shows", () => {
    const keeper = recipe();
    const other = recipe();
    const k = detail(keeper, { photos: [photo(keeper, "shared", { sortOrder: 4 })] });
    const o = detail(other, {
      photos: [
        photo(other, "shared", { sortOrder: 0 }),
        photo(other, "second", { sortOrder: 2, width: 640, height: 480 }),
        photo(other, "first", { sortOrder: 1, role: "import_original" }),
      ],
    });
    const p = plan(k, o);
    const added = ofKind(p.changes, "photo");
    expect(added.map((c) => c.create?.imageHash)).toEqual(["first", "second"]);
    expect(added.map((c) => c.fields.sortOrder)).toEqual([5, 6]);
    expect(added[1]?.create).toEqual({
      imageHash: "second",
      role: "photo",
      width: 640,
      height: 480,
    });
    expect(added.every((c) => c.recipeId === keeper.id)).toBe(true);
    expect(ofKind(p.undo, "photo").map((c) => [c.id, c.deleted])).toEqual(
      added.map((c) => [c.id, true]).reverse(),
    );
    expect(p.willDo).toContain("Add 2 photos.");
  });

  it("doesn't add photos when the plan has none, and says so", () => {
    const keeper = recipe();
    const other = recipe();
    const o = detail(other, { photos: [photo(other, "x")] });
    for (const photos of [null, { enabled: false, maxPerRecipe: 0, maxFileBytes: null }]) {
      const p = plan(detail(keeper), o, keepAll(), { photos });
      expect(ofKind(p.changes, "photo")).toEqual([]);
      expect(p.cannot[0]).toContain("1 photo can't be added");
    }
  });

  it("stops at the limit of photos on a recipe, but not for the originals of an import", () => {
    const keeper = recipe();
    const other = recipe();
    const k = detail(keeper, { photos: [photo(keeper, "k1"), photo(keeper, "k2")] });
    const o = detail(other, {
      photos: [
        photo(other, "g1", { sortOrder: 0 }),
        photo(other, "g2", { sortOrder: 1 }),
        photo(other, "card", { sortOrder: 2, role: "import_original" }),
      ],
    });
    const p = plan(k, o, keepAll(), {
      photos: { enabled: true, maxPerRecipe: 3, maxFileBytes: null },
    });
    expect(ofKind(p.changes, "photo").map((c) => c.create?.imageHash)).toEqual(["g1", "card"]);
    expect(p.cannot.join(" ")).toContain("1 photo won't fit under the limit of 3");
  });

  it("carries the person's own 'made it' days the kept recipe doesn't have", () => {
    const keeper = recipe();
    const other = recipe();
    const k = detail(keeper, { made: [made(keeper, "2026-10-01")] });
    const o = detail(other, {
      made: [
        made(other, "2026-10-01"),
        made(other, "2026-09-15"),
        made(other, "2026-09-15"),
        made(other, "2026-08-01", "sarah"),
      ],
    });
    const p = plan(k, o);
    expect(ofKind(p.changes, "made").map((c) => c.madeOn)).toEqual(["2026-09-15"]);
    expect(ofKind(p.undo, "made")).toEqual([
      expect.objectContaining({ madeOn: "2026-09-15", deleted: true }),
    ]);
    expect(p.willDo).toContain("Add 1 “made it” day.");
    expect(p.cannot.join(" ")).toContain("1 “made it” day by other people can't move");
  });

  it("carries the person's own rating, favorite and note only where the kept recipe has none", () => {
    const keeper = recipe();
    const other = recipe();
    const k = detail(keeper, { opinions: [opinion(keeper, { rating: 3, note: "" })] });
    const o = detail(other, {
      opinions: [opinion(other, { rating: 5, favorite: true, note: "Great with cream" })],
    });
    const p = plan(k, o);
    const [carry] = ofKind(p.changes, "opinion");
    // Their 3 stars stay; the favorite and note come over.
    expect(carry?.fields).toEqual({ favorite: true, note: "Great with cream" });
    const [back] = ofKind(p.undo, "opinion");
    expect(back?.fields).toEqual({ favorite: false, note: "" });
    expect(p.willDo).toContain("Keep your favorite, note from the other recipe.");
  });

  it("leaves other people's ratings and notes, and says so", () => {
    const keeper = recipe();
    const other = recipe();
    const o = detail(other, { opinions: [opinion(other, { userId: "sarah", rating: 4 })] });
    const p = plan(detail(keeper), o);
    expect(ofKind(p.changes, "opinion")).toEqual([]);
    expect(p.cannot.join(" ")).toContain("1 other person's rating or note can't move");
  });

  it("puts the other recipe in Trash last, and puts it back first when undone", () => {
    const keeper = recipe({ title: "A" });
    const other = recipe({ title: "B" });
    const k = detail(keeper);
    const o = detail(other, { made: [made(other, "2026-09-15")], photos: [photo(other, "x")] });
    const p = plan(k, o, takeOther("title"));
    expect(p.changes.at(-1)).toMatchObject({ kind: "recipe", id: other.id, deleted: true });
    expect(p.undo[0]).toMatchObject({ kind: "recipe", id: other.id, deleted: false });
    expect(p.changes.length).toBe(p.undo.length);
    // Everything done is undone: same number of changes of each kind.
    for (const kind of ["recipe", "photo", "made"] as const) {
      expect(ofKind(p.changes, kind).length).toBe(ofKind(p.undo, kind).length);
    }
  });

  it("never changes the other recipe except to move it to Trash", () => {
    const keeper = recipe({ title: "A" });
    const other = recipe({ title: "B", notes: "x" });
    const p = plan(detail(keeper), detail(other), takeOther("title", "notes"));
    const touchingOther = p.changes.filter((c) => "id" in c && c.id === other.id);
    expect(touchingOther).toEqual([
      expect.objectContaining({ kind: "recipe", fields: {}, deleted: true }),
    ]);
  });
});
