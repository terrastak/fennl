import type { ParsedIngredient } from "./recipe";

/**
 * The ingredient reader (phase E2): how an ingredient line is understood, for scaling and
 * converting (Stage F). "1 ½ cups (190 g) flour, sifted" is 1½ cups, also 190 g, of flour,
 * sifted. The line's text stays the master copy (CLAUDE.md, "Data model rules"): this only
 * reads it, and a misread is fixed by editing the text.
 *
 * Every amount found is recorded with where it is in the line, so scaling can change the
 * numbers in place and a weight in parentheses never contradicts the main amount (spec.md F1).
 */

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

export type UnitKind = "volume" | "weight" | "count" | "imprecise" | "length";

export interface Unit {
  /** Standard name, singular: "tablespoon". */
  name: string;
  kind: UnitKind;
  /** For volume, millilitres in one; for weight, grams in one; for "dozen", 12. */
  base: number | null;
  /** Ways of writing it, matched without regard to case. */
  words: string[];
  /** Ways of writing it where case matters ("t" is a teaspoon, "T" a tablespoon). */
  exact?: string[];
}

export const UNITS: readonly Unit[] = [
  {
    name: "teaspoon",
    kind: "volume",
    base: 4.92892,
    words: ["teaspoons", "teaspoon", "teasp", "tspns", "tspn", "tsps", "tsp"],
    exact: ["t", "ts"],
  },
  {
    name: "tablespoon",
    kind: "volume",
    base: 14.7868,
    words: ["tablespoons", "tablespoon", "tblsp", "tbsps", "tbsp", "tbls", "tbl", "tbs"],
    exact: ["T", "Tb", "TB"],
  },
  { name: "cup", kind: "volume", base: 236.588, words: ["cups", "cup", "c"] },
  {
    name: "fluid ounce",
    kind: "volume",
    base: 29.5735,
    words: ["fluid ounces", "fluid ounce", "fl. oz", "fl oz", "floz"],
  },
  { name: "pint", kind: "volume", base: 473.176, words: ["pints", "pint", "pts", "pt"] },
  { name: "quart", kind: "volume", base: 946.353, words: ["quarts", "quart", "qts", "qt"] },
  { name: "gallon", kind: "volume", base: 3785.41, words: ["gallons", "gallon", "gal"] },
  {
    name: "milliliter",
    kind: "volume",
    base: 1,
    words: ["milliliters", "milliliter", "millilitres", "millilitre", "mls", "ml"],
  },
  {
    name: "centiliter",
    kind: "volume",
    base: 10,
    words: ["centiliters", "centiliter", "centilitres", "centilitre", "cl"],
  },
  {
    name: "deciliter",
    kind: "volume",
    base: 100,
    words: ["deciliters", "deciliter", "decilitres", "decilitre", "dl"],
  },
  {
    name: "liter",
    kind: "volume",
    base: 1000,
    words: ["liters", "liter", "litres", "litre", "ltr", "l"],
  },
  { name: "ounce", kind: "weight", base: 28.3495, words: ["ounces", "ounce", "oz"] },
  { name: "pound", kind: "weight", base: 453.592, words: ["pounds", "pound", "lbs", "lb", "#"] },
  {
    name: "milligram",
    kind: "weight",
    base: 0.001,
    words: ["milligrams", "milligram", "milligrammes", "milligramme", "mg"],
  },
  {
    name: "kilogram",
    kind: "weight",
    base: 1000,
    words: ["kilograms", "kilogram", "kilogrammes", "kilogramme", "kilos", "kilo", "kgs", "kg"],
  },
  {
    name: "gram",
    kind: "weight",
    base: 1,
    words: ["grams", "gram", "grammes", "gramme", "gms", "gm", "gr", "g"],
  },
  { name: "dozen", kind: "count", base: 12, words: ["dozen", "doz"] },
  { name: "can", kind: "count", base: null, words: ["cans", "can", "tins", "tin"] },
  { name: "jar", kind: "count", base: null, words: ["jars", "jar"] },
  { name: "bottle", kind: "count", base: null, words: ["bottles", "bottle"] },
  {
    name: "package",
    kind: "count",
    base: null,
    words: [
      "packages",
      "package",
      "packets",
      "packet",
      "pkgs",
      "pkg",
      "pkts",
      "pkt",
      "packs",
      "pack",
    ],
  },
  { name: "box", kind: "count", base: null, words: ["boxes", "box"] },
  { name: "bag", kind: "count", base: null, words: ["bags", "bag"] },
  {
    name: "envelope",
    kind: "count",
    base: null,
    words: ["envelopes", "envelope", "sachets", "sachet"],
  },
  { name: "stick", kind: "count", base: null, words: ["sticks", "stick"] },
  { name: "clove", kind: "count", base: null, words: ["cloves", "clove"] },
  { name: "slice", kind: "count", base: null, words: ["slices", "slice"] },
  { name: "piece", kind: "count", base: null, words: ["pieces", "piece", "pcs", "pc"] },
  { name: "bunch", kind: "count", base: null, words: ["bunches", "bunch"] },
  { name: "sprig", kind: "count", base: null, words: ["sprigs", "sprig"] },
  { name: "head", kind: "count", base: null, words: ["heads", "head"] },
  { name: "stalk", kind: "count", base: null, words: ["stalks", "stalk", "ribs", "rib"] },
  { name: "sheet", kind: "count", base: null, words: ["sheets", "sheet"] },
  { name: "tub", kind: "count", base: null, words: ["tubs", "tub"] },
  { name: "container", kind: "count", base: null, words: ["containers", "container"] },
  { name: "carton", kind: "count", base: null, words: ["cartons", "carton"] },
  { name: "block", kind: "count", base: null, words: ["blocks", "block"] },
  { name: "bar", kind: "count", base: null, words: ["bars", "bar"] },
  { name: "loaf", kind: "count", base: null, words: ["loaves", "loaf"] },
  { name: "ear", kind: "count", base: null, words: ["ears", "ear"] },
  { name: "fillet", kind: "count", base: null, words: ["fillets", "fillet"] },
  { name: "cube", kind: "count", base: null, words: ["cubes", "cube"] },
  { name: "drop", kind: "count", base: null, words: ["drops", "drop"] },
  { name: "pinch", kind: "imprecise", base: null, words: ["pinches", "pinch"] },
  { name: "dash", kind: "imprecise", base: null, words: ["dashes", "dash"] },
  { name: "splash", kind: "imprecise", base: null, words: ["splashes", "splash"] },
  { name: "handful", kind: "imprecise", base: null, words: ["handfuls", "handful"] },
  { name: "drizzle", kind: "imprecise", base: null, words: ["drizzle"] },
  { name: "knob", kind: "imprecise", base: null, words: ["knobs", "knob"] },
  { name: "smidgen", kind: "imprecise", base: null, words: ["smidgens", "smidgen"] },
  { name: "inch", kind: "length", base: null, words: ["inches", "inch", "in", '"'] },
  {
    name: "centimeter",
    kind: "length",
    base: null,
    words: ["centimeters", "centimeter", "centimetres", "centimetre", "cm"],
  },
];

