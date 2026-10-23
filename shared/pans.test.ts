import { describe, expect, it } from "vitest";
import {
  COMMON_PANS,
  bakeNote,
  factorText,
  firstTime,
  panArea,
  panCups,
  panFactor,
  panName,
  readPan,
  recipePan,
  storedPan,
  type Pan,
  type PanShape,
} from "./pans";

// Phase F2: pan-size scaling (spec.md F2, owner's choices 2026-10-23).

const pan = (
  shape: PanShape,
  width: number | null,
  length: number | null = null,
  extra: Partial<Pan> = {},
): Pan => ({ shape, width, length, depth: null, unit: "in", cups: null, count: 1, ...extra });

const factor = (a: Pan, b: Pan) => panFactor(a, b)?.factor ?? null;
const step = (id: string, text: string) => ({ id, text, heading: false });

describe("the math", () => {
  it("compares flat pans by floor area", () => {
    expect(panArea(pan("round", 9))).toBeCloseTo(63.6, 1);
    expect(panArea(pan("square", 8))).toBe(64);
    expect(panArea(pan("rectangle", 9, 13))).toBe(117);
    expect(panArea(pan("round", 8, null, { count: 2 }))).toBeCloseTo(100.5, 1);
    // The spec's example: an 8×8 recipe in a 9×13 pan.
    expect(factor(pan("square", 8), pan("rectangle", 9, 13))).toBeCloseTo(1.828, 3);
    expect(panFactor(pan("square", 8), pan("rectangle", 9, 13))?.by).toBe("area");
    expect(factor(pan("round", 9), pan("square", 8))).toBeCloseTo(1.006, 3);
    expect(factor(pan("rectangle", 9, 13), pan("rectangle", 13, 18))).toBeCloseTo(2, 3);
  });

  it("takes sizes in centimetres too", () => {
    expect(factor(pan("round", 9), pan("round", 23, null, { unit: "cm" }))).toBeCloseTo(1.016, 2);
    expect(factor(pan("rectangle", 23, 33, { unit: "cm" }), pan("rectangle", 9, 13))).toBeCloseTo(
      0.996,
      2,
    );
  });

  it("knows what every pan in the chart holds", () => {
    const cups: [Pan, number][] = [
      [pan("round", 6), 4],
      [pan("round", 8, null, { depth: 1.5 }), 4],
      [pan("round", 8), 6],
      [pan("round", 9, null, { depth: 1.5 }), 6],
      [pan("round", 9), 8],
      [pan("round", 10), 11],
      [pan("round", 9, null, { depth: 2.5 }), 10],
      [pan("round", 9, null, { depth: 3 }), 12],
      [pan("round", 10, null, { depth: 2.5 }), 12],
      [pan("square", 8, null, { depth: 1.5 }), 6],
      [pan("square", 8), 8],
      [pan("square", 9, null, { depth: 1.5 }), 8],
      [pan("square", 9), 10],
      [pan("square", 10), 12],
      [pan("rectangle", 7, 11), 10],
      [pan("rectangle", 9, 13), 14],
      [pan("rectangle", 13, 9), 14],
      [pan("rectangle", 10.5, 15.5), 10],
      [pan("rectangle", 12.5, 17.5), 12],
      [pan("loaf", 4, 8), 4],
      [pan("loaf", 4.5, 8.5), 6],
      [pan("loaf", 5, 9), 8],
      [pan("tube", 8), 9],
      [pan("tube", 9), 12],
      [pan("tube", 10), 16],
      [pan("muffin", null, null, { count: 12, cups: 1 / 2 }), 6],
      [pan("muffin", null, null, { count: 24, cups: 1 / 8 }), 3],
      [pan("bundt", null, null, { cups: 12 }), 12],
    ];
    for (const [p, expected] of cups) expect(panCups(p), panName(p)).toBeCloseTo(expected, 5);
  });

  it("estimates a pan not in the chart, and asks what a Bundt holds", () => {
    // Half sheet: 13×18×1, from its outside measurements.
    expect(panCups(pan("rectangle", 13, 18))).toBeCloseTo(14.3, 1);
    expect(panCups(pan("loaf", 4.5, 10))).toBeCloseTo(6.9, 1);
    expect(panCups(pan("bundt", 10))).toBeNull();
    expect(panCups(pan("tube", 11))).toBeNull();
    expect(panFactor(pan("rectangle", 9, 13), pan("bundt", 10))).toBeNull();
  });

  it("compares pans of different shapes by what they hold", () => {
    expect(
      panFactor(pan("loaf", 5, 9), pan("muffin", null, null, { count: 12, cups: 0.5 })),
    ).toEqual({ factor: 0.75, by: "capacity" });
    expect(factor(pan("rectangle", 9, 13), pan("bundt", null, null, { cups: 12 }))).toBeCloseTo(
      0.857,
      3,
    );
    expect(factor(pan("loaf", 4.5, 8.5), pan("loaf", 5, 9))).toBeCloseTo(1.333, 3);
  });

  it("offers the common pans, every one of them sized", () => {
    for (const p of COMMON_PANS) expect(panCups(p) ?? panArea(p), panName(p)).not.toBeNull();
  });
});

