import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPaprikaRecipe } from "./paprika";
import { bytesSource, paprikaEntries, readPaprikaEntry } from "./paprikaFile";
import type { RecipeServings } from "./recipe";
import {
  formatServesOrMakes,
  leadingCount,
  parseServesOrMakes,
  servesOrMakesReading,
  wordsSayServes,
} from "./servings";

// U27 (owner's choice 2026-11-21): one "Serves or makes" box for the two stored fields.

const s = (count: number | null, made: string | null = null): RecipeServings => ({
  count,
  yield: made,
});

describe("reading the box", () => {
  it("reads a number as how many it serves, and words with a number as what it makes", () => {
    expect(parseServesOrMakes("4")).toEqual(s(4));
    expect(parseServesOrMakes(" 4 ")).toEqual(s(4));
    expect(parseServesOrMakes("24 cookies")).toEqual(s(24, "24 cookies"));
    expect(parseServesOrMakes("makes 2 loaves")).toEqual(s(2, "makes 2 loaves"));
    expect(parseServesOrMakes("2 (10-inch) crusts")).toEqual(s(2, "2 (10-inch) crusts"));
    expect(parseServesOrMakes("")).toEqual(s(null));
    expect(parseServesOrMakes("   ")).toEqual(s(null));
  });

  it("reads both in one", () => {
    expect(parseServesOrMakes("Serves 8, makes about 24 pancakes")).toEqual(
      s(8, "about 24 pancakes"),
    );
    expect(parseServesOrMakes("serves 8; makes 24")).toEqual(s(8, "24"));
    expect(parseServesOrMakes("Serves 4 and makes 2 loaves")).toEqual(s(4, "2 loaves"));
    expect(parseServesOrMakes("Makes 24 pancakes, serves 8")).toEqual(s(8, "24 pancakes"));
    expect(parseServesOrMakes("24 pancakes (serves 8)")).toEqual(s(8, "24 pancakes"));
  });

  it("drops words that only say how many it serves", () => {
    expect(parseServesOrMakes("8 servings")).toEqual(s(8));
    expect(parseServesOrMakes("Serves 4")).toEqual(s(4));
    expect(parseServesOrMakes("serves: 12")).toEqual(s(12));
    expect(parseServesOrMakes("Makes 6 servings")).toEqual(s(6));
    expect(parseServesOrMakes("4 people")).toEqual(s(4));
    // "Makes 24" says what it makes, not who it serves.
    expect(parseServesOrMakes("Makes 24")).toEqual(s(24, "Makes 24"));
  });

  it("keeps words the recipe page couldn't count from with no count, so it shows them whole", () => {
    // The page would say just "Makes 24", "Makes 1", "Makes 4" (U27 review, 2026-11-21).
    expect(parseServesOrMakes("about 24 pancakes")).toEqual(s(null, "about 24 pancakes"));
    expect(parseServesOrMakes("Makes about 4 cups")).toEqual(s(null, "Makes about 4 cups"));
    expect(parseServesOrMakes("approximately 3 dozen")).toEqual(s(null, "approximately 3 dozen"));
    expect(parseServesOrMakes("1 loaf")).toEqual(s(null, "1 loaf"));
    expect(parseServesOrMakes("Makes 1 loaf")).toEqual(s(null, "Makes 1 loaf"));
    expect(parseServesOrMakes("12 -14 Slices")).toEqual(s(null, "12 -14 Slices"));
    expect(parseServesOrMakes("12 doughnuts and 12 holes")).toEqual(
      s(null, "12 doughnuts and 12 holes"),
    );
  });

  it("reads a range on its own as how many it serves", () => {
    expect(parseServesOrMakes("4-6")).toEqual(s(4, "Serves 4-6"));
    expect(parseServesOrMakes("4 – 6")).toEqual(s(4, "Serves 4 – 6"));
    expect(parseServesOrMakes("4 to 6")).toEqual(s(4, "Serves 4 to 6"));
    expect(parseServesOrMakes("4 or 5")).toEqual(s(4, "Serves 4 or 5"));
    expect(servesOrMakesReading(parseServesOrMakes("4 to 6"))).toBe("Serves 4 to 6");
    expect(formatServesOrMakes(parseServesOrMakes("4-6"))).toBe("Serves 4-6");
  });

  it("keeps other words as written, counting the first whole number after Serves", () => {
    expect(parseServesOrMakes("Serves 6 to 8")).toEqual(s(6, "Serves 6 to 8"));
    expect(parseServesOrMakes("Feeds 4")).toEqual(s(4));
    expect(parseServesOrMakes("Serves 6 to 8, makes 2 loaves")).toEqual(
      s(6, "Serves 6 to 8, makes 2 loaves"),
    );
    expect(parseServesOrMakes("1/2 cup")).toEqual(s(null, "1/2 cup"));
    expect(parseServesOrMakes("1½ loaves")).toEqual(s(null, "1½ loaves"));
    expect(parseServesOrMakes("2 1/2 dozen")).toEqual(s(null, "2 1/2 dozen"));
    expect(parseServesOrMakes("a big pot")).toEqual(s(null, "a big pot"));
    expect(parseServesOrMakes("Makes about 6 cups; 10 servings")).toEqual(
      s(null, "Makes about 6 cups; 10 servings"),
    );
  });

  it("rounds a number as the old Serves box did, and keeps 0 so the editor can say so", () => {
    expect(parseServesOrMakes("2.6")).toEqual(s(3));
    expect(parseServesOrMakes("0")).toEqual(s(0));
    expect(leadingCount("99999 cookies")).toBeNull();
  });
});