/** A unit by its standard name. */
export const unitNamed = (name: string): Unit | undefined => UNITS.find((u) => u.name === name);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest spellings first, so "fl oz" wins over "fl" and "tbsp" over "t". A unit ends at a
// word boundary (so "can" isn't the start of "candied"), with an optional full stop.
const spellings = UNITS.flatMap((u) => [
  ...u.words.map((w) => ({ w, unit: u, exact: false })),
  ...(u.exact ?? []).map((w) => ({ w, unit: u, exact: true })),
]).sort((a, b) => b.w.length - a.w.length);

const END = String.raw`(?![\p{L}\p{N}])\.?`;
const UNIT_RE = new RegExp(
  `(${spellings
    .filter((s) => !s.exact)
    .map((s) => escapeRe(s.w))
    .join("|")})${END}`,
  "iuy",
);
const UNIT_EXACT_RE = new RegExp(
  `(${spellings
    .filter((s) => s.exact)
    .map((s) => escapeRe(s.w))
    .join("|")})${END}`,
  "uy",
);

/** A unit written at `at`, or null. */
function readUnit(text: string, at: number): { unit: Unit; end: number } | null {
  for (const re of [UNIT_EXACT_RE, UNIT_RE]) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) continue;
    const written = (m[1] ?? "").toLowerCase();
    const found = spellings.find((s) => (s.exact ? s.w === m[1] : s.w.toLowerCase() === written));
    if (found) return { unit: found.unit, end: at + m[0].length };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

