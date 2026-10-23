import {
  amountsWithin,
  readIngredient,
  unitNamed,
  UNITS,
  type IngredientAmount,
  type Unit,
} from "./ingredients";
import { factorText, storedPan, type Pan } from "./pans";
import type { RecipeServings } from "./recipe";

/**
 * Scaling and converting a recipe for reading (phase F1; spec.md F1). The recipe as written is
 * never changed: these functions only work out what to show, line by line, with every piece
 * Fennl changed marked so the page can highlight it.
 *
 * - The ingredients' amounts scale, and so do the amounts with a measuring unit in the method
 *   ("Stir in 1/2 cup of the sugar"); times, temperatures, pan sizes and plain counts never do
 *   (owner's choices 2026-10-23).
 * - A weight in brackets after an amount is one of two things (owner's choice 2026-10-23):
 *   after a container word ("1 bag (16 oz)") it's the size of one package, so it stays and says
 *   "each" ("2 bags (16 oz each)"), with the total when the count isn't whole; after a measuring
 *   unit ("1 cup (240 g)") it's the same amount another way, so it scales with it. One Fennl
 *   can't place either way is left as written and marked.
 * - Amounts are written the friendly way: 8 tablespoons as 1/2 cup, 3 teaspoons as 1 tablespoon.
 * - US or metric: volumes and weights convert within their own kind only, never weight to
 *   volume (that needs each ingredient's density). In metric, spoons stay spoons.
 */

export const UNIT_SYSTEMS = ["written", "us", "metric"] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];
export const isUnitSystem = (v: unknown): v is UnitSystem =>
  (UNIT_SYSTEMS as readonly unknown[]).includes(v);

/** How a recipe is scaled: shared by the household, kept with the recipe (owner's choice). */
export interface RecipeScale {
  /** 2 doubles it, 0.5 halves it. */
  factor: number;
  /** Ingredient lines kept at their written amount, by line id. */
  held: string[];
  /** Scaled for another pan (phase F2): the recipe's pan, as read or corrected, and the person's. */
  pans?: { recipe: Pan; yours: Pan };
}

export const SCALE_RULES = {
  /** The smallest and largest factor. */
  minFactor: 1 / 16,
  maxFactor: 100,
  /** Lines one recipe may hold fixed. */
  maxHeld: 500,
} as const;

/** A scale as stored, checked: null when it isn't one. */
export function recipeScale(value: unknown): RecipeScale | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { factor?: unknown; held?: unknown };
  if (typeof v.factor !== "number" || !Number.isFinite(v.factor)) return null;
  if (v.factor < SCALE_RULES.minFactor || v.factor > SCALE_RULES.maxFactor) return null;
  if (!Array.isArray(v.held) || v.held.length > SCALE_RULES.maxHeld) return null;
  if (!v.held.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)) {
    return null;
  }
  const scale: RecipeScale = { factor: v.factor, held: v.held as string[] };
  const pans = (value as { pans?: unknown }).pans;
  if (pans !== undefined) {
    const p = pans as { recipe?: unknown; yours?: unknown } | null;
    const recipe = storedPan(p?.recipe);
    const yours = storedPan(p?.yours);
    if (!recipe || !yours) return null;
    scale.pans = { recipe, yours };
  }
  return scale;
}

/** A piece of a shown line: changed by Fennl, or left as written where it might have been. */
export interface Piece {
  text: string;
  /** Fennl changed this (scaled or converted it): highlighted. */
  changed?: boolean;
  /** A weight in brackets Fennl couldn't place, left as written: marked. */
  unchanged?: boolean;
}

export interface ShownLine {
  pieces: Piece[];
  /** Any piece changed. */
  changed: boolean;
  /** The total of a package size whose count isn't whole: "24 oz in all". */
  total?: string;
}

export interface ShowOptions {
  factor: number;
  units: UnitSystem;
}

const plain = (text: string): ShownLine => ({ pieces: [{ text }], changed: false });

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/** Containers whose size can be written in brackets after them (spec.md F1). */
const CONTAINERS = new Set([
  "can",
  "bag",
  "box",
  "jar",
  "package",
  "stick",
  "carton",
  "bottle",
  "envelope",
  "block",
  "tub",
  "container",
]);

