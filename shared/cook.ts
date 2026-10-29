import { readIngredient } from "./ingredients";
import type { DirectionStep, IngredientLine } from "./recipe";

// Cook mode (phase F5): the ingredients each step uses, worked out from the words, and the
// times a step gives, so tapping "bake 25 minutes" starts a 25-minute timer. Nothing here is
// stored: it's worked out on display from the recipe as written.

/** Words in an ingredient that say how it's prepared or bought, not what it is. */
const PLAIN = new Set(
  (
    "fresh large small medium big extra virgin chopped diced minced sliced grated shredded " +
    "softened melted warm warmed cold hot room temperature plus more divided optional finely " +
    "roughly coarsely thinly peeled cut into piece pieces cube cubes inch taste about each " +
    "good quality whole packed loosely lightly heaping level unsalted salted dried ground " +
    "boneless skinless raw cooked canned frozen ripe firm and the for with your any some other"
  ).split(" "),
);

/** A word as matched: lower case, no accents, singular. */
function root(word: string): string {
  const w = word.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ches|shes|sses|xes|oes)$/u.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

const words = (text: string) =>
  text
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3)
    .map(root);

/** What an ingredient is called, as words to look for: the last ("head") word first. */
function itemWords(line: IngredientLine): string[] {
  const item = readIngredient(line.text).item ?? line.text;
  const all = words(item).filter((w) => !PLAIN.has(w));
  return all.reverse();
}

/**
 * The ingredient lines each step uses, by step ID: a line goes with a step that names it. Its
 * last word ("tortillas" in "flour tortillas") is looked for first; only when no step names that
 * do its other words count ("pork" in "pork shoulder").
 */
export function stepIngredients(
  steps: readonly DirectionStep[],
  ingredients: readonly IngredientLine[],
): Map<string, IngredientLine[]> {
  const stepWords = new Map(
    steps.filter((s) => !s.heading).map((s) => [s.id, new Set(words(s.text))]),
  );
  const result = new Map<string, IngredientLine[]>([...stepWords.keys()].map((id) => [id, []]));
  for (const line of ingredients) {
    if (line.heading) continue;
    const [head, ...rest] = itemWords(line);
    if (!head) continue;
    const named = [...stepWords].filter(([, set]) => set.has(head));
    const using =
      named.length > 0 ? named : [...stepWords].filter(([, set]) => rest.some((w) => set.has(w)));
    for (const [id] of using) result.get(id)?.push(line);
  }
  return result;
}

const NUMBER = String.raw`(\d+(?:\s+\d\/\d|\s*[½¼¾⅓⅔])?|\d*[½¼¾⅓⅔]|\d+\/\d|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)`;
const UNIT = String.raw`(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b`;
const TIME = new RegExp(
  `\\b${NUMBER}(?:\\s*(?:to|-|–|or)\\s*${NUMBER})?\\s*${UNIT}(?:\\s*(?:and\\s+)?${NUMBER}\\s*${UNIT})?`,
  "giu",
);

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  "forty-five": 45,
  sixty: 60,
  ninety: 90,
};

const FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
};

function value(text: string | undefined): number | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (t in WORDS) return WORDS[t] ?? null;
  const mixed = /^(\d+)\s+(\d)\/(\d)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(t);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const glyph = /^(\d*)\s*([½¼¾⅓⅔])$/u.exec(t);
  if (glyph) return Number(glyph[1] || 0) + (FRACTIONS[glyph[2] ?? ""] ?? 0);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const SECONDS = (unit: string | undefined) =>
  /^h/i.test(unit ?? "") ? 3600 : /^m/i.test(unit ?? "") ? 60 : 1;

/** A time a step gives, where it's written, and how long a timer for it runs. */
export interface StepTime {
  start: number;
  end: number;
  /** As written: "25 to 30 minutes". */
  text: string;
  /** The timer's length, in seconds: the low end of a range ("check at 25"). */
  seconds: number;
  /** A range's high end, in seconds ("25 to 30 minutes": 30 minutes); absent for one time. */
  upTo?: number;
}

/** Every time a step gives ("bake 25 to 30 minutes", "1 hour 15 minutes"). */
export function stepTimes(text: string): StepTime[] {
  const times: StepTime[] = [];
  for (const m of text.matchAll(TIME)) {
    const low = value(m[1]);
    if (low === null || low <= 0) continue;
    let seconds = low * SECONDS(m[3]);
    const more = value(m[4]);
    if (more !== null && m[5]) seconds += more * SECONDS(m[5]);
    if (seconds < 1 || seconds > 48 * 3600) continue;
    const high = value(m[2]);
    const upTo =
      high !== null && high > low
        ? high * SECONDS(m[3]) + (seconds - low * SECONDS(m[3]))
        : undefined;
    times.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      seconds: Math.round(seconds),
      ...(upTo ? { upTo: Math.round(upTo) } : {}),
    });
  }
  return times;
}

/**
 * A timer's name from its step (owner's choice 2026-10-29, as the earlier Fennl named them):
 * what the step does around the time, "Bake" for "Bake for 9-11 minutes.", "Bake until golden"
 * for "Bake 25 minutes or until golden", "Rest" for "…, then rest 5 minutes".
 */
export function timerName(stepText: string, time: StepTime, times = stepTimes(stepText)): string {
  const tidy = (words: string) =>
    words
      .replace(/^\s*(?:--+|[–—,:;])+\s*/u, "")
      .replace(/\s*(?:--+|[–—,:;])+\s*$/u, "")
      .replace(/\s+/g, " ")
      .trim();
  // Only this sentence, and only after a time before it in the step.
  const earlier = times.filter((t) => t.end <= time.start).at(-1);
  let before = stepText.slice(earlier?.end ?? 0, time.start);
  before = before.slice(Math.max(...[".", "!", "?", ";"].map((c) => before.lastIndexOf(c))) + 1);
  before = tidy(
    before
      .replace(/^[\s,]*(?:(?:and|then)\s+)*/iu, "")
      .replace(/(?:,?\s*(?:for|about|approximately|around|up to|another|a further))+\s*$/iu, ""),
  );
  const after = tidy(stepText.slice(time.end));
  const until = /^(?:or\s+)?((?:until|when|once)\b[^.!?,;]*)/iu.exec(after)?.[1];
  let name = until ? tidy(`${before} ${until}`) : before;
  if (!name) name = tidy(after.split(/[.!?](?:\s|$)/u, 1)[0] ?? "") || tidy(stepText) || "Timer";
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return name.length > 60 ? `${name.slice(0, 57).trimEnd()}…` : name;
}

/** A timer's time left, as a clock: "24:59", "1:05:00". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(rest)}` : `${m}:${two(rest)}`;
}

/** A length of time in words: "25 minutes", "1 hour 15 minutes", "30 seconds". */
export function durationText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const part = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);
  return (
    [h ? part(h, "hour") : "", m ? part(m, "minute") : "", s ? part(s, "second") : ""]
      .filter(Boolean)
      .join(" ") || "0 seconds"
  );
}