describe("saying it", () => {
  it("names a simple factor and says about for the rest, never the exact number", () => {
    expect(factorText(2)).toBe("Doubled");
    expect(factorText(0.5)).toBe("Halved");
    expect(factorText(3)).toBe("Tripled");
    expect(factorText(1.5)).toBe("1½×");
    expect(factorText(1.828)).toBe("about 1¾×");
    expect(factorText(1.006)).toBe("about 1×");
    expect(factorText(2.36)).toBe("about 2⅓×");
    expect(factorText(0.857)).toBe("about ⅞×");
    expect(factorText(0.545)).toBe("about 0.55×");
    expect(factorText(0.21)).toBe("about ⅕×");
    expect(factorText(4.66)).toBe("about 4⅔×");
  });

  it("is never more than a few percent from the exact factor", () => {
    const pans = COMMON_PANS.filter((p) => p.shape !== "muffin");
    for (const a of pans) {
      for (const b of pans) {
        const f = factor(a, b);
        if (f === null || Math.abs(f - 1) < 1e-9) continue;
        const text = factorText(f).replace(/^about /, "");
        if (/^[A-Z]/.test(text)) continue;
        if (/^\d+\.\d+×$/.test(text)) {
          expect(Math.abs(parseFloat(text) - f) / f).toBeLessThan(0.06);
          continue;
        }
        const [, whole = "0", glyph = ""] = /^(\d*)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]?)×$/u.exec(text) ?? [];
        const parts: Record<string, number> = {
          "": 0,
          "½": 1 / 2,
          "⅓": 1 / 3,
          "⅔": 2 / 3,
          "¼": 1 / 4,
          "¾": 3 / 4,
          "⅕": 1 / 5,
          "⅖": 2 / 5,
          "⅗": 3 / 5,
          "⅘": 4 / 5,
          "⅙": 1 / 6,
          "⅚": 5 / 6,
          "⅛": 1 / 8,
          "⅜": 3 / 8,
          "⅝": 5 / 8,
          "⅞": 7 / 8,
        };
        const shown = Number(whole || 0) + (parts[glyph] ?? Number.NaN);
        expect(Math.abs(shown - f) / f, `${panName(a)} → ${panName(b)}: ${text}`).toBeLessThan(
          0.06,
        );
      }
    }
  });

  it("names pans the way people do", () => {
    expect(panName(pan("rectangle", 9, 13))).toBe("9×13");
    expect(panName(pan("square", 8))).toBe("8×8");
    expect(panName(pan("round", 9))).toBe("9″ round");
    expect(panName(pan("round", 23, null, { unit: "cm" }))).toBe("23 cm round");
    expect(panName(pan("round", 8, null, { count: 2 }))).toBe("2 × 8″ round");
    expect(panName(pan("loaf", 4.5, 8.5))).toBe("8½×4½ loaf");
    expect(panName(pan("muffin", null, null, { count: 24, cups: 1 / 8 }))).toBe("24 mini muffins");
    expect(panName(pan("bundt", null, null, { cups: 12 }))).toBe("12-cup Bundt");
    expect(panName(pan("loaf", null))).toBe("loaf pan");
  });

  it("checks a stored pan", () => {
    expect(storedPan(pan("rectangle", 9, 13))).toEqual(pan("rectangle", 9, 13));
    expect(storedPan({ ...pan("rectangle", 9, 13), shape: "oval" })).toBeNull();
    expect(storedPan({ ...pan("rectangle", 9, 13), width: -1 })).toBeNull();
    expect(storedPan({ ...pan("rectangle", 9, 13), count: 0 })).toBeNull();
    expect(storedPan(null)).toBeNull();
  });
});