const FRACTIONS: [number, string, string][] = [
  [1 / 8, "1/8", "⅛"],
  [1 / 4, "1/4", "¼"],
  [1 / 3, "1/3", "⅓"],
  [3 / 8, "3/8", "⅜"],
  [1 / 2, "1/2", "½"],
  [5 / 8, "5/8", "⅝"],
  [2 / 3, "2/3", "⅔"],
  [3 / 4, "3/4", "¾"],
  [7 / 8, "7/8", "⅞"],
];

/**
 * The fractions a unit is measured in, as measuring cups and spoons come: cups in quarters and
 * thirds, tablespoons in halves, teaspoons in eighths and quarters; quarters and thirds otherwise.
 */
function fractionsFor(unit: string | null): number[] {
  if (unit === "teaspoon") return [1 / 8, 1 / 4, 1 / 2, 3 / 4];
  if (unit === "tablespoon") return [1 / 2];
  return [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
}

/** The nearest written amount: a whole number and one of the unit's fractions. */
function nearest(value: number, unit: string | null): { whole: number; part: number } {
  const whole = Math.floor(value);
  const rest = value - whole;
  let best = { whole, part: 0, off: rest };
  for (const f of [...fractionsFor(unit), 1]) {
    const off = Math.abs(rest - f);
    if (off < best.off)
      best = f === 1 ? { whole: whole + 1, part: 0, off } : { whole, part: f, off };
  }
  // Never round something to nothing: the smallest fraction instead.
  if (best.whole === 0 && best.part === 0 && value > 0) {
    return { whole: 0, part: unit === "cup" ? 1 / 8 : (fractionsFor(unit)[0] ?? 1 / 4) };
  }
  return { whole: best.whole, part: best.part };
}

const METRIC = new Set([
  "gram",
  "kilogram",
  "milligram",
  "milliliter",
  "liter",
  "centiliter",
  "deciliter",
]);

/** A number written the way the unit is measured. */
export function amountText(value: number, unit: string | null, vulgar = false): string {
  if (unit && METRIC.has(unit)) {
    const step =
      unit === "kilogram"
        ? 0.01
        : unit === "liter"
          ? 0.05
          : unit === "milliliter" && value >= 500
            ? 10
            : value >= 100
              ? 5
              : value >= 10
                ? 1
                : 0.5;
    const rounded = Math.round(value / step) * step;
    return String(Number(rounded.toFixed(2)));
  }
  const { whole, part } = nearest(value, unit);
  const fraction = FRACTIONS.find(([v]) => Math.abs(v - part) < 1e-9);
  if (!fraction) return String(whole);
  const written = vulgar ? fraction[2] : fraction[1];
  if (whole === 0) return written;
  return vulgar ? `${whole}${written}` : `${whole} ${written}`;
}

/** The value a written number shows ("1 1/2", "¾", "2-3": the last of a range). */
function shownNumber(text: string): number {
  const last = text.split(/\s*(?:-|to|or)\s*/u).pop() ?? text;
  const vulgar = /^(\d*)\s*([¼-¾⅐-⅞])$/u.exec(last);
  const VULGAR: Record<string, number> = Object.fromEntries(FRACTIONS.map(([v, , u]) => [u, v]));
  if (vulgar) return Number(vulgar[1] || 0) + (VULGAR[vulgar[2] ?? ""] ?? 0);
  const mixed = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(last);
  if (mixed) return Number(mixed[1] ?? 0) + Number(mixed[2]) / Number(mixed[3]);
  const word = NUMBER_WORDS.indexOf(last.toLowerCase());
  if (word !== -1) return word;
  return Number(last);
}

/** The amount as it will read, for comparing ("1" or more is plural). */
const readsAsMany = (value: number) => value > 1 + 1e-9;

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

/** How Fennl writes a unit it converted to. */
const WRITTEN: Record<string, { one: string; many: string }> = {
  teaspoon: { one: "tsp", many: "tsp" },
  tablespoon: { one: "Tbsp", many: "Tbsp" },
  cup: { one: "cup", many: "cups" },
  "fluid ounce": { one: "fl oz", many: "fl oz" },
  ounce: { one: "oz", many: "oz" },
  pound: { one: "lb", many: "lb" },
  gram: { one: "g", many: "g" },
  kilogram: { one: "kg", many: "kg" },
  milliliter: { one: "ml", many: "ml" },
  liter: { one: "l", many: "l" },
};

/** Abbreviations, the same for one and many ("1 lb", "2 lb"). */
const ABBREVIATIONS = new Set(
  "t ts tsp tsps tspn tspns teas teasp tb tbs tbsp tbsps tbl tbls tblsp c oz lb lbs # g gm gms gr kg kgs mg ml mls l ltr cl dl pt pts qt qts gal fl oz floz pkg pkgs pkt pkts pc pcs doz".split(
    " ",
  ),
);

/** A unit word as written, made singular or plural to match the amount ("bag" and "bags"). */
function numbered(written: string, unit: Unit, many: boolean): string {
  const lower = written.toLowerCase().replace(/\.$/, "");
  if (ABBREVIATIONS.has(lower)) return written;
  const words = unit.words;
  const plurals = (w: string) => [`${w}s`, `${w}es`, w.endsWith("f") ? `${w.slice(0, -1)}ves` : ""];
  let target = lower;
  if (many) {
    const plural = plurals(lower).find((p) => p && words.includes(p));
    if (plural) target = plural;
  } else {
    const single = words.find((w) => plurals(w).includes(lower));
    if (single) target = single;
  }
  if (target === lower) return written;
  return written[0] === written[0]?.toUpperCase() && written[0] !== written[0]?.toLowerCase()
    ? target[0]?.toUpperCase() + target.slice(1)
    : target;
}

/** Where a unit is written inside an amount's text: the first spelling of it after the number. */
function unitWritten(span: string, unit: Unit): { at: number; text: string } | null {
  const spellings = [...unit.words, ...(unit.exact ?? [])].sort((a, b) => b.length - a.length);
  for (let i = 0; i < span.length; i++) {
    if (i > 0 && /[\p{L}]/u.test(span[i - 1] ?? "")) continue;
    for (const s of spellings) {
      const piece = span.slice(i, i + s.length);
      const exact = unit.exact?.includes(s);
      if (
        (exact ? piece === s : piece.toLowerCase() === s.toLowerCase()) &&
        !/[\p{L}]/u.test(span[i + s.length] ?? "")
      ) {
        return { at: i, text: piece };
      }
    }
  }
  return null;
}

/** The friendly US volume: tablespoons that make a clean fraction of a cup become cups. */
function friendlyVolume(
  ml: number,
  start: string,
  spoonsOnly = false,
): { value: number; unit: string } {
  const tsp = ml / 4.92892;
  const tbsp = ml / 14.7868;
  const cups = ml / 236.588;
  // Cups in quarters and thirds, tablespoons and teaspoons in halves: "4 tsp", not "1 1/3 Tbsp".
  const parts: Record<string, number[]> = {
    cup: [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4],
    tablespoon: [0, 1 / 2],
    teaspoon: [0, 1 / 4, 1 / 2, 3 / 4],
  };
  const clean = (v: number, unit: string) =>
    (parts[unit] ?? [0]).some(
      (f) => Math.abs(v - Math.floor(v) - f) < 0.02 || Math.abs(v - Math.ceil(v)) < 0.02,
    );
  if (start === "fluid ounce") return { value: ml / 29.5735, unit: start };
  if (
    !spoonsOnly &&
    (start === "teaspoon" || start === "tablespoon") &&
    tbsp >= 4 &&
    clean(cups, "cup")
  ) {
    return { value: cups, unit: "cup" };
  }
  if (start === "teaspoon" && tsp >= 3 && clean(tbsp, "tablespoon")) {
    return { value: tbsp, unit: "tablespoon" };
  }
  if (start === "teaspoon") return { value: tsp, unit: "teaspoon" };
  if (start === "tablespoon") {
    if (tbsp < 1 && clean(tsp, "teaspoon")) return { value: tsp, unit: "teaspoon" };
    return { value: tbsp, unit: "tablespoon" };
  }
  // Under a cup that isn't a clean quarter or third: tablespoons ("9 Tbsp", not "5/8 cup").
  if (cups < 1 && tbsp >= 1 && !clean(cups, "cup") && clean(tbsp, "tablespoon")) {
    return { value: tbsp, unit: "tablespoon" };
  }
  // Cups, and anything converted from metric.
  if (cups >= 0.25 || start === "cup") {
    if (cups < 0.25 && tbsp >= 1) return { value: tbsp, unit: "tablespoon" };
    if (cups < 0.25) return { value: tsp, unit: "teaspoon" };
    return { value: cups, unit: "cup" };
  }
  if (tbsp >= 1) return { value: tbsp, unit: "tablespoon" };
  return { value: tsp, unit: "teaspoon" };
}

/** The friendly US weight: ounces that make a clean quarter pound or more become pounds. */
function friendlyWeight(grams: number, start: string): { value: number; unit: string } {
  const oz = grams / 28.3495;
  const lb = grams / 453.592;
  if (start === "pound")
    return lb < 0.25 ? { value: oz, unit: "ounce" } : { value: lb, unit: "pound" };
  // From metric, a pound or more reads in pounds when it comes out close: "2 1/4 lb" for 1 kg,
  // not "35 1/4 oz"; 500 g stays "17 2/3 oz", since "1 lb" would be 10% off.
  if (start === "gram" && lb >= 1) {
    const { whole, part } = nearest(lb, "pound");
    if (Math.abs(whole + part - lb) / lb < 0.03) return { value: lb, unit: "pound" };
  }
  if (oz >= 16) {
    const { whole, part } = nearest(lb, "pound");
    if (Math.abs(whole + part - lb) < 0.01) return { value: lb, unit: "pound" };
  }
  return { value: oz, unit: "ounce" };
}

/**
 * An amount in a unit, scaled and in the unit system chosen. Units that aren't volumes or weights
 * (cans, cloves) only scale.
 */
function converted(
  value: number,
  unitName: string | null,
  units: UnitSystem,
  scaled: boolean,
): { value: number; unit: string | null } {
  const unit = unitName ? unitNamed(unitName) : undefined;
  if (!unit?.base || (unit.kind !== "volume" && unit.kind !== "weight")) {
    return { value, unit: unitName };
  }
  const base = value * unit.base;
  const metricUnit = METRIC.has(unit.name);
  const spoon = unit.name === "teaspoon" || unit.name === "tablespoon";
  if (units === "metric" && !metricUnit && !spoon) {
    if (unit.kind === "weight") {
      return base >= 1000
        ? { value: base / 1000, unit: "kilogram" }
        : { value: base, unit: "gram" };
    }
    return base >= 1000
      ? { value: base / 1000, unit: "liter" }
      : { value: base, unit: "milliliter" };
  }
  if (units === "us" && metricUnit) {
    return unit.kind === "weight"
      ? friendlyWeight(base, "gram")
      : friendlyVolume(base, "milliliter");
  }
  // In its own system: written the friendly way once scaled (spoons stay spoons in metric).
  if (scaled && !metricUnit) {
    return unit.kind === "weight"
      ? friendlyWeight(base, unit.name)
      : friendlyVolume(base, unit.name, units === "metric");
  }
  if (scaled && metricUnit) {
    if (unit.name === "gram" && base >= 1000) return { value: base / 1000, unit: "kilogram" };
    if (unit.name === "milliliter" && base >= 1000) return { value: base / 1000, unit: "liter" };
  }
  return { value, unit: unit.name };
}

// ---------------------------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------------------------

const APPROX = /^(?:about|approximately|approx\.?|around|roughly|~)\s*/iu;

/**
 * An amount written anew: scaled by `factor` (1 to leave the number) and in the unit system
 * chosen, in the same style as written (a "½" stays a "½", "Two" stays a word). Null when it
 * reads exactly as before.
 */
function rewrite(
  text: string,
  a: IngredientAmount,
  factor: number,
  units: UnitSystem,
  friendly = true,
): { text: string; value: number; unit: string | null } | null {
  const span = text.slice(a.start, a.end);
  const approx = APPROX.exec(span)?.[0] ?? "";
  const unit = a.unit ? unitNamed(a.unit) : undefined;
  const scaled = factor !== 1;
  const low = converted(a.low * factor, a.unit, units, scaled && friendly);
  // Not scaled and still in its own unit: exactly as written.
  if (!scaled && low.unit === a.unit) return null;
  const high =
    a.high === null ? null : converted(a.high * factor, a.unit, units, scaled && friendly);
  // A range keeps one unit: the low end's.
  const highValue =
    high === null
      ? null
      : low.unit === high.unit
        ? high.value
        : (a.high ?? 0) * factor * ((unit?.base ?? 1) / (unitNamed(low.unit ?? "")?.base ?? 1));
  const vulgar = /[¼-¾⅐-⅞]/u.test(span);
  // "14.5-oz" stays a decimal, in the same unit.
  const decimal = /\d\.\d/.test(span) && low.unit === a.unit && !(low.unit && METRIC.has(low.unit));
  const number = (v: number) =>
    decimal ? String(Number(v.toFixed(2))) : amountText(v, low.unit, vulgar);
  // "Two 28-ounce cans": a small whole number written as a word stays a word.
  const word = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/iu.exec(
    span.slice(approx.length),
  )?.[0];
  let numberText = number(low.value);
  if (
    word &&
    highValue === null &&
    Number.isInteger(Number(numberText)) &&
    Number(numberText) <= 12
  ) {
    const w = NUMBER_WORDS[Number(numberText)] ?? numberText;
    numberText = word[0] === word[0]?.toUpperCase() ? w[0]?.toUpperCase() + w.slice(1) : w;
  }
  if (highValue !== null) {
    const joiner = /\s+to\s+|\s+or\s+/iu.exec(span)?.[0] ?? "-";
    numberText += joiner + number(highValue);
  }
  const shownValue = shownNumber(numberText);
  const many = readsAsMany(shownValue);
  let unitText = "";
  let gap = "";
  const written = unit ? unitWritten(span.slice(approx.length), unit) : null;
  if (unit && !written && low.unit === unit.name) {
    // "2 (14.5-oz) cans": the unit is written after the size, not here. Only the number.
  } else if (unit) {
    if (low.unit === unit.name && written) {
      const before = span.slice(approx.length, approx.length + written.at);
      gap = /[-‐‑]\s*$/u.test(before) ? "-" : /\s$/u.test(before) ? " " : "";
      // "28-ounce cans": a size before a noun stays singular.
      unitText = gap === "-" ? written.text : numbered(written.text, unit, many);
    } else if (low.unit) {
      const w = WRITTEN[low.unit];
      unitText = w ? (many ? w.many : w.one) : low.unit;
      gap = " ";
    }
  }
  // A combined amount ("1 pound 4 ounces") is written in its first unit.
  const out = `${approx}${numberText}${gap}${unitText}`;
  if (out === span) return null;
  return { text: out, value: low.value, unit: low.unit };
}

/** Pieces of `text` with the replacements put in, each marked as changed. */
function piecesOf(
  text: string,
  edits: { start: number; end: number; text: string; unchanged?: boolean }[],
): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const e of [...edits].sort((x, y) => x.start - y.start)) {
    if (e.start < at) continue;
    if (e.start > at) pieces.push({ text: text.slice(at, e.start) });
    pieces.push(e.unchanged ? { text: e.text, unchanged: true } : { text: e.text, changed: true });
    at = e.end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

/** "1 egg" doubled is "2 eggs": the item's last word, made plural or singular, when it's simple. */
function numberedItem(word: string, many: boolean): string {
  const lower = word.toLowerCase();
  if (many) {
    if (/(?:s|x|z|ch|sh)$/.test(lower)) return /s$/.test(lower) ? word : `${word}es`;
    if (/[^aeiou]y$/.test(lower)) return `${word.slice(0, -1)}ies`;
    if (/(?:tomato|potato)$/.test(lower)) return `${word}es`;
    if (/leaf$/.test(lower)) return `${word.slice(0, -1)}ves`;
    return `${word}s`;
  }
  if (/ies$/.test(lower)) return `${word.slice(0, -3)}y`;
  if (/(?:tomato|potato)es$/.test(lower)) return word.slice(0, -2);
  if (/leaves$/.test(lower)) return `${word.slice(0, -3)}f`;
  if (/(?:ch|sh|x|z)es$/.test(lower)) return word.slice(0, -2);
  if (/[^s]s$/.test(lower)) return word.slice(0, -1);
  return word;
}

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

/**
 * An ingredient line as it's shown, scaled by `factor` and in the unit system chosen. A line
 * held at its written amount only converts.
 */
export function showIngredient(text: string, options: ShowOptions, held = false): ShownLine {
  const factor = held ? 1 : options.factor;
  if (factor === 1 && options.units === "written") return plain(text);
  const read = readIngredient(text);
  const main = read.amounts.find((a) => a.role === "main");
  const mainUnit = main?.unit ? unitNamed(main.unit) : undefined;
  // A line that already gives the amount in the system chosen ("1 cup / 240 ml", "2 lb (900 g)")
  // isn't converted: its own words are the conversion.
  const inSystem = (a: IngredientAmount) => {
    const u = a.unit ? unitNamed(a.unit) : undefined;
    if (!u || (u.kind !== "volume" && u.kind !== "weight")) return false;
    const metric = METRIC.has(u.name);
    return options.units === "metric" ? metric : options.units === "us" ? !metric : false;
  };
  const pair = read.amounts.filter((a) => a.role === "main" || a.role === "alternate");
  const units: UnitSystem =
    pair.some(inSystem) && pair.some((a) => !inSystem(a)) ? "written" : options.units;
  const edits: { start: number; end: number; text: string; unchanged?: boolean }[] = [];
  let total: string | undefined;
  let mainValue: number | null = null;

  for (const a of read.amounts) {
    if (a.role === "main") {
      const r = rewrite(text, a, factor, units);
      mainValue = a.low * factor;
      if (r) edits.push({ start: a.start, end: a.end, text: r.text });
      // "2 (14.5-oz) cans" halved: "1 (14.5-oz) can". The container is written after the size.
      const unit = a.unit ? unitNamed(a.unit) : undefined;
      if (r && unit?.kind === "count" && !unitWritten(text.slice(a.start, a.end), unit)) {
        const after = unitWritten(text.slice(a.end), unit);
        if (after) {
          const start = a.end + after.at;
          const next = numbered(after.text, unit, readsAsMany(shownNumber(r.text)));
          if (next !== after.text)
            edits.push({ start, end: start + after.text.length, text: next });
        }
      }
      continue;
    }
    if (a.role === "size") {
      // "2 (14.5-oz) cans", "Four 5-ounce breasts": each one's size never scales. Converted only
      // in brackets: "1 7 g envelope" would read as two amounts.
      const bracketed = /[([]\s*$/u.test(text.slice(0, a.start));
      const r = rewrite(text, a, 1, bracketed ? units : "written");
      if (r) edits.push({ start: a.start, end: a.end, text: r.text });
      continue;
    }
    if (a.role === "alternate") {
      if (main && mainUnit && CONTAINERS.has(mainUnit.name)) {
        // "1 bag (16 oz)": one package's size. Stays, and says "each" once scaled.
        const r = rewrite(text, a, 1, units);
        const size = r?.text ?? text.slice(a.start, a.end);
        const count = main.low * factor;
        let shown = factor !== 1 ? `${size} each` : size;
        if (factor !== 1 && !Number.isInteger(Math.round(count * 1000) / 1000)) {
          // In the size's own unit, so the two can be compared: "16 oz each, 24 oz in all".
          const all = rewrite(text, { ...a, high: null }, count, units, false);
          total = `${all?.text ?? text.slice(a.start, a.end)} in all`;
          shown += `, ${total}`;
        }
        if (shown !== text.slice(a.start, a.end))
          edits.push({ start: a.start, end: a.end, text: shown });
        continue;
      }
      if (mainUnit && mainUnit.kind === "count") {
        // "2 slices (1 oz)": can't tell whether that's each or all of them. Left as written.
        if (factor !== 1) {
          edits.push({
            start: a.start,
            end: a.end,
            text: text.slice(a.start, a.end),
            unchanged: true,
          });
        }
        continue;
      }
      // "1 cup (240 g)": the same amount another way. Scales with it.
      const r = rewrite(text, a, factor, units);
      if (r) edits.push({ start: a.start, end: a.end, text: r.text });
      continue;
    }
    // Other amounts on the line ("or 1 teaspoon extract", "(113g)"): measured ones scale.
    const unit = a.unit ? unitNamed(a.unit) : undefined;
    if (unit && (unit.kind === "volume" || unit.kind === "weight")) {
      const r = rewrite(text, a, factor, units);
      if (r) edits.push({ start: a.start, end: a.end, text: r.text });
    }
  }

  // "1 egg" doubled: "2 eggs". Only a plain count with no unit, and only the item's last word.
  if (main && !main.unit && mainValue !== null && read.item && factor !== 1) {
    const wasMany = readsAsMany(main.high ?? main.low);
    const isMany = readsAsMany((main.high ?? main.low) * factor);
    if (wasMany !== isMany) {
      const at = text.indexOf(read.item, main.end);
      const last = /([\p{L}]+)$/u.exec(read.item);
      if (at !== -1 && last) {
        const start = at + read.item.length - (last[1]?.length ?? 0);
        const word = last[1] ?? "";
        const next = numberedItem(word, isMany);
        if (next !== word) edits.push({ start, end: start + word.length, text: next });
      }
    }
  }

  const pieces = piecesOf(text, edits);
  return { pieces, changed: pieces.some((p) => p.changed), ...(total ? { total } : {}) };
}

/**
 * A step as it's shown: amounts with a measuring unit scale and convert ("1/2 cup of the sugar");
 * times, temperatures, pan sizes and plain counts stay as written.
 */
export function showStep(text: string, options: ShowOptions): ShownLine {
  if (options.factor === 1 && options.units === "written") return plain(text);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const a of amountsWithin(text)) {
    const unit = a.unit ? unitNamed(a.unit) : undefined;
    if (!unit || (unit.kind !== "volume" && unit.kind !== "weight")) continue;
    const r = rewrite(text, a, options.factor, options.units);
    if (r) edits.push({ start: a.start, end: a.end, text: r.text });
  }
  const pieces = piecesOf(text, edits);
  return { pieces, changed: pieces.some((p) => p.changed) };
}

/** Servings once scaled: the count, and the first number in the words ("about 12 pancakes"). */
export function scaledServings(servings: RecipeServings, factor: number): RecipeServings {
  if (factor === 1) return servings;
  // People and pieces come whole: "Serves 18", not 18.4 (a pan's factor rarely comes out even).
  const count = servings.count === null ? null : Math.max(1, Math.round(servings.count * factor));
  return { count, yield: servings.yield ? scaledYield(servings.yield, factor) : servings.yield };
}

/** A count in a yield: whole from 3 up ("about 22 pancakes"), a fraction below ("1½ loaves"). */
const countText = (value: number) =>
  value >= 3 ? String(Math.round(value)) : amountText(value, null);

function scaledYield(words: string, factor: number): string {
  // "One 12x17-inch loaf": a number word first stays a word while it can.
  const word = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/iu.exec(words);
  if (word) {
    const value = NUMBER_WORDS.indexOf(word[1]?.toLowerCase() ?? "") * factor;
    const next =
      Number.isInteger(value) && value <= 12
        ? (NUMBER_WORDS[value] ?? "")
        : amountText(value, null);
    const cased =
      word[1]?.[0] === word[1]?.[0]?.toUpperCase() && /^\p{L}/u.test(next)
        ? next[0]?.toUpperCase() + next.slice(1)
        : next;
    return cased + words.slice(word[0].length);
  }
  // The first number that isn't a size ("Serves 4 to 6", not "9-inch"), and the word after it
  // made plural or singular when it's the last one ("1 pie" doubled is "2 pies").
  return words.replace(
    /(?<![\d./x×-])(\d+)(?:(\s*(?:to|-|–)\s*)(\d+))?(?![\d./x×]|[-‐‑]?\s*(?:inch|in\b|"))(?:(\s+\p{Ll}+)(?=\s*(?:[,.;(]|$)))?/u,
    (_whole, low: string, joiner?: string, high?: string, after?: string) => {
      const top = high ? Number(high) * factor : null;
      const shown = `${countText(Number(low) * factor)}${top === null ? "" : `${joiner}${countText(top)}`}`;
      if (!after) return shown;
      const many = readsAsMany(shownNumber(shown));
      const item = after.trimStart();
      return `${shown}${after.slice(0, after.length - item.length)}${numberedItem(item, many)}`;
    },
  );
}

/** What a factor is called: "Doubled", "Halved", "1½×", "about 1¾×" (spec.md F2). */
export function factorName(factor: number): string {
  return factorText(factor);
}

/** Every unit the reader knows, for tests. */
export const KNOWN_UNITS = UNITS.map((u) => u.name);
