import { describe, expect, it } from "vitest";
import { COMMON_PANS } from "../../shared/pans";
import { emptyRecipeContent, type Recipe } from "../../shared/recipe";
import { factsLine, printScale, scaleLine } from "./printing";

// Phase F6: what a printed recipe says about how it's shown.

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    ...emptyRecipeContent(),
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    ownerUserId: "me",
    updatedByUserId: "me",
    createdAt: "2026-01-01T00:00:00Z",
    copiedFrom: null,
    import: null,
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    serverSeq: 1,
    ...over,
  };
}

const [, nine, , , , , nineByThirteen] = COMMON_PANS;

describe("the line saying how a printed recipe is shown", () => {
  const line = (over: Partial<Recipe>, units: "written" | "us" | "metric" = "written") =>
    scaleLine(printScale(recipe(over), units));

  it("says nothing for a recipe as written", () => {
    expect(line({})).toBeNull();
  });

  it("names a simple scale and says changed amounts are in bold", () => {
    expect(line({ scale: { factor: 2, held: [] } })).toBe(
      "Doubled from the original. Changed amounts are in bold.",
    );
    expect(line({ scale: { factor: 1.5, held: [] } }, "metric")).toBe(
      "Scaled 1½× from the original, shown in metric. Changed amounts are in bold.",
    );
    expect(line({}, "us")).toBe("Shown in US units. Changed amounts are in bold.");
  });

  it("names the person's pan, never the exact factor", () => {
    if (!nine || !nineByThirteen) throw new Error("pans");
    expect(
      line({ scale: { factor: 1.8366, held: [], pans: { recipe: nine, yours: nineByThirteen } } }),
    ).toBe("Scaled for your 9×13 (about 1¾×). Changed amounts are in bold.");
  });
});

describe("the printed facts", () => {
  it("lists the times and what it makes, scaled", () => {
    const r = recipe({
      times: {
        prep: { minutes: 15, text: null },
        cook: { minutes: null, text: null },
        total: { minutes: 45, text: null },
      },
      servings: { count: 6, yield: null },
      scale: { factor: 2, held: [] },
    });
    expect(factsLine(r, printScale(r, "written"))).toEqual([
      "Prep 15 min",
      "Total 45 min",
      "Serves 12",
    ]);
  });
});