describe("reading the recipe's pan", () => {
  const read = (text: string) => {
    const found = readPan(text);
    return found ? panName(found.pan) : null;
  };

  it("reads the ways recipes write their pans", () => {
    expect(read("Line a 9x13 inch pan with aluminum foil.")).toBe("9×13");
    expect(read("Line a 9×13 baking dish with foil.")).toBe("9×13");
    expect(read("Transfer to a 13-by-9-inch baking dish.")).toBe("9×13");
    expect(read("Lightly butter a 13×9” (33x23cm) baking dish.")).toBe("9×13");
    expect(read("Grease a rimmed 13-by-18-inch half sheet pan.")).toBe("13×18");
    expect(read("Line an 8x8-inch square baking pan with foil.")).toBe("8×8");
    expect(read("Place in greased 9- x 5- inch loaf pan.")).toBe("9×5 loaf");
    expect(read("Spray 8 1/2 by 4 1/2-inch loaf pan with oil.")).toBe("8½×4½ loaf");
    expect(read("Lightly grease two 8-inch round cake pans.")).toBe("2 × 8″ round");
    expect(read("Grease two 8 or 9-inch round baking pans.")).toBe("2 × 8″ round");
    expect(read("Place in a 9-inch glass pie plate.")).toBe("9″ round");
    expect(read("Bake in a greased 8 inch pan at 400.")).toBe("8″ round");
    expect(read("Use a 23 cm springform tin.")).toBe("23 cm round");
    expect(read("Grease a 10-inch tube pan.")).toBe("10″ tube");
    expect(read("Spray a 12-cup Bundt pan.")).toBe("12-cup Bundt");
    expect(read("Spray or grease 12 muffin cups.")).toBe("12 muffins");
    expect(read("Fill 24 mini muffin cups.")).toBe("24 mini muffins");
    expect(read("Line two 9x13 pans.")).toBe("2 × 9×13");
  });

  it("isn't fooled by other sizes", () => {
    expect(read("Cut into 1-inch cubes and place in the pan.")).toBeNull();
    expect(read("Place 3 inches apart on the baking sheet.")).toBeNull();
    expect(read("Transfer to an 8 to 10-quart pan.")).toBeNull();
    expect(read("Roll out to 1/2-inch thick.")).toBeNull();
    expect(read("Bake for 25 minutes in the pan.")).toBeNull();
  });

  it("looks in the method first, says where, and asks for a size not written", () => {
    const recipe = {
      directions: [step("a", "Heat the oven."), step("b", "Grease a 9x5-inch loaf pan.")],
      notes: "Or bake as 12 muffins for 20 minutes.",
      servings: { count: 10, yield: null },
      ingredients: [],
    };
    expect(recipePan(recipe)).toMatchObject({ from: "method", sizeMissing: false });
    expect(panName(recipePan(recipe)!.pan)).toBe("9×5 loaf");
    const bare = { ...recipe, directions: [step("a", "Pour into a greased loaf pan.")], notes: "" };
    expect(recipePan(bare)).toMatchObject({ from: "method", sizeMissing: true });
    const muffins = {
      ...recipe,
      directions: [step("a", "Fill the muffin cups.")],
      notes: "",
      servings: { count: null, yield: "Makes 18 muffins" },
    };
    expect(panName(recipePan(muffins)!.pan)).toBe("18 muffins");
    expect(recipePan({ ...recipe, directions: [step("a", "Simmer.")], notes: "" })).toBeNull();
  });
});

