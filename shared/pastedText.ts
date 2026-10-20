import {
  DRAFT_VERSION,
  type Confidence,
  type DraftFields,
  type DraftValue,
  type Evidence,
  type RecipeDraft,
} from "./importDraft";
import { directionsFromText, ingredientsFromText } from "./recipeLines";
import type { RecipeTime, RecipeTimes } from "./recipe";
import { readDuration, readYield } from "./webText";

/**
 * Recipe text pasted into Fennl (phase E15), read without the AI when it is clearly laid out:
 * a title, then an "Ingredients" heading and a "Directions" heading with their lines under
 * them, optionally with "Serves 4" and "Prep time: 15 minutes" lines. Anything less clear (no
 * headings, several recipes, a recipe in a paragraph) is left to the AI (worker/import/
 * pastedImport.ts), which costs something; this costs nothing, so Free can use it.
 *
 * Reads only the text it's given; never fetches. A web address on its own is not a recipe.
 */

export const PASTED_IMPORTER = "pasted-text";

/** The most characters one paste can hold (decided by the owner, 2026-10-20). */
export const PASTED_TEXT_CHARS = 60_000;

/** What the review screen calls where it came from. The recipe's own source field stays empty. */
export const PASTED_SOURCE_NAME = "Pasted text";

/** Shorter than this holds no recipe; it isn't worth an AI read. */
export const MIN_PASTED_CHARS = 40;

export type PastedRead =
  | { kind: "web_address"; url: string }
  | { kind: "recipe"; draft: RecipeDraft }
  /** Not clearly laid out (or more than one recipe): the AI has to read it. */
  | { kind: "unclear" };