describe("showing the box", () => {
  it("shows each shape the way the box reads it", () => {
    expect(formatServesOrMakes(s(4))).toBe("4");
    expect(formatServesOrMakes(s(24, "24 cookies"))).toBe("24 cookies");
    expect(formatServesOrMakes(s(8, "about 24 pancakes"))).toBe(
      "Serves 8, makes about 24 pancakes",
    );
    expect(formatServesOrMakes(s(12, "Makes 1 dozen brownies"))).toBe(
      "Serves 12, makes 1 dozen brownies",
    );
    expect(formatServesOrMakes(s(null, "2 loaves"))).toBe("2 loaves");
    expect(formatServesOrMakes(s(8, "Serves 8 to 10"))).toBe("Serves 8 to 10");
    expect(formatServesOrMakes(s(null))).toBe("");
    expect(formatServesOrMakes(s(24, "about 24 pancakes"))).toBe(
      "Serves 24, makes about 24 pancakes",
    );
    expect(formatServesOrMakes(s(1, "1 loaf"))).toBe("Serves 1, makes 1 loaf");
    expect(formatServesOrMakes(s(8, "24"))).toBe("Serves 8, makes 24");
    expect(formatServesOrMakes(s(4, "Feeds 4"))).toBe("Feeds 4");
    expect(formatServesOrMakes(s(6, "makes 12 muffins, serves 6"))).toBe(
      "makes 12 muffins, serves 6",
    );
    expect(parseServesOrMakes(formatServesOrMakes(s(1.5, "1.5 quarts")))).toEqual(
      s(1.5, "1.5 quarts"),
    );
  });

  it("shows the count when words about serving say another number", () => {
    // The page shows and scales by the count; the old editor let the two be changed apart.
    expect(formatServesOrMakes(s(6, "Serves 4"))).toBe("6");
    expect(formatServesOrMakes(s(10, "Serves 8 to 10"))).toBe("10");
    expect(formatServesOrMakes(s(5, "Serves: 8"))).toBe("5");
    expect(formatServesOrMakes(s(6, "4-6"))).toBe("6");
    expect(parseServesOrMakes(formatServesOrMakes(s(6, "Serves 4")))).toEqual(s(6));
  });

  it("says how Fennl reads it, as the recipe page will", () => {
    expect(servesOrMakesReading(s(4))).toBe("Serves 4");
    expect(servesOrMakesReading(parseServesOrMakes("24 cookies"))).toBe("Makes 24 cookies");
    expect(servesOrMakesReading(parseServesOrMakes("Serves 8, makes about 24 pancakes"))).toBe(
      "Serves 8, makes about 24 pancakes",
    );
    expect(servesOrMakesReading(parseServesOrMakes("8 servings"))).toBe("Serves 8");
    expect(servesOrMakesReading(s(null))).toBe("");
    expect(servesOrMakesReading(s(null, "One 9-inch pie"))).toBe("Makes one 9-inch pie");
    expect(servesOrMakesReading(s(null, "About 2 cups"))).toBe("Makes about 2 cups");
    expect(servesOrMakesReading(s(null, "Grandma's loaf tin"))).toBe("Makes Grandma's loaf tin");
  });
});

// ---------------------------------------------------------------------------------------------
// Nothing stored is lost: every shape in the repository, shown in the box and read back.
// ---------------------------------------------------------------------------------------------

const root = join(import.meta.dirname, "..");