describe("the bake time", () => {
  const cake = {
    directions: [
      step("1", "Heat the oven to 350°F and grease an 8x8-inch pan."),
      step("2", "Mix everything together."),
      step("3", "Bake 30 to 35 minutes, until a toothpick comes out clean."),
    ],
    notes: "",
  };
  const eight = pan("square", 8);
  const nineByThirteen = pan("rectangle", 9, 13);

  it("reads the first time a step gives", () => {
    expect(firstTime("Bake 30 to 35 minutes")).toBe(30);
    expect(firstTime("Bake for 1 hour")).toBe(60);
    expect(firstTime("Bake about an hour")).toBe(60);
    expect(firstTime("Bake 1 to 1 1/4 hours")).toBe(60);
    expect(firstTime("Bake until golden")).toBeNull();
  });

  it("keeps the recipe's time when the batter is the same depth, under the bake step", () => {
    const f = panFactor(eight, nineByThirteen)!.factor;
    expect(bakeNote(cake, { recipe: eight, yours: nineByThirteen }, f)).toEqual({
      stepId: "3",
      text: "Same depth of batter in your 9×13, so about the same time. Start checking at 25 minutes.",
    });
  });

  it("gives only the direction when the batter is deeper or shallower", () => {
    const f = panFactor(eight, nineByThirteen)!.factor;
    expect(bakeNote(cake, { recipe: eight, yours: nineByThirteen }, f * 1.5)?.text).toMatch(
      /deeper .* longer\. Check with a toothpick\.$/,
    );
    expect(bakeNote(cake, { recipe: eight, yours: nineByThirteen }, 1)?.text).toMatch(
      /shallower .* faster\. Start checking early\.$/,
    );
  });

  it("quotes the recipe's own time for the person's pan", () => {
    const withMuffins = {
      ...cake,
      notes: "For muffins, fill 12 muffin cups and bake 18 to 20 minutes.",
    };
    const muffins = pan("muffin", null, null, { count: 12, cups: 0.5 });
    expect(bakeNote(withMuffins, { recipe: eight, yours: muffins }, 0.75)).toEqual({
      stepId: "3",
      text: "The recipe gives a time for your pan: “For muffins, fill 12 muffin cups and bake 18 to 20 minutes.”",
    });
  });

  it("gives no minutes for a change of shape", () => {
    const loaf = pan("loaf", 5, 9);
    const muffins = pan("muffin", null, null, { count: 12, cups: 0.5 });
    expect(bakeNote(cake, { recipe: loaf, yours: muffins }, 0.75)?.text).toBe(
      "Muffins bake much faster than a 9×5 loaf. Start checking early and use a toothpick.",
    );
    expect(bakeNote(cake, { recipe: muffins, yours: loaf }, 1.33)?.text).toBe(
      "A 9×5 loaf bakes much longer than muffins. Check with a toothpick before taking it out.",
    );
    expect(
      bakeNote(
        cake,
        { recipe: nineByThirteen, yours: pan("bundt", null, null, { cups: 12 }) },
        0.86,
      )?.text,
    ).not.toMatch(/\d/);
  });

  it("says nothing when no step gives a bake time", () => {
    const noTime = { directions: [step("1", "Bake until golden.")], notes: "" };
    expect(bakeNote(noTime, { recipe: eight, yours: nineByThirteen }, 1.83)).toBeNull();
  });
});
