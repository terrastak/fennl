import type { DirectionStep } from "./recipe";

// Pan-size scaling (phase F2, owner's choices 2026-10-23, spec.md F2). Flat pans (round, square,
// rectangle) are compared by floor area, so the batter stays the same depth; shaped pans (loaf,
// tube, bundt, muffin) by how much they hold, from Joy of Baking's "Pan Sizes" chart (checked
// 2026-10-23). The factor is exact; it's only ever shown as a friendly "about 1¾×". A bake time
// is suggested only where Fennl can be sure, and the oven temperature is never changed.

export const PAN_SHAPES = [
  "round",
  "square",
  "rectangle",
  "loaf",
  "tube",
  "bundt",
  "muffin",
] as const;
export type PanShape = (typeof PAN_SHAPES)[number];
export type PanUnit = "in" | "cm";

export interface Pan {
  shape: PanShape;
  /** Across (round, tube, bundt), a side (square), or the shorter side (rectangle, loaf). */
  width: number | null;
  /** The longer side (rectangle, loaf). */
  length: number | null;
  /** How tall its sides are, when known. */
  depth: number | null;
  unit: PanUnit;
  /** What one holds, in cups, when it's given or asked (a bundt); for muffins, each cup's. */
  cups: number | null;
  /** How many pans ("two 8-inch rounds"), or muffin cups. */
  count: number;
}

const FLAT = new Set<PanShape>(["round", "square", "rectangle"]);
export const isFlat = (pan: Pan) => FLAT.has(pan.shape);

const CM = 2.54;
/** One US cup in cubic inches. */
const CUP = 14.4375;
/**
 * Real pans hold less than their outside measurements (sloped sides, rounded corners): Joy of
 * Baking's capacities are 0.86 to 0.91 of length × width × depth, so a size not in the chart is
 * estimated the same way.
 */
const FILL = 0.88;

const inches = (value: number | null, unit: PanUnit) =>
  value === null ? null : unit === "cm" ? value / CM : value;

/** The standard muffin cups (Joy of Baking): mini, shallow and standard, in cups. */
export const MUFFIN_CUPS = { mini: 1 / 8, shallow: 1 / 4, standard: 1 / 2 } as const;

/** Joy of Baking's "Pan Sizes" capacities, in cups: [shape, width, length, depth, cups]. */
const CHART: [PanShape, number, number | null, number, number][] = [
  ["round", 6, null, 2, 4],
  ["round", 8, null, 1.5, 4],
  ["round", 8, null, 2, 6],
  ["round", 9, null, 1.5, 6],
  ["round", 9, null, 2, 8],
  ["round", 10, null, 2, 11],
  ["round", 9, null, 2.5, 10],
  ["round", 9, null, 3, 12],
  ["round", 10, null, 2.5, 12],
  ["square", 8, null, 1.5, 6],
  ["square", 8, null, 2, 8],
  ["square", 9, null, 1.5, 8],
  ["square", 9, null, 2, 10],
  ["square", 10, null, 2, 12],
  ["rectangle", 7, 11, 2, 10],
  ["rectangle", 9, 13, 2, 14],
  ["rectangle", 10.5, 15.5, 1, 10],
  ["rectangle", 12.5, 17.5, 1, 12],
  ["loaf", 4, 8, 2.5, 4],
  ["loaf", 4.5, 8.5, 2.5, 6],
  ["loaf", 5, 9, 3, 8],
  ["tube", 8, null, 3, 9],
  ["tube", 9, null, 3, 12],
  ["tube", 10, null, 4, 16],
];