const VULGAR: Record<string, number> = {
  "¼": 1 / 4,
  "½": 1 / 2,
  "¾": 3 / 4,
  "⅐": 1 / 7,
  "⅑": 1 / 9,
  "⅒": 1 / 10,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
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
const V = Object.keys(VULGAR).join("");

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  half: 0.5,
  quarter: 0.25,
  a: 1,
  an: 1,
};

// Mixed numbers: "1 1/2", "1-1/2", "1 and 1/2", "1½", "1 ½". Then a fraction "1/2" or "1⁄2",
// a lone "½", a decimal "1.5" (or "1,5" before a unit), a whole number, or a number word.
const NUMBER_RE = new RegExp(
  [
    String.raw`(?<whole>\d+)(?:\s+and\s+|\s*[-‐‑]\s*|\s+)(?<num>\d+)\s*[/⁄]\s*(?<den>\d+)`,
    `(?<whole2>\\d+)\\s*(?<vulgar>[${V}])`,
    String.raw`(?<fnum>\d+)\s*[/⁄]\s*(?<fden>\d+)`,
    `(?<lone>[${V}])`,
    String.raw`(?<decimal>\d*\.\d+|\d+,\d{1,2}(?=\s*\p{L}))`,
    String.raw`(?<int>\d+)`,
    String.raw`(?<word>one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|quarter|an|a)(?![\p{L}\p{N}])`,
  ].join("|"),
  "iuy",
);

interface Num {
  value: number;
  start: number;
  end: number;
  word: boolean;
}

/** A number written at `at`, or null. */
function readNumber(text: string, at: number): Num | null {
  NUMBER_RE.lastIndex = at;
  const m = NUMBER_RE.exec(text);
  if (!m?.groups) return null;
  const g = m.groups;
  let value: number | null = null;
  if (g.whole !== undefined) {
    const num = Number(g.num);
    const den = Number(g.den);
    // "1-2/3" is one and two thirds, but "1 3/2" isn't a mixed number.
    if (den > 0 && num < den) value = Number(g.whole) + num / den;
    else {
      // Read just the whole number; what follows is read on its own.
      return { value: Number(g.whole), start: at, end: at + (g.whole?.length ?? 0), word: false };
    }
  } else if (g.whole2 !== undefined) value = Number(g.whole2) + (VULGAR[g.vulgar ?? ""] ?? 0);
  else if (g.fnum !== undefined) {
    const den = Number(g.fden);
    if (den === 0) return null;
    value = Number(g.fnum) / den;
  } else if (g.lone !== undefined) value = VULGAR[g.lone] ?? null;
  else if (g.decimal !== undefined) value = Number(g.decimal.replace(",", "."));
  else if (g.int !== undefined) value = Number(g.int);
  else if (g.word !== undefined) value = WORDS[g.word.toLowerCase()] ?? null;
  if (value === null || !Number.isFinite(value)) return null;
  return { value, start: at, end: at + m[0].length, word: g.word !== undefined };
}

const skipSpaces = (text: string, at: number) => {
  let i = at;
  while (i < text.length && /\s/u.test(text[i] ?? "")) i++;
  return i;
};

/** A number or a range ("2-3", "2 to 3", "2 or 3", "1/2–3/4") at `at`. */
function readQuantity(
  text: string,
  at: number,
): { low: number; high: number | null; start: number; end: number; word: boolean } | null {
  const first = readNumber(text, at);
  if (!first) return null;
  // "a few", "a little", "a bit": no number.
  if (first.word && /^(?:a|an)$/i.test(text.slice(first.start, first.end))) {
    const next = text.slice(skipSpaces(text, first.end));
    if (/^(?:few|little|bit|touch|good|generous|healthy|heaping|scant)\b/i.test(next)) return null;
    if (/^couple\b/i.test(next)) {
      const end = skipSpaces(text, first.end) + "couple".length;
      const of = /^\s+of\b/i.exec(text.slice(end));
      return {
        low: 2,
        high: null,
        start: first.start,
        end: end + (of ? of[0].length : 0),
        word: true,
      };
    }
  }
  // "half a cup", "half an onion".
  let end = first.end;
  if (first.word && first.value === 0.5) {
    const article = /^\s+(?:a|an)(?![\p{L}\p{N}])/iu.exec(text.slice(end));
    if (article) end += article[0].length;
  }
  // "2-3", "2 to 3", "2 or 3", and in sizes "4- to 5-pound", "12-to-14-pound".
  const range = /^\s*(?:[-‐‑]\s*to\s*[-‐‑]?|[-‐‑–—]|to\s*[-‐‑]?|or)\s*/iu.exec(text.slice(end));
  if (range) {
    const second = readNumber(text, end + range[0].length);
    if (second && second.value > first.value && !(second.word && second.value === 1)) {
      return {
        low: first.value,
        high: second.value,
        start: first.start,
        end: second.end,
        word: false,
      };
    }
  }
  return { low: first.value, high: null, start: first.start, end, word: first.word };
}