/** The import test set's correct answers. */
async function testSetShapes(): Promise<RecipeServings[]> {
  const dir = join(root, "import-quality/expected");
  const shapes: RecipeServings[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const answer = JSON.parse(await readFile(join(dir, file), "utf8")) as {
      servings?: Partial<RecipeServings>;
      recipes?: { servings?: Partial<RecipeServings> }[];
    };
    for (const r of [answer, ...(answer.recipes ?? [])]) {
      if (r.servings) shapes.push(s(r.servings.count ?? null, r.servings.yield ?? null));
    }
  }
  return shapes;
}

/** Every recipe in the owner's Paprika library (the text-only copy), as Fennl imports it. */
async function paprikaShapes(): Promise<RecipeServings[]> {
  const bytes = await readFile(join(root, "test_recipes/all-recipes.paprikarecipes"));
  const source = bytesSource(new Uint8Array(bytes));
  const { recipes } = await paprikaEntries(source);
  const shapes: RecipeServings[] = [];
  for (const entry of recipes) {
    const read = readPaprikaRecipe(await readPaprikaEntry(source, entry), entry.name);
    if ("problem" in read) continue;
    const servings = read.draft.fields.servings?.value;
    if (servings) shapes.push(servings);
  }
  return shapes;
}

/** The app's sample recipes (app/recipes/samples.ts) and the shapes people type. */
const OTHER_SHAPES = [
  s(6),
  s(4, "about 12 pancakes"),
  s(10, "one 9-inch cake"),
  s(null, "Makes about 4 cups"),
  s(6, "Makes 6 servings"),
  s(48, "4 doz."),
  s(12, "Serves: 12"),
  s(12, "12 -14 Slices"),
  s(10, "Makes about 6 cups; 10 servings"),
  s(12, "Makes 12 doughnuts and 12 holes"),
  s(2, "2 (10-inch) crusts"),
  s(null, "1/2 cup"),
  s(8, "24"),
  s(1, "1 loaf"),
  s(null, "1 loaf"),
  s(24, "about 24 pancakes"),
  s(4, "4-6"),
  s(6, "Serves 4"),
  s(10, "Serves 8 to 10"),
  s(5, "Serves: 8"),
  s(4, "Feeds 4"),
  s(6, "makes 12 muffins, serves 6"),
  s(1.5, "1.5 quarts"),
  s(12, "One 9-inch pie"),
];

/** The same words, give or take a leading "Makes" (the box's own "makes" says it). */
const sameWords = (a: string | null, b: string | null) =>
  (a ?? "").replace(/^(?:makes|yields?)\s*:?\s*/iu, "") ===
  (b ?? "").replace(/^(?:makes|yields?)\s*:?\s*/iu, "");

/**
 * Words that said no more than how many it serves ("Serves 4", "6 servings"), or said it with
 * another number than the count, which the recipe page shows and scales by.
 */
const onlySaysServes = (stored: RecipeServings) => {
  if (stored.yield === null) return false;
  const read = parseServesOrMakes(stored.yield);
  if (stored.count !== null && read.count !== stored.count) return wordsSayServes(stored.yield);
  return read.yield === null;
};

/**
 * The same words, or a range on its own that gains "Serves" ("4-6" → "Serves 4-6"), or words
 * whose "serves 6" became the count ("makes 12 muffins, serves 6" → "12 muffins").
 */
const sameOrServes = (back: string | null, stored: string | null) =>
  sameWords(back, stored) ||
  (stored !== null && back === `Serves ${stored.trim()}`) ||
  (stored !== null && back !== null && /\bserves\b/iu.test(stored) && stored.includes(back));

describe("opening a recipe and saving it", () => {
  it("loses nothing, for every shape in the repository", async () => {
    const shapes = [...OTHER_SHAPES, ...(await testSetShapes()), ...(await paprikaShapes())];
    expect(shapes.length).toBeGreaterThan(200);
    for (const stored of shapes) {
      const shown = formatServesOrMakes(stored);
      const back = parseServesOrMakes(shown);
      const where = `${JSON.stringify(stored)} shown as "${shown}"`;
      // The count is kept; a recipe without one may gain the number its words start with.
      if (stored.count !== null) expect(back.count, where).toBe(stored.count);
      // The words are kept, unless they only said how many it serves.
      if (!onlySaysServes(stored)) expect(sameOrServes(back.yield, stored.yield), where).toBe(true);
      // And it reads the same however often it's saved.
      expect(parseServesOrMakes(formatServesOrMakes(back)), where).toEqual(back);
      expect(formatServesOrMakes(back), where).toBe(formatServesOrMakes(parseServesOrMakes(shown)));
    }
  });
});
