import { describe, expect, it } from "vitest";
import { importChanges, readExportFile, type ExportFile } from "./exportFormat";
import { emptyRecipeContent } from "./recipe";
import type { SyncChange } from "./sync";

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function file(): ExportFile {
  const recipe = (title: string) => ({
    ...emptyRecipeContent(),
    title,
    id: newId(),
    ownerUserId: "june",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    copiedFrom: null,
    import: null,
    categories: ["Desserts › Cakes"],
    opinions: [
      { userId: "june", rating: 5, favorite: false, note: "Mine" },
      { userId: "sam", rating: 2, favorite: false, note: "Sam's" },
    ],
    made: [
      { userId: "june", madeOn: "2026-10-01" },
      { userId: "sam", madeOn: "2026-10-02" },
    ],
  });
  return {
    format: "fennl-export",
    version: 1,
    exportedAt: "2026-10-08T00:00:00.000Z",
    exportedBy: { userId: "june", name: "June" },
    people: [
      { userId: "june", name: "June" },
      { userId: "sam", name: "Sam" },
    ],
    categories: ["Desserts", "Desserts › Cakes", "Someday"],
    recipes: [recipe("Cake"), { ...recipe(""), title: "" }],
  };
}

describe("reading an export back", () => {
  it("brings the exporter's own notes, with their dates, not other people's", () => {
    const original = file();
    const cake = original.recipes[0]!;
    original.version = 3;
    original.recipes = [
      {
        ...cake,
        opinions: [{ userId: "june", rating: 4, favorite: true }],
        signedNotes: [
          { userId: "june", text: "First", writtenAt: "2026-10-01T12:00:00.000Z", editedAt: null },
          { userId: "sam", text: "Sam's", writtenAt: "2026-10-02T12:00:00.000Z", editedAt: null },
          {
            userId: "june",
            text: " Second ",
            writtenAt: "2026-10-03T12:00:00.000Z",
            editedAt: null,
          },
        ],
      },
    ];
    const plan = importChanges(original, { now: 1000, newId });
    expect(plan.changes.filter((c) => c.kind === "note")).toEqual([
      expect.objectContaining({ text: "First", writtenAt: "2026-10-01T12:00:00.000Z" }),
      expect.objectContaining({ text: "Second", writtenAt: "2026-10-03T12:00:00.000Z" }),
    ]);
  });

  it("knows its own files", () => {
    expect(readExportFile({ format: "something-else" })).toBeNull();
    expect(readExportFile({ ...file(), version: 99 })).toBeNull();
    expect(readExportFile(file())).not.toBeNull();
  });

  it("adds the recipes with new IDs, skipping any it can't read", () => {
    const original = file();
    const plan = importChanges(original, { now: 1000, newId });
    expect(plan.recipes).toBe(1);
    expect(plan.skipped).toEqual(["Untitled"]);
    const kinds = plan.changes.map((c) => c.kind);
    expect(kinds.filter((k) => k === "category")).toHaveLength(3);
    const created = plan.changes.find((c) => c.kind === "recipe") as Extract<
      SyncChange,
      { kind: "recipe" }
    >;
    expect(created.id).not.toBe(original.recipes[0]?.id);
    expect(created.create?.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("brings the exporter's own rating and made-it days, not other people's", () => {
    const plan = importChanges(file(), { now: 1000, newId });
    const opinions = plan.changes.filter((c) => c.kind === "opinion");
    expect(opinions).toEqual([expect.objectContaining({ fields: { rating: 5, favorite: false } })]);
    // An earlier file's note (version 1) comes as one entry of theirs.
    const notes = plan.changes.filter((c) => c.kind === "note");
    expect(notes).toEqual([expect.objectContaining({ text: "Mine" })]);
    const made = plan.changes.filter((c) => c.kind === "made");
    expect(made).toEqual([expect.objectContaining({ madeOn: "2026-10-01" })]);
  });
});