/** The depth a pan is taken to have when nobody says: the chart's usual one. */
function usualDepth(shape: PanShape, width: number, length: number | null): number {
  if (shape === "rectangle" && (length ?? 0) >= 15) return 1;
  if (shape === "loaf") return width >= 5 ? 3 : 2.5;
  if (shape === "tube") return width >= 10 ? 4 : 3;
  return 2;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.3;

/** A pan's floor area in square inches (all of them, when there are several), or null. */
export function panArea(pan: Pan): number | null {
  const w = inches(pan.width, pan.unit);
  if (w === null || w <= 0) return null;
  if (pan.shape === "round") return Math.PI * (w / 2) ** 2 * pan.count;
  if (pan.shape === "square") return w * w * pan.count;
  if (pan.shape === "rectangle") {
    const l = inches(pan.length, pan.unit);
    return l === null || l <= 0 ? null : w * l * pan.count;
  }
  return null;
}

/** What a pan holds in cups (all of them, when there are several), or null if it must be asked. */
export function panCups(pan: Pan): number | null {
  if (pan.shape === "muffin") return pan.count * (pan.cups ?? MUFFIN_CUPS.standard);
  if (pan.cups !== null) return pan.cups * pan.count;
  const w = inches(pan.width, pan.unit);
  if (w === null || pan.shape === "bundt") return null;
  const l = inches(pan.length, pan.unit);
  const [short, long] = l !== null && l < w ? [l, w] : [w, l];
  const depth = inches(pan.depth, pan.unit) ?? usualDepth(pan.shape, short, long);
  const listed = CHART.find(
    ([shape, cw, cl, cd]) =>
      shape === pan.shape &&
      near(cw, short) &&
      (cl === null ? long === null : long !== null && near(cl, long)) &&
      near(cd, depth),
  );
  if (listed) return listed[4] * pan.count;
  if (pan.shape === "tube") return null;
  if (pan.shape === "loaf") {
    return long === null ? null : ((short * long * depth) / CUP) * FILL * pan.count;
  }
  const area = panArea({ ...pan, count: 1 });
  return area === null ? null : ((area * depth) / CUP) * FILL * pan.count;
}

export interface PanFactor {
  factor: number;
  /** Compared by floor area (flat pans) or by what they hold. */
  by: "area" | "capacity";
}

/** How much to scale a recipe made in one pan for another, or null when a size is missing. */
export function panFactor(recipe: Pan, yours: Pan): PanFactor | null {
  if (isFlat(recipe) && isFlat(yours)) {
    const from = panArea(recipe);
    const to = panArea(yours);
    return from && to ? { factor: to / from, by: "area" } : null;
  }
  const from = panCups(recipe);
  const to = panCups(yours);
  return from && to ? { factor: to / from, by: "capacity" } : null;
}

// ---------------------------------------------------------------------------------------------
// Saying it
// ---------------------------------------------------------------------------------------------

const GLYPHS: Record<string, string> = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  "1/5": "⅕",
  "2/5": "⅖",
  "3/5": "⅗",
  "4/5": "⅘",
  "1/6": "⅙",
  "5/6": "⅚",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};