const HEADINGS = {
  ingredients: /^(?:ingredients?|what you(?:'|’)ll need|you(?:'|’)ll need)$/i,
  directions: /^(?:directions?|instructions?|method|preparation|steps?|procedure|how to make it)$/i,
  notes: /^(?:notes?|tips?|variations?|cook(?:'|’)?s notes?)$/i,
} as const;
type Section = keyof typeof HEADINGS;

/** "## Ingredients:", "**INGREDIENTS**", "Ingredients" → the section it starts, or null. */
function sectionOf(line: string): Section | null {
  const bare = line
    .replace(/^[\s#*_>-]+/, "")
    .replace(/[\s*_:.-]+$/, "")
    .trim();
  if (!bare || bare.length > 30) return null;
  for (const key of Object.keys(HEADINGS) as Section[]) {
    if (HEADINGS[key].test(bare)) return key;
  }
  return null;
}

const SERVES = /^(?:serves|servings?|makes|yields?|yield)\s*:?\s*(.+)$/i;
const TIME = /^(prep(?:aration)?|cook(?:ing)?|total)(?:\s+time)?\s*:\s*(.+)$/i;

/** The text with its line endings made alike and its blank-line runs shortened. */
function normalised(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A single web address and nothing else. */
export function onlyWebAddress(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  return URL.canParse(t) ? t : null;
}

/**
 * A line written wholly in bold ("**For the soup:**") is a section heading, whatever it says;
 * the bold marks themselves are taken off. Reads the lines with `read`, then marks those.
 */
function withBoldHeadings<T extends { text: string; heading: boolean }>(
  body: string,
  read: (text: string) => T[],
): T[] {
  const bold = new Set<string>();
  const plain = body
    .split("\n")
    .map((line) => {
      const match = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/.exec(line);
      if (!match?.[1]) return line;
      bold.add(match[1].trim());
      return match[1].trim();
    })
    .join("\n");
  return read(plain).map((line) => (bold.has(line.text) ? { ...line, heading: true } : line));
}

const none: RecipeTime = { minutes: null, text: null };

function from(detail: string): Evidence[] {
  return [{ kind: "page_text", input: 0, detail }];
}

function put<T>(value: T, confidence: Confidence, detail: string): DraftValue<T> {
  return { value, confidence, from: from(detail) };
}

/**
 * Reads pasted text. A recipe comes back only when it is clearly laid out: exactly one
 * "Ingredients" and one "Directions" heading, a title above them, and lines under both.
 */
export function readPastedText(
  raw: string,
  newId: () => string = () => crypto.randomUUID(),
): PastedRead {
  const text = normalised(raw);
  const address = onlyWebAddress(text);
  if (address) return { kind: "web_address", url: address };

  const lines = text.split("\n");
  const marks: { at: number; section: Section }[] = [];
  lines.forEach((line, at) => {
    const section = sectionOf(line);
    if (section) marks.push({ at, section });
  });
  const count = (s: Section) => marks.filter((m) => m.section === s).length;
  if (count("ingredients") !== 1 || count("directions") !== 1 || count("notes") > 1) {
    return { kind: "unclear" };
  }

  const first = marks[0];
  if (!first) return { kind: "unclear" };
  const head = lines.slice(0, first.at).map((l) => l.trim());
  const body = (section: Section): string => {
    const index = marks.findIndex((m) => m.section === section);
    const start = (marks[index]?.at ?? 0) + 1;
    const end = marks[index + 1]?.at ?? lines.length;
    return lines.slice(start, end).join("\n");
  };

  // The head: a title, then whatever else is written before the first heading.
  const headLines = head.filter(Boolean);
  const title = headLines[0]?.replace(/^[\s#*_>]+|[\s*_]+$/g, "").trim() ?? "";
  if (!title || title.length > 150) return { kind: "unclear" };

  const times: RecipeTimes = { prep: none, cook: none, total: none };
  let servings = { count: null as number | null, yield: null as string | null };
  let timed = false;
  const prose: string[] = [];
  for (const line of headLines.slice(1)) {
    const time = TIME.exec(line);
    const serves = SERVES.exec(line);
    if (time?.[1] && time[2]) {
      const key = time[1].toLowerCase().startsWith("prep")
        ? "prep"
        : time[1].toLowerCase().startsWith("cook")
          ? "cook"
          : "total";
      const read = readDuration(time[2]);
      if (read) {
        times[key] = read;
        timed = true;
        continue;
      }
    }
    if (serves?.[1]) {
      const read = readYield(serves[1]);
      // "Makes 24 cookies": the number is the count, as the AI reads it (worker/ai/prompt.ts).
      const lead = /^(\d{1,5})\b(?![/.,]\d)/.exec(serves[1].trim());
      if (read.count === null && lead?.[1]) read.count = Number(lead[1]);
      if (read.count !== null || read.yield) {
        servings = read;
        continue;
      }
    }
    prose.push(line);
  }

  const ingredients = withBoldHeadings(body("ingredients"), (text) =>
    ingredientsFromText(text, [], newId),
  );
  const directions = withBoldHeadings(body("directions"), (text) =>
    directionsFromText(text, [], newId),
  );
  const real = (lines: { heading: boolean }[]) => lines.filter((l) => !l.heading).length;
  if (real(ingredients) < 2 || real(directions) < 1) return { kind: "unclear" };

  const fields: DraftFields = {
    title: put(title, "high", "first line"),
    ingredients: put(ingredients, "high", "under “Ingredients”"),
    directions: put(directions, "high", "under “Directions”"),
  };
  const description = prose.join("\n").trim();
  if (description) fields.description = put(description, "medium", "above “Ingredients”");
  const notes = marks.some((m) => m.section === "notes") ? body("notes").trim() : "";
  if (notes) fields.notes = put(notes, "high", "under “Notes”");
  if (timed) fields.times = put(times, "high", "time lines");
  if (servings.count !== null || servings.yield) {
    fields.servings = put(servings, "high", "serving line");
  }

  const draft: RecipeDraft = {
    version: DRAFT_VERSION,
    source: "text",
    externalId: null,
    externalHash: null,
    inputs: [{ kind: "text", name: PASTED_SOURCE_NAME, url: null, imageHash: null }],
    fields,
    lineConfidence: {
      ingredients: ingredients.map(() => "high" as const),
      directions: directions.map(() => "high" as const),
    },
    categories: null,
    photos: [],
    warnings: [],
    producer: { importer: PASTED_IMPORTER, model: null },
  };
  return { kind: "recipe", draft };
}
