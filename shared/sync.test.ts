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

  it("takes the source's newer version on an imported recipe, alone or with fields", () => {
    const newer = {
      source: "paprika",
      importJobId: null,
      externalId: "PAPRIKA-1",
      externalHash: "h2",
      importedAt: new Date().toISOString(),
      photos: ["A1", "B2"],
    };
    const alone = { kind: "recipe", id: id(), import: newer, fields: {}, changedAt: now };
    expect(checkChange(alone)).toEqual({ ok: true, value: alone });
    expect(checkChange({ ...alone, import: { ...newer, photos: [""] } })).toMatchObject({
      ok: false,
      issues: [{ path: "import", problem: "invalid" }],
    });
    expect(checkChange({ ...alone, import: null })).toMatchObject({ ok: false });
    const fields = { ...emptyRecipeContent(), title: "Salsa" };
    expect(
      checkChange({
        ...alone,
        create: { createdAt: new Date().toISOString(), import: newer },
        fields,
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "import", problem: "invalid" }] });
  });

  it("takes a photo's time taken and who arranged it (phase D4)", () => {
    const photo = {
      kind: "photo",
      id: id(),
      recipeId: id(),
      create: { imageHash: "a".repeat(64), role: "photo", width: 10, height: 10, takenAt: 1000 },
      fields: { sortOrder: 1, arrangedBy: "fennl" },
      changedAt: now,
    };
    expect(checkChange(photo)).toEqual({ ok: true, value: photo });
    expect(checkChange({ ...photo, fields: { sortOrder: 1, arrangedBy: "robot" } })).toMatchObject({
      ok: false,
      issues: [{ path: "fields.arrangedBy", problem: "invalid" }],
    });
    expect(checkChange({ ...photo, create: { ...photo.create, takenAt: -5 } })).toMatchObject({
      ok: false,
      issues: [{ path: "create", problem: "invalid" }],
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
    // A note entry (U7): words when added or changed, or removed; never empty words.
    const noteId = id();
    expect(
      checkChange({ kind: "note", id: noteId, recipeId, text: "Less sugar.", changedAt: now }),
    ).toEqual({
      ok: true,
      value: { kind: "note", id: noteId, recipeId, text: "Less sugar.", changedAt: now },
    });
    expect(
      checkChange({ kind: "note", id: noteId, recipeId, deleted: true, changedAt: now }).ok,
    ).toBe(true);
    expect(checkChange({ kind: "note", id: noteId, recipeId, text: "  ", changedAt: now })).toEqual(
      { ok: false, issues: [{ path: "text", problem: "invalid" }] },
    );
    expect(checkChange({ kind: "note", id: noteId, recipeId, changedAt: now })).toEqual({
      ok: false,
      issues: [{ path: "text", problem: "missing" }],
    });
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