function friendlyNumber(value: number): { text: string; value: number } {
  // Quarters and thirds; below one, fifths, sixths and eighths too ("about ⅕×").
  const denominators = value < 1 ? [2, 3, 4, 5, 6, 8] : [2, 3, 4];
  let best = { text: String(Math.round(value)), value: Math.round(value) };
  for (const d of denominators) {
    const n = Math.round(value * d);
    const v = n / d;
    if (n === 0 || Math.abs(v - value) >= Math.abs(best.value - value) - 1e-9) continue;
    const whole = Math.floor(n / d);
    const part = n % d;
    const divisor = gcd(part, d);
    const glyph = part === 0 ? "" : (GLYPHS[`${part / divisor}/${d / divisor}`] ?? "");
    best = { text: whole === 0 ? glyph : `${whole}${glyph}`, value: v };
  }
  if (best.value === 0) return { text: value.toFixed(2), value };
  return best;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const NAMED: [number, string][] = [
  [2, "Doubled"],
  [3, "Tripled"],
  [0.5, "Halved"],
];

/**
 * A factor as it's shown (owner's choice 2026-10-23): a simple one is named ("Doubled"), anything
 * else is "about 1¾×", never the exact number.
 */
export function factorText(factor: number): string {
  const named = NAMED.find(([value]) => Math.abs(value - factor) < 1e-9);
  if (named) return named[1];
  const friendly = friendlyNumber(factor);
  const exact = Math.abs(friendly.value - factor) < 1e-9;
  // Further than 6% from a quarter or a third: two figures, still "about" ("about 0.55×").
  const text =
    Math.abs(friendly.value - factor) / factor <= 0.06
      ? friendly.text
      : String(Number(factor.toPrecision(2)));
  return exact ? `${text}×` : `about ${text}×`;
}

const SHAPE_WORDS: Record<PanShape, string> = {
  round: "round",
  square: "square",
  rectangle: "pan",
  loaf: "loaf",
  tube: "tube",
  bundt: "Bundt",
  muffin: "muffins",
};

const sizeNumber = (value: number) => {
  const whole = Math.floor(value);
  const part = value - whole;
  const glyph =
    Math.abs(part - 0.5) < 0.01
      ? "½"
      : Math.abs(part - 0.25) < 0.01
        ? "¼"
        : Math.abs(part - 0.75) < 0.01
          ? "¾"
          : "";
  if (glyph) return whole === 0 ? glyph : `${whole}${glyph}`;
  return String(Number(value.toFixed(1)));
};

/** A pan in words: "9×13", "9″ round", "23 cm round", "9×5 loaf", "12 muffins", "10-cup Bundt". */
export function panName(pan: Pan): string {
  const mark = pan.unit === "cm" ? " cm" : "″";
  const many = pan.count > 1 && pan.shape !== "muffin" ? `${pan.count} × ` : "";
  if (pan.shape === "muffin") {
    const size =
      pan.cups !== null && Math.abs(pan.cups - MUFFIN_CUPS.mini) < 0.01
        ? "mini "
        : pan.cups !== null && Math.abs(pan.cups - MUFFIN_CUPS.shallow) < 0.01
          ? "shallow "
          : "";
    return `${pan.count} ${size}muffins`;
  }
  if (pan.width === null) {
    if (pan.cups !== null) return `${many}${sizeNumber(pan.cups)}-cup ${SHAPE_WORDS[pan.shape]}`;
    return `${many}${SHAPE_WORDS[pan.shape]} pan`;
  }
  const w = sizeNumber(pan.width);
  if (pan.shape === "rectangle" || pan.shape === "loaf") {
    const l = pan.length === null ? "?" : sizeNumber(pan.length);
    const unit = pan.unit === "cm" ? " cm" : "";
    // Loaf pans are named length first ("9×5"), other pans short side first ("9×13").
    return pan.shape === "loaf" ? `${many}${l}×${w}${unit} loaf` : `${many}${w}×${l}${unit}`;
  }
  if (pan.shape === "square") {
    return `${many}${w}×${w}${pan.unit === "cm" ? " cm" : ""}`;
  }
  return `${many}${w}${mark} ${SHAPE_WORDS[pan.shape]}`;
}

/** A pan as stored with the recipe's scale, checked: null when it isn't one. */
export function storedPan(value: unknown): Pan | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const size = (x: unknown) =>
    x === null || (typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 500);
  if (!PAN_SHAPES.includes(v.shape as PanShape)) return null;
  if (v.unit !== "in" && v.unit !== "cm") return null;
  if (!size(v.width) || !size(v.length) || !size(v.depth) || !size(v.cups)) return null;
  if (!Number.isInteger(v.count) || (v.count as number) < 1 || (v.count as number) > 200) {
    return null;
  }
  return {
    shape: v.shape as PanShape,
    width: v.width as number | null,
    length: v.length as number | null,
    depth: v.depth as number | null,
    unit: v.unit,
    cups: v.cups as number | null,
    count: v.count as number,
  };
}

/** The common pans offered to choose from (spec.md F2). */
export const COMMON_PANS: Pan[] = [
  pan("round", 8),
  pan("round", 9),
  pan("round", 10),
  pan("square", 8),
  pan("square", 9),
  pan("rectangle", 7, 11),
  pan("rectangle", 9, 13),
  pan("rectangle", 10.5, 15.5, 1),
  pan("rectangle", 13, 18, 1),
  pan("loaf", 4, 8),
  pan("loaf", 4.5, 8.5),
  pan("loaf", 5, 9),
  pan("tube", 10),
  pan("round", 9, null, 3),
  { ...pan("muffin", null), cups: MUFFIN_CUPS.standard, count: 12 },
  { ...pan("muffin", null), cups: MUFFIN_CUPS.mini, count: 24 },
];

function pan(
  shape: PanShape,
  width: number | null,
  length: number | null = null,
  depth: number | null = null,
): Pan {
  return { shape, width, length, depth, unit: "in", cups: null, count: 1 };
}

export const samePan = (a: Pan, b: Pan) =>
  a.shape === b.shape &&
  a.count === b.count &&
  a.unit === b.unit &&
  a.width === b.width &&
  a.length === b.length &&
  a.cups === b.cups;

// ---------------------------------------------------------------------------------------------
// Reading the recipe's pan
// ---------------------------------------------------------------------------------------------

