import { describe, expect, it } from "vitest";
import { checkChange } from "../../shared/sync";
import { SAMPLE_COUNT, sampleRecipeChanges } from "./samples";

describe("sample recipes", () => {
  it("are valid changes, with each category made before it's used", () => {
    const changes = sampleRecipeChanges();
    for (const change of changes) expect(checkChange(change)).toMatchObject({ ok: true });
    expect(changes.filter((c) => c.kind === "recipe")).toHaveLength(SAMPLE_COUNT);

    const made = new Set<string>();
    for (const change of changes) {
      if (change.kind === "category") {
        if (change.fields.parentId) expect(made.has(change.fields.parentId)).toBe(true);
        made.add(change.id);
      }
      if (change.kind === "recipeCategory") expect(made.has(change.categoryId)).toBe(true);
    }
  });
});
