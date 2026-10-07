import { describe, expect, it } from "vitest";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "./recipe";
import { checkChange, formatCursors, isDay, parseCursors, schemaVersionProblem } from "./sync";

const id = () => crypto.randomUUID();
const now = Date.now();

describe("checking a change", () => {
  it("accepts an edit of some fields, checking only those", () => {
    const change = { kind: "recipe", id: id(), fields: { notes: "More salt." }, changedAt: now };
    expect(checkChange(change)).toEqual({ ok: true, value: change });
  });

  it("needs every field for a new recipe", () => {
    const fields = { ...emptyRecipeContent(), title: "Salsa" } as Record<string, unknown>;
    delete fields.nutrition;
    const result = checkChange({
      kind: "recipe",
      id: id(),
      create: { createdAt: new Date().toISOString(), import: null },
      fields,
      changedAt: now,
    });
    expect(result).toEqual({
      ok: false,
      issues: [{ path: "fields.nutrition", problem: "missing" }],
    });
  });

  it("reports unknown fields, bad times and empty changes", () => {
    expect(
      checkChange({ kind: "recipe", id: id(), fields: { owner: "me" }, changedAt: -1 }),
    ).toEqual({
      ok: false,
      issues: [
        { path: "changedAt", problem: "invalid" },
        { path: "fields.owner", problem: "invalid" },
        { path: "fields", problem: "missing" },
      ],
    });
  });

  it("checks opinions, made-it days, categories and links", () => {
    const recipeId = id();
    expect(
      checkChange({ kind: "opinion", recipeId, fields: { rating: 6 }, changedAt: now }).ok,
    ).toBe(false);
    expect(
      checkChange({ kind: "opinion", recipeId, fields: { favorite: true }, changedAt: now }).ok,
    ).toBe(true);
    expect(
      checkChange({ kind: "made", id: id(), recipeId, madeOn: "2026-02-30", changedAt: now }).ok,
    ).toBe(false);
    const categoryId = id();
    expect(
      checkChange({
        kind: "category",
        id: categoryId,
        fields: { parentId: categoryId },
        changedAt: now,
      }),
    ).toEqual({ ok: false, issues: [{ path: "fields.parentId", problem: "invalid" }] });
    expect(
      checkChange({ kind: "category", id: id(), fields: { name: "A › B" }, changedAt: now }).ok,
    ).toBe(false);
    expect(checkChange({ kind: "recipeCategory", recipeId, categoryId, changedAt: now })).toEqual({
      ok: false,
      issues: [{ path: "deleted", problem: "invalid" }],
    });
  });
});

describe("cursors", () => {
  it("round-trip through the pull's since parameter", () => {
    const cursors = { abcDEF123: 812, xyz: 0 };
    expect(parseCursors(formatCursors(cursors))).toEqual(cursors);
    expect(parseCursors(undefined)).toEqual({});
    expect(parseCursors("abc:-1")).toBeNull();
    expect(parseCursors("a b:1")).toBeNull();
    expect(parseCursors("abc:1:2")).toBeNull();
  });
});

describe("small rules", () => {
  it("knows a real day", () => {
    expect(isDay("2026-10-07")).toBe(true);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("10/7/2026")).toBe(false);
  });

  it("tells old and too-new apps apart", () => {
    expect(schemaVersionProblem(RECIPE_SCHEMA_VERSION)).toBeNull();
    expect(schemaVersionProblem(0)).toBe("upgrade_required");
    expect(schemaVersionProblem(RECIPE_SCHEMA_VERSION + 1)).toBe("server_behind");
  });
});