const NUM = String.raw`(\d+\s+\d\/\d|\d+(?:[.,]\d+)?\s*[½¼¾]?|[½¼¾])`;
const UNIT = String.raw`(?:\s*-?\s*(inch(?:es)?|in\b\.?|"|”|''|″|cm\b|centimet(?:er|re)s?))`;
const BY = String.raw`\s*-?\s*(?:x|×|by)\s*-?\s*`;
const COUNT = String.raw`(?:\b(one|two|three|four|a|an|\d)\s+)?`;
const WORDS = String.raw`(?:[\w-]+\s+){0,4}?`;
const VESSEL = String.raw`(pans?|dish(?:es)?|tins?|plates?|molds?|moulds?|sheets?|(?:pie\s+)?(?:crusts?|shells?))\b`;

const RECTANGLE = new RegExp(
  `${COUNT}\\(?${NUM}${UNIT}?${BY}${NUM}${UNIT}?(?:${BY}${NUM}${UNIT}?)?\\)?[\\s-]*(?:\\([^)]*\\)\\s*)?(${WORDS})${VESSEL}`,
  "iu",
);
const SINGLE = new RegExp(
  `${COUNT}\\(?${NUM}(?:\\s*(?:or|to|-|–)\\s*${NUM})?${UNIT}\\)?[\\s-]*(${WORDS})${VESSEL}`,
  "iu",
);
const CUP_PAN = /\b(\d+)[\s-]*cups?\s+(?:[\w-]+\s+){0,2}?(bundt|tube)\b/iu;
const MUFFINS =
  /\b(\d+)\s*(?:-?\s*cup\s+)?(?:(mini|standard|regular|jumbo)\s+)?(?:muffin|cupcake)s?\b\s*(cups|tins?|pans?|liners|wells|cavities)?/iu;
const BARE = /\b(loaf|bundt|tube|springform|muffin|pie)\s+(?:pan|tin|cups|plate|dish)\b/iu;

/** Sizes that aren't a pan's: "2 inches apart on the baking sheet", "1-inch cubes". */
const NOT_A_PAN = /quart|cubes?\b|pieces?\b|thick|apart|wide|long|deep|high|rounds?\s+of/iu;

const COUNTS: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4 };

function number(text: string | undefined): number | null {
  if (!text) return null;
  const t = text.trim().replace(",", ".");
  const glyph = /([½¼¾])$/u.exec(t)?.[1];
  const glyphValue = glyph === "½" ? 0.5 : glyph === "¼" ? 0.25 : glyph === "¾" ? 0.75 : 0;
  const rest = glyph ? t.slice(0, -1).trim() : t;
  const mixed = /^(\d+)\s+(\d)\/(\d)$/.exec(rest);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  return (rest ? Number(rest) : 0) + glyphValue;
}

const unitOf = (text: string | undefined): PanUnit =>
  text && /^c/i.test(text.trim()) ? "cm" : "in";

function countOf(word: string | undefined): number {
  if (!word) return 1;
  return COUNTS[word.toLowerCase()] ?? (Number(word) || 1);
}

