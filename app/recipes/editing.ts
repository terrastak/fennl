import {
  RECIPE_FIELDS,
  RECIPE_RULES,
  type RecipeContent,
  type RecipeField,
  type RecipeIssue,
  type RecipeTime,
} from "../../shared/recipe";
import { cleanLine, type ListKind } from "../../shared/recipeLines";

// Small pieces of the recipe editor (phase C6), kept apart so they can be tested on their own.

/**
 * Which of the list's lines the cursor is on (its place among the lines the text box makes:
 * blank lines don't count), or null on a blank line.
 */
export function lineAt(text: string, cursor: number, kind: ListKind): number | null {
  const before = text.slice(0, cursor).split("\n");
  const rawIndex = before.length - 1;
  const raw = text.split("\n");
  if (!cleanLine(raw[rawIndex] ?? "", kind)) return null;
  return raw.slice(0, rawIndex).filter((line) => cleanLine(line, kind)).length;
}

/** Where the list's line number `index` ends in the text box (blank lines don't count). */
export function lineEnd(text: string, index: number, kind: ListKind): number {
  let position = -1;
  let kept = -1;
  for (const raw of text.split("\n")) {
    position += raw.length + 1;
    if (cleanLine(raw, kind)) kept += 1;
    if (kept === index) return position;
  }
  return text.length;
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

/**
 * Alt+↑ / Alt+↓ in a text box: moves the line the cursor is on up or down one place, keeping the
 * cursor on it. Null at the top or bottom.
 */
export function moveLine(
  text: string,
  cursor: number,
  direction: -1 | 1,
): { text: string; cursor: number } | null {
  const lines = text.split("\n");
  let index = 0;
  let start = 0;
  while (index < lines.length - 1 && start + (lines[index]?.length ?? 0) < cursor) {
    start += (lines[index]?.length ?? 0) + 1;
    index += 1;
  }
  const target = index + direction;
  if (target < 0 || target >= lines.length) return null;
  const column = cursor - start;
  const moved = [...lines];
  [moved[index], moved[target]] = [moved[target] ?? "", moved[index] ?? ""];
  const newStart = moved.slice(0, target).reduce((sum, line) => sum + line.length + 1, 0);
  return { text: moved.join("\n"), cursor: newStart + column };
}

/** The recipe fields that differ between two versions. */
export function changedFields(before: RecipeContent, after: RecipeContent): RecipeField[] {
  return RECIPE_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

/** Some fields of a recipe, for a change. */
export function pick(content: RecipeContent, fields: RecipeField[]): Partial<RecipeContent> {
  return Object.fromEntries(fields.map((field) => [field, content[field]]));
}

/** A web address as typed: "example.com/stew" gets its "https://"; empty is none. */
export function webAddress(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

/** What to say about a problem with a field, beside it. */
export function issueMessage(issue: RecipeIssue): string {
  const line = /^(?:ingredients|directions)\.(\d+)\./.exec(issue.path)?.[1];
  if (line !== undefined) return `Line ${Number(line) + 1} is too long.`;
  if (issue.path === "title" && issue.problem === "missing") return "Give the recipe a title.";
  if (issue.problem === "too_many") return `Up to ${RECIPE_RULES.linesPerList} lines.`;
  if (issue.problem === "too_long") return "This is too long.";
  if (issue.path === "source.url") return "This doesn't look like a web address.";
  if (issue.path.startsWith("times.")) return "That's longer than a month.";
  if (issue.path === "servings.count") return "A number from 1 up.";
  return "This can't be saved as it is.";
}

/** A whole number from a number box, or null when it's empty or not a number. */
export function wholeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}
