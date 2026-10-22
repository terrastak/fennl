import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readIngredient } from "../shared/ingredients";

// Phase E2: the ingredient reader over the owner's whole Paprika library (test_recipes/, 827
// recipes, text only). A .paprikarecipes file is a zip of gzipped JSON recipes. When this was written,
// 6,914 of the 7,861 different lines had an amount; most of the rest have none ("Salt").

function libraryLines(): string[] {
  const zip = unzipSync(new Uint8Array(readFileSync("test_recipes/all-recipes.paprikarecipes")));
  const lines = new Set<string>();
  for (const file of Object.values(zip)) {
    const recipe = JSON.parse(gunzipSync(file).toString("utf8")) as { ingredients?: string };
    for (const line of (recipe.ingredients ?? "").split("\n")) {
      if (line.trim()) lines.add(line.trim());
    }
  }
  return [...lines];
}

describe("a real recipe library", () => {
  it("reads every ingredient line, finding an amount on most", () => {
    const lines = libraryLines();
    expect(lines.length).toBeGreaterThan(7000);
    let withAmount = 0;
    for (const line of lines) {
      const r = readIngredient(line);
      if (r.quantity || r.unit) withAmount++;
      for (const a of r.amounts) {
        expect(a.start, line).toBeGreaterThanOrEqual(0);
        expect(a.end, line).toBeLessThanOrEqual(line.length);
        expect(Number.isFinite(a.low), line).toBe(true);
      }
    }
    expect(withAmount / lines.length).toBeGreaterThan(0.85);
  });
});