/** Degrees, as in "70 degrees F" or "350°": not an amount. */
const TEMPERATURE = /^\s*(?:°|degrees?\b|º)/iu;

// ---------------------------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------------------------

export type AmountRole =
  /** The amount of the ingredient. */
  | "main"
  /** The same amount another way: "1 cup (240 ml)", "1 cup / 240 ml". */
  | "alternate"
  /** The size of each: "1 (14-ounce) can", "2 x 400 g tins". */
  | "size"
  /** Any other amount on the line, in a note or an alternative ("or 1 teaspoon extract"). */
  | "other";

export interface IngredientAmount {
  low: number;
  /** For a range ("2-3"), the top of it. */
  high: number | null;
  /** Standard unit name (UNITS), or null for a plain count ("2 eggs"). */
  unit: string | null;
  role: AmountRole;
  /** "about", "approximately": not exact. */
  approximate: boolean;
  /** Where it's written in the line, number and unit: text.slice(start, end). */
  start: number;
  end: number;
}

interface Amount extends Omit<IngredientAmount, "role"> {
  unitKind: UnitKind | null;
}

const APPROX = /^(?:about|approximately|approx\.?|around|roughly|~)\s*/iu;

/**
 * A quantity with its unit at `at`: "1 ½ cups", "1 pound 4 ounces", "8-oz", "a pinch". The
 * unit may be joined by a hyphen ("28-ounce"). With `needUnit`, a number alone doesn't count.
 */
function readAmount(text: string, at: number, needUnit = false): Amount | null {
  let i = at;
  let approximate = false;
  const approx = APPROX.exec(text.slice(i));
  if (approx) {
    approximate = true;
    i += approx[0].length;
  }
  const q = readQuantity(text, i);
  if (!q) return null;
  if (TEMPERATURE.test(text.slice(q.end))) return null;
  let end = q.end;
  const gap = /^(?:\s*[-‐‑]\s*|\s*)/u.exec(text.slice(end))?.[0] ?? "";
  const u =
    gap.length || /^[\p{L}#"]/u.test(text.slice(end)) ? readUnit(text, end + gap.length) : null;
  const unit = u?.unit ?? null;
  if (u) end = u.end;
  else if (needUnit) return null;
  let low = q.low;
  const high = q.high;
  // "A pinch", "a dash": no number to scale (low 0; readIngredient keeps just the unit).
  if (unit?.kind === "imprecise" && q.word) {
    return {
      low: 0,
      high: null,
      unit: unit.name,
      unitKind: unit.kind,
      approximate,
      start: at,
      end,
    };
  }
  // "1 pound 4 ounces", "1 cup plus 2 tablespoons", "1 cup + ¼ cup": one amount, in the
  // first unit. Only a smaller (or the same) unit of the same kind counts.
  if (unit && (unit.kind === "weight" || unit.kind === "volume") && high === null && unit.base) {
    const joiner = /^\s*(?:\+|plus\b|and\b)?\s*/iu.exec(text.slice(end))?.[0] ?? "";
    const more = readAmount(text, end + joiner.length, true);
    if (more && more.high === null && !more.approximate && more.unitKind === unit.kind) {
      const other = unitNamed(more.unit ?? "");
      if (other?.base && other.base <= unit.base) {
        low = q.low + (more.low * other.base) / unit.base;
        end = more.end;
      }
    }
  }
  return {
    low,
    high,
    unit: unit?.name ?? null,
    unitKind: unit?.kind ?? null,
    approximate,
    start: at,
    end,
  };
}

/** Every amount written anywhere in `text` from `from` to `to`, as "other" amounts. */
function amountsIn(text: string, from: number, to: number): IngredientAmount[] {
  const found: IngredientAmount[] = [];
  let i = from;
  while (i < to) {
    // Only at the start of a word.
    if (i > 0 && /[\p{L}\p{N}]/u.test(text[i - 1] ?? "")) {
      i++;
      continue;
    }
    const a = /[\d¼-¾⅐-⅞]/u.test(text[i] ?? "") ? readAmount(text, i, true) : null;
    if (a && a.end <= to) {
      found.push(toAmount(a, "other"));
      i = a.end;
    } else {
      i++;
    }
  }
  return found;
}

const toAmount = (a: Amount, role: AmountRole): IngredientAmount => ({
  low: a.low,
  high: a.high,
  unit: a.unit,
  role,
  approximate: a.approximate,
  start: a.start,
  end: a.end,
});

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:‐‑-]+|[\s,;:*]+$/gu, "")
    .trim();