/** The pan a piece of text names, with the words that name it, or null. */
export function readPan(text: string): { pan: Pan; words: string } | null {
  const rect = RECTANGLE.exec(text);
  if (rect) {
    const a = number(rect[2]);
    const b = number(rect[4]);
    const c = number(rect[6]);
    const unit = unitOf(rect[3] ?? rect[5] ?? rect[7]);
    if (a && b && !NOT_A_PAN.test(rect[0])) {
      const words = rect[0];
      // "9x13x2": the smallest is the depth when there are three.
      const sides = [a, b, ...(c ? [c] : [])].sort((x, y) => x - y);
      const [first = 0, second = 0, third = 0] = sides;
      const depth = sides.length === 3 ? first : null;
      const [w, l] = sides.length === 3 ? [second, third] : [first, second];
      const loaf = /loaf/i.test(words);
      const shape: PanShape = loaf ? "loaf" : Math.abs(w - l) < 0.01 ? "square" : "rectangle";
      return {
        pan: {
          shape,
          width: w,
          length: shape === "square" ? null : l,
          depth,
          unit,
          cups: null,
          count: countOf(rect[1]),
        },
        words: words.trim(),
      };
    }
  }
  const cupPan = CUP_PAN.exec(text);
  if (cupPan) {
    const shape = (cupPan[2] ?? "").toLowerCase() === "tube" ? "tube" : "bundt";
    return {
      pan: {
        shape,
        width: null,
        length: null,
        depth: null,
        unit: "in",
        cups: Number(cupPan[1]),
        count: 1,
      },
      words: cupPan[0].trim(),
    };
  }
  const single = SINGLE.exec(text);
  if (single && !NOT_A_PAN.test(single[0])) {
    const size = number(single[2]);
    const between = single[5] ?? "";
    if (size && size >= 3) {
      const shape: PanShape = /square/i.test(between)
        ? "square"
        : /tube|angel/i.test(between)
          ? "tube"
          : /bundt/i.test(between)
            ? "bundt"
            : /loaf/i.test(between)
              ? "loaf"
              : "round";
      if (shape !== "loaf") {
        return {
          pan: {
            shape,
            width: size,
            length: null,
            depth: null,
            unit: unitOf(single[4]),
            cups: null,
            count: countOf(single[1]),
          },
          words: single[0].trim(),
        };
      }
    }
  }
  const muffins = MUFFINS.exec(text);
  if (muffins) {
    const count = Number(muffins[1]);
    if (count >= 6 && count <= 72) {
      const size = muffins[2]?.toLowerCase();
      return {
        pan: {
          shape: "muffin",
          width: null,
          length: null,
          depth: null,
          unit: "in",
          cups: size === "mini" ? MUFFIN_CUPS.mini : MUFFIN_CUPS.standard,
          count,
        },
        words: muffins[0].trim(),
      };
    }
  }
  return null;
}

/** A pan named without its size ("a loaf pan"), so the person can be asked. */
function readBarePan(text: string): { pan: Pan; words: string } | null {
  const bare = BARE.exec(text);
  if (!bare) return null;
  const word = (bare[1] ?? "").toLowerCase();
  const shape: PanShape = word === "springform" || word === "pie" ? "round" : (word as PanShape);
  return {
    pan: {
      shape,
      width: null,
      length: null,
      depth: null,
      unit: "in",
      cups: shape === "muffin" ? MUFFIN_CUPS.standard : null,
      count: shape === "muffin" ? 12 : 1,
    },
    words: bare[0].trim(),
  };
}

export type PanSource = "method" | "notes" | "makes" | "ingredients";

export interface RecipePan {
  pan: Pan;
  /** Where it was read: "from the method". */
  from: PanSource;
  words: string;
  /** Its size wasn't written ("a loaf pan"), so it must be chosen. */
  sizeMissing: boolean;
}

interface PanRecipe {
  directions: { text: string; heading: boolean }[];
  notes: string;
  servings: { count: number | null; yield: string | null };
  ingredients: { text: string; heading: boolean }[];
}

