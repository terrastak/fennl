import type { RecipeServings, RecipeSource, RecipeTime } from "./recipe";

// How a recipe's details read in words, wherever they're shown: the app (app/recipes/format.ts)
// and the export's web pages (worker/export/). And the other way: a time in words read as
// minutes, for the editor's time boxes and for imports (phase E3).

/** 75 → "1 hr 15 min", 30 → "30 min", 120 → "2 hr". */
export function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** A time as it reads: minutes, with any words ("plus overnight"), or just the words. */
export function timeText(time: RecipeTime): string | null {
  if (time.minutes === null) return time.text?.trim() || null;
  const extra = time.text?.trim();
  return extra ? `${minutesText(time.minutes)} ${extra}` : minutesText(time.minutes);
}

/** "Serves 6", "2 loaves", or "Serves 8 · about 24 cookies". */
export function servingsText(servings: RecipeServings): string | null {
  const count = servings.count !== null ? `Serves ${servings.count}` : null;
  const made = servings.yield?.trim() || null;
  if (count && made) return made.toLowerCase().startsWith("serves") ? made : `${count} · ${made}`;
  return count ?? made;
}

/** A source worth showing as a line of its own (a person's name shows by the title instead). */
export function sourceLine(source: RecipeSource): string | null {
  if (source.kind === "person") return null;
  const parts = [
    source.name,
    source.author ? `by ${source.author}` : null,
    source.page ? `page ${source.page}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

const FRACTIONS: Record<string, string> = {
  "¼": " 1/4",
  "½": " 1/2",
  "¾": " 3/4",
  "⅓": " 1/3",
  "⅔": " 2/3",
};

const UNIT_MINUTES: [RegExp, number][] = [
  [/^(?:days?|d)$/i, 24 * 60],
  [/^(?:hours?|hrs?|h)$/i, 60],
  [/^(?:minutes?|mins?|m)$/i, 1],
];

/** "1 1/2" → 1.5, "1.5" → 1.5, "3/4" → 0.75. */
function amount(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .reduce((sum, part) => {
      const [top, bottom] = part.split("/");
      return sum + (bottom ? Number(top) / Number(bottom) : Number(part.replace(",", ".")));
    }, 0);
}

const TIME_PART = /^\s*(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*([a-z]+)?\.?\s*(?:,|and\b)?/i;

/**
 * A time box as typed: "1 hr 30 min", "90", "1½ hours", "45 min plus resting". The amount at the
 * start becomes minutes; anything after it is kept as words ("plus resting"). Words alone
 * ("overnight") are kept as they are.
 */
export function timeFromText(input: string): RecipeTime {
  let rest = input.replace(/[¼½¾⅓⅔]/g, (f) => FRACTIONS[f] ?? f).trim();
  let minutes = 0;
  let parts = 0;
  let lastUnit = 0;
  for (;;) {
    const match = TIME_PART.exec(rest);
    if (!match) break;
    const value = amount(match[1] ?? "");
    const word = match[2] ?? "";
    const unit = UNIT_MINUTES.find(([pattern]) => pattern.test(word))?.[1];
    if (unit === undefined) {
      // A bare number: minutes when it's all there is, or when it follows hours ("1 h 30").
      const after = rest.slice(match[0].length).trim();
      if (word || !((parts === 0 && !after) || lastUnit === 60)) break;
      minutes += value;
      parts += 1;
      rest = after;
      break;
    }
    minutes += value * unit;
    parts += 1;
    lastUnit = unit;
    rest = rest.slice(match[0].length);
  }
  const words = rest.trim();
  if (parts === 0) return { minutes: null, text: input.trim() || null };
  return { minutes: Math.round(minutes), text: words || null };
}
