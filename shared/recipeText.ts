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

/** A domain-like name ("donnahay.com.au", "tasty.co"): no spaces, a dot. */
const isDomain = (name: string) => !/\s/u.test(name) && /\.[a-z]{2,}/iu.test(name);

/** A name's letters only, a domain without its ending: "donnahay.com.au" → "donnahay". */
function letters(name: string): string {
  const base = isDomain(name) ? (name.replace(/^www\./iu, "").split(".")[0] ?? name) : name;
  return base
    .toLowerCase()
    .replace(/^the\s+/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The same source named twice: "donnahay.com.au" and "Donna Hay", "Good Housekeeping" and "The Good Housekeeping Test Kitchen". */
function sameName(a: string, b: string): boolean {
  const x = letters(a);
  const y = letters(b);
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  // One inside the other only for names long enough not to match by chance ("Ann").
  return Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x));
}

/** A site's name without the tagline after it: "Bake from Scratch - #thebakefeed". */
function siteName(name: string | null, url: string | null): string | null {
  const trimmed = name?.trim();
  if (trimmed) {
    const first = trimmed.split(/\s+[-–—|:]\s+/u)[0]?.trim();
    return first && first.length >= 2 ? first : trimmed;
  }
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./iu, "") || null;
  } catch {
    return null;
  }
}

/** The recipe's author as credited: "By Sally" is Sally; an editor isn't the author. */
function authorName(author: string | null): string | null {
  const trimmed = author?.trim();
  if (!trimmed || /^edited\s+by\b/iu.test(trimmed)) return null;
  return trimmed.replace(/^(?:recipe\s+)?by\s+/iu, "") || null;
}

/**
 * Where a recipe came from, as one short credit and the link it opens (owner's choices
 * 2026-10-25): "Nigella Lawson via Food Network"; just the site when the author is the site
 * itself ("Cookie and Kate"), or just the person when the site is their own ("Donna Hay" for
 * donnahay.com.au); "Samin Nosrat, Salt Fat Acid Heat, page 42" for a cookbook. A person's
 * name (a family recipe) shows by the title instead, so it has no credit here.
 */
export function sourceCredit(source: RecipeSource): { text: string; url: string | null } | null {
  if (source.kind === "person") return null;
  const url = source.url?.trim() || null;
  const site = siteName(source.name, source.kind === "cookbook" ? null : url);
  const author = authorName(source.author);
  const page = source.page?.trim() ? `page ${source.page.trim()}` : null;
  let text: string | null;
  if (source.kind === "cookbook") {
    text = [author, site, page].filter(Boolean).join(", ") || null;
  } else {
    const who =
      author && site
        ? sameName(author, site)
          ? isDomain(site)
            ? author
            : site
          : `${author} via ${site}`
        : (author ?? site);
    text = [who, page].filter(Boolean).join(", ") || null;
  }
  return text ? { text, url } : null;
}

/** A source worth showing as a line of its own (a person's name shows by the title instead). */
export function sourceLine(source: RecipeSource): string | null {
  return sourceCredit(source)?.text ?? null;
}

/** What a recipe serves and makes, each once: "Serves 8" and "Makes about 24 cookies". */
export function servingsFacts(servings: RecipeServings): { label: string; value: string }[] {
  const count = servings.count;
  const made = servings.yield?.trim() || null;
  if (!made) return count !== null ? [{ label: "Serves", value: String(count) }] : [];
  const serves = /^serves\s+(.+)$/iu.exec(made);
  if (serves?.[1]) return [{ label: "Serves", value: serves[1] }];
  const value = made.replace(/^(?:makes|yields?|yield:)\s*/iu, "") || made;
  // "Makes 14" on a recipe that serves 14: the same number, said once.
  const sameNumber = count !== null && new RegExp(`(^|\\D)${count}(\\D|$)`, "u").test(value);
  const facts = [{ label: "Makes", value }];
  return count !== null && !sameNumber
    ? [{ label: "Serves", value: String(count) }, ...facts]
    : facts;
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