/** The text inside a parenthesis that opens at `at`, and where it closes. */
function paren(text: string, at: number): { inner: number; close: number } | null {
  if (text[at] !== "(" && text[at] !== "[") return null;
  const closing = text[at] === "(" ? ")" : "]";
  const close = text.indexOf(closing, at + 1);
  return close === -1 ? null : { inner: at + 1, close };
}

/**
 * Reads an ingredient line. Lines with no amount ("Kosher salt and pepper") have a null
 * quantity and the whole line as the item. Never throws, whatever the text.
 */
export function readIngredient(text: string): ParsedIngredient & { amounts: IngredientAmount[] } {
  const amounts: IngredientAmount[] = [];
  let i = skipSpaces(text, 0);
  let main = readAmount(text, i);
  // A number on its own, with nothing after it, isn't an ingredient's amount.
  if (main && !main.unit && /^\s*$/.test(text.slice(main.end))) main = null;
  // "A pinch of salt": an imprecise amount has no number to scale.
  let unitOnly: string | null = null;
  if (main?.unitKind === "imprecise" && main.low === 0) {
    unitOnly = main.unit;
    i = main.end;
    main = null;
  }
  // A line starting with an imprecise unit: "Pinch of salt", "Dash hot sauce".
  if (!main && !unitOnly) {
    const u = readUnit(text, i);
    if (u?.unit.kind === "imprecise") {
      unitOnly = u.unit.name;
      i = u.end;
    }
  }

  let notes: string[] = [];
  if (main?.unitKind === "length") {
    // "1-inch piece ginger", "2 inch cinnamon stick": the size of one piece.
    amounts.push(toAmount(main, "size"));
    i = main.end;
    const piece = readUnit(text, skipSpaces(text, i));
    if (piece?.unit.kind === "count") {
      unitOnly = piece.unit.name;
      i = piece.end;
    }
    main = null;
  }

  // "1 1/4-ounce envelope yeast": one envelope of a quarter ounce, not 1¼ ounces.
  if (main?.unit) {
    const split = /^(\d+)\s+(?=\d+\s*[/⁄]\s*\d+-)/.exec(text.slice(main.start));
    const size = split ? readAmount(text, main.start + split[0].length, true) : null;
    const container = size ? readUnit(text, skipSpaces(text, size.end)) : null;
    if (split && size && container?.unit.kind === "count") {
      const count = Number(split[1]);
      const end = main.start + (split[1]?.length ?? 0);
      amounts.push(
        toAmount({ ...main, low: count, high: null, unit: container.unit.name, end }, "main"),
        toAmount(size, "size"),
      );
      i = container.end;
      main = null;
    }
  }

  if (main) {
    amounts.push(toAmount(main, "main"));
    i = main.end;

    // "2 x 400 g tins", "2 × 14 oz cans": the number of them, then each one's size.
    const times = /^\s*[x×]\s*/iu.exec(text.slice(i));
    if (times && !main.unit) {
      const size = readAmount(text, i + times[0].length, true);
      if (size) {
        amounts.push(toAmount(size, "size"));
        i = size.end;
        const container = readUnit(text, skipSpaces(text, i));
        if (container?.unit.kind === "count") {
          (amounts[0] as IngredientAmount).unit = container.unit.name;
          i = container.end;
        }
      }
    }

    // "1 (14-ounce) can", "Two 28-ounce cans": a size, then what it's in.
    if (!main.unit) {
      const at = skipSpaces(text, i);
      const p = paren(text, at);
      const size = p
        ? readAmount(text, skipSpaces(text, p.inner), true)
        : readAmount(text, at, true);
      if (size && (!p || /^\s*$/.test(text.slice(size.end, p.close)))) {
        const after = p ? p.close + 1 : size.end;
        const container = readUnit(text, skipSpaces(text, after));
        if (container?.unit.kind === "count") {
          amounts.push(toAmount(size, "size"));
          (amounts[0] as IngredientAmount).unit = container.unit.name;
          i = container.end;
        } else if (!p) {
          // "Four 5-ounce chicken breasts", "2 1½"-thick steaks": the size of each.
          amounts.push(toAmount(size, "size"));
          i = size.end;
        }
      }
    }

    // "10 ounces, weight": some sites say which kind of ounce.
    const weight = /^\s*,?\s*(?:weight|wt\.?)(?![\p{L}])/iu.exec(text.slice(i));
    if (weight && main.unitKind === "weight") i += weight[0].length;

    // The same amount another way, right after: "(190 g)", "/ 240 ml", "(about 3/4 cup)",
    // "8 tablespoons 1 stick butter". After a package size, it's that size another way.
    const sized = amounts[amounts.length - 1]?.role === "size";
    const role: AmountRole = (amounts[0] as IngredientAmount).unit || sized ? "alternate" : "size";
    const at = skipSpaces(text, i);
    const p = paren(text, at);
    const slash = /^\/\s*/.exec(text.slice(at));
    if (p) {
      const alt = readAmount(text, skipSpaces(text, p.inner), true);
      if (alt) {
        amounts.push(toAmount(alt, role));
        const rest = clean(text.slice(alt.end, p.close));
        if (rest) notes.push(rest);
        i = p.close + 1;
      }
    } else if (slash) {
      const alt = readAmount(text, at + slash[0].length, true);
      if (alt && role === "alternate") {
        amounts.push(toAmount(alt, "alternate"));
        i = alt.end;
      }
    } else if (main.unit) {
      const alt = readAmount(text, at, true);
      if (
        alt &&
        (alt.unitKind === "volume" || alt.unitKind === "weight" || alt.unitKind === "count")
      ) {
        amounts.push(toAmount(alt, "alternate"));
        i = alt.end;
      }
    }
  }

  const of = /^\s*of\s+/iu.exec(text.slice(i));
  if (of && (main?.unit || unitOnly || amounts[0]?.unit)) i += of[0].length;

  // The rest: the item, then a note after the first comma. Parenthesised words are notes.
  let rest = text.slice(i);
  const restStart = i;
  const parens: string[] = [];
  rest = rest.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (whole, a?: string, b?: string) => {
    parens.push(a ?? b ?? "");
    return " ".repeat(whole.length);
  });
  const comma = rest.search(/,|;|\s[-–—]\s/);
  let item = clean(comma === -1 ? rest : rest.slice(0, comma));
  let tail = comma === -1 ? "" : clean(rest.slice(comma + 1));
  // "1 cup, loosely packed rice": the ingredient comes after the comma.
  if (!item && tail) {
    const next = tail.search(/,|;/);
    item = clean(next === -1 ? tail : tail.slice(0, next));
    tail = next === -1 ? "" : clean(tail.slice(next + 1));
  }
  notes = [...notes, ...(tail ? [tail] : []), ...parens.map(clean).filter(Boolean)];

  // Every other amount on the line ("or 1 teaspoon extract", "½ 4.25-ounce can").
  amounts.push(...amountsIn(text, restStart, text.length));

  const first = amounts.find((a) => a.role === "main");
  return {
    quantity: first ? { low: first.low, high: first.high } : null,
    unit: first?.unit ?? unitOnly,
    item: item || null,
    note: notes.length ? notes.join("; ") : null,
    amounts,
  };
}