/** The pan a recipe is made in, read from its method first, then its notes, yield, ingredients. */
export function recipePan(recipe: PanRecipe): RecipePan | null {
  const places: [PanSource, string[]][] = [
    ["method", recipe.directions.filter((l) => !l.heading).map((l) => l.text)],
    ["notes", [recipe.notes]],
    ["makes", recipe.servings.yield ? [recipe.servings.yield] : []],
    ["ingredients", recipe.ingredients.filter((l) => !l.heading).map((l) => l.text)],
  ];
  for (const [from, texts] of places) {
    for (const text of texts) {
      const found = readPan(text);
      if (found) return { ...found, from, sizeMissing: false };
    }
  }
  const muffinCount = /\b(\d+)\s+(?:mini\s+)?(?:muffins|cupcakes)\b/iu.exec(
    recipe.servings.yield ?? "",
  );
  for (const [from, texts] of places) {
    for (const text of texts) {
      const found = readBarePan(text);
      if (!found) continue;
      if (found.pan.shape === "muffin" && muffinCount) found.pan.count = Number(muffinCount[1]);
      const sizeMissing = found.pan.shape !== "muffin";
      return { ...found, from, sizeMissing };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The bake time
// ---------------------------------------------------------------------------------------------

const TIME =
  /(\d+(?:\s+\d\/\d)?|an?|one)\s*(?:(?:to|-|–|or)\s*(\d+(?:\s+\d\/\d)?)\s*)?(minutes?|mins?\b|hours?|hrs?\b)/iu;

/** The first time a piece of text gives, at its low end, in minutes. */
export function firstTime(text: string): number | null {
  const m = TIME.exec(text);
  if (!m) return null;
  const word = (m[1] ?? "").toLowerCase();
  const value = word === "a" || word === "an" || word === "one" ? 1 : (number(m[1]) ?? 0);
  return /^h/i.test(m[3] ?? "") ? value * 60 : value;
}

function minutesWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  const h = hours === 1 ? "1 hour" : `${hours} hours`;
  const m = rest === 1 ? "1 minute" : `${rest} minutes`;
  if (hours === 0) return m;
  return rest === 0 ? h : `${h} ${m}`;
}

const BAKE = /\bbak(?:e|ed|ing)\b|\boven\b/iu;

export interface BakeNote {
  /** The step it goes under: the one that gives the bake time. */
  stepId: string;
  text: string;
}

/** Words that name a pan or its size ("one 9-inch cake", "a 9x13"). */
export const namesAPan = (words: string) =>
  readPan(words) !== null || /\d\s*(?:-|\s)?(?:inch|in\b|"|″|cm)|\d\s*[x×]\s*\d/iu.test(words);

/**
 * Fennl's suggestion for the bake time in the person's pan, under the step that gives the time
 * (owner's choices 2026-10-23): minutes only when Fennl can be sure, never the temperature.
 * `factor` is the scale shown; it differs from the pans' own factor when someone also changed it.
 */
export function bakeNote(
  recipe: { directions: DirectionStep[]; notes: string },
  pans: { recipe: Pan; yours: Pan },
  factor: number,
): BakeNote | null {
  const steps = recipe.directions.filter((s) => !s.heading);
  const step = steps.find((s) => BAKE.test(s.text) && firstTime(s.text) !== null);
  if (!step) return null;
  const { recipe: from, yours } = pans;
  const name = panName(yours);

  // The recipe gives a time for the person's pan somewhere else: quote it.
  const sentences = [...steps.map((s) => s.text), recipe.notes]
    .flatMap((t) => t.split(/(?<=[.!?])\s+/u))
    .filter((s) => firstTime(s) !== null);
  for (const sentence of sentences) {
    const named = readPan(sentence)?.pan;
    if (!named || samePan(named, from)) continue;
    const match =
      named.shape === yours.shape &&
      (yours.shape === "muffin"
        ? named.cups === yours.cups
        : samePan({ ...named, count: yours.count }, yours));
    if (match)
      return {
        stepId: step.id,
        text: `The recipe gives a time for your pan: “${sentence.trim()}”`,
      };
  }

  const pf = panFactor(from, yours);
  if (isFlat(from) && isFlat(yours) && pf) {
    const depth = factor / pf.factor;
    if (Math.abs(depth - 1) <= 0.1) {
      const low = firstTime(step.text) ?? 0;
      const check = low >= 20 ? low - 5 : Math.max(1, low - 2);
      return {
        stepId: step.id,
        text: `Same depth of batter in your ${name}, so about the same time. Start checking at ${minutesWords(check)}.`,
      };
    }
    return {
      stepId: step.id,
      text:
        depth > 1
          ? "Your batter will be deeper than the recipe's, so it will take longer. Check with a toothpick."
          : "Your batter will be shallower than the recipe's, so it will bake faster. Start checking early.",
    };
  }
  if (from.shape === "muffin" && yours.shape === "muffin") {
    if (from.cups === yours.cups) {
      const low = firstTime(step.text) ?? 0;
      const check = low >= 20 ? low - 5 : Math.max(1, low - 2);
      return {
        stepId: step.id,
        text: `Same size of muffin cup, so the same time. Start checking at ${minutesWords(check)}.`,
      };
    }
    return {
      stepId: step.id,
      text:
        (yours.cups ?? 0) < (from.cups ?? 0)
          ? "Smaller muffins bake much faster. Start checking early and use a toothpick."
          : "Bigger muffins take longer. Check with a toothpick before taking them out.",
    };
  }
  if (yours.shape === "muffin") {
    return {
      stepId: step.id,
      text: `Muffins bake much faster than a ${panName(from)}. Start checking early and use a toothpick.`,
    };
  }
  if (from.shape === "muffin") {
    return {
      stepId: step.id,
      text: `A ${name} bakes much longer than muffins. Check with a toothpick before taking it out.`,
    };
  }
  return {
    stepId: step.id,
    text: "A different size or shape of pan changes the baking time. Start checking early and use a toothpick.",
  };
}
