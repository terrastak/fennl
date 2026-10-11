import type { AnyNode, Document, Element } from "domhandler";
import { getAttributeValue } from "domutils";
import { cleanLine, type ListKind } from "./recipeLines";
import { cleanText } from "./webText";

/**
 * What a page's visible recipe shows that its structured data leaves out (phase E3): section
 * headings ("For the frosting"), a line's fuller wording ("1 cup (236 ml) whole milk"), and the
 * recipe's notes.
 *
 * Schema.org has no place for ingredient sections, so sites drop them from the data; the page
 * still shows them. The structured lines are found on the page (whatever the site's layout),
 * and the headings shown between them are put back in the same places.
 */

/** A line as compared with the page: its words and numbers, so spacing and markup don't count. */
function tokens(text: string): string[] {
  return cleanText(text, true)
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function key(text: string): string {
  return tokens(text).join("");
}

/** How many words two lines have in common, in the same order (the longest common subsequence). */
function common(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const current = [0];
    for (let j = 1; j <= b.length; j++) {
      current[j] =
        word === b[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * How closely the page's text shows a line from the data: how much of the line it shows, and
 * how much of what it shows is the line (each 0 to 1), or null when it doesn't show it. Pages
 * often say a little more, less or otherwise than their data: "1 cup (236 ml) whole milk" for
 * "1 cup whole milk", "1/2 cup" for "1/2 c.", a note without its parentheses. So a line counts as
 * shown when the shorter one's words all appear in the longer, in order, making up at least half
 * of it; or when three in four words are the same, in the same order.
 */
function closeness(line: readonly string[], shown: readonly string[]): Fit | null {
  if (line.length === shown.length && line.every((w, i) => w === shown[i])) {
    return { coverage: 1, precision: 1 };
  }
  if (line.length < 2 || shown.length < 2) return null;
  const [short, long] = line.length <= shown.length ? [line, shown] : [shown, line];
  if (short.length * 2 < long.length) return null;
  // Most lines on a page share few words with a given line: a cheap check first.
  const words = new Set(long);
  if (short.filter((w) => words.has(w)).length < short.length * 0.6) return null;
  const same = common(short, long);
  if (same < short.length && same < long.length * 0.75) return null;
  return { coverage: same / line.length, precision: same / shown.length };
}

/** Whether one element shows a line better than another: more of it, then less besides. */
function better(a: Fit, b: Fit): boolean {
  return a.coverage > b.coverage || (a.coverage === b.coverage && a.precision > b.precision);
}

/** Not part of a recipe's text: buttons, scripts, the site's furniture. */
const SKIP =
  /^(?:script|style|noscript|template|svg|button|select|option|input|textarea|form|iframe|dialog)$/;

/** Elements the page hides: screen-reader text, closed pop-ups, error messages. */
function hidden(el: Element): boolean {
  // React's streamed pages send content in a hidden <div id="S:1"> that a script then shows.
  const streamed = /^S:\d+$/.test(getAttributeValue(el, "id") ?? "");
  if (getAttributeValue(el, "hidden") !== undefined && !streamed) return true;
  if (getAttributeValue(el, "aria-hidden") === "true") return true;
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(getAttributeValue(el, "style") ?? ""))
    return true;
  return (getAttributeValue(el, "class") ?? "")
    .split(/\s+/)
    .some(
      (c) =>
        /^(?:hidden|d-none|is-hidden)$/i.test(c) ||
        /(?:^|[-_])(?:sr-only|screen-reader-text|visually-?hidden)(?:$|[-_])/i.test(c),
    );
}

/** Labels a recipe card puts above its lists, not section headings of the recipe. */
const LABEL =
  /^(?:ingredients?|instructions?|directions?|method|preparation|steps?|step \d+|\d+|equipment|notes?|nutrition(?: facts| information)?|recipe notes|for the recipe|you(?:'|’)ll need|metric|us customary|imperial|\d+x)$/i;

/** Classes and tags of the elements sites use for section headings in a recipe card. */
const HEADING_CLASS = /(?:group|heading|header|title|section)/i;
const HEADING_TAG = /^(?:h[2-6]|strong|b|dt|legend|caption|th)$/;

export interface CardLine {
  text: string;
  heading: boolean;
}

interface Fit {
  coverage: number;
  precision: number;
}

interface Match {
  el: Element;
  index: number;
  fit: Fit;
}

function* visible(node: AnyNode): Generator<Element> {
  const children = "children" in node ? node.children : [];
  for (const child of children) {
    if (child.type !== "tag" || SKIP.test(child.name) || hidden(child)) continue;
    yield child;
    yield* visible(child);
  }
}

/** How much text a node holds, counted once for the whole page (pages run to thousands of elements). */
const lengths = new WeakMap<AnyNode, number>();
function textLength(node: AnyNode): number {
  if (node.type === "text") return node.data.length;
  if (!("children" in node)) return 0;
  const known = lengths.get(node);
  if (known !== undefined) return known;
  let total = 0;
  for (const child of node.children) total += textLength(child);
  lengths.set(node, total);
  return total;
}

function isInside(el: Element, ancestor: Element): boolean {
  for (let p = el.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

function ancestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let p = el.parent; p && p.type === "tag"; p = p.parent) out.push(p);
  return out;
}

/**
 * The page's elements showing the given lines: for each line, the smallest elements whose text
 * reads as that line.
 */
function matches(root: AnyNode, lines: readonly string[]): Match[] {
  const wanted = lines.map(tokens);
  const longest = Math.max(...wanted.map((w) => w.join(" ").length));
  const found: Match[] = [];
  for (const el of visible(root)) {
    if (textLength(el) > longest * 6 + 200) continue;
    const text = shownText(el);
    if (text.length > longest * 3 + 60) continue;
    const shown = tokens(text);
    if (shown.length === 0) continue;
    wanted.forEach((line, index) => {
      const fit = closeness(line, shown);
      if (!fit) return;
      // The smallest element showing it, unless a larger one shows more of it: the whole line
      // "⅓ cup (78 ml) water" rather than the "⅓ cup" inside it.
      const parent = found.findIndex((m) => m.index === index && isInside(el, m.el));
      if (parent >= 0) {
        if (better((found[parent] as Match).fit, fit)) return;
        found.splice(parent, 1);
      }
      found.push({ el, index, fit });
    });
  }
  return found;
}

/**
 * The element holding the page's copy of the list: the smallest one that shows all the lines
 * the page shows together. Pages often show a list twice (a summary at the top, the recipe card further down), so
 * the copy shown together in one place wins.
 */
function container(found: Match[], lineCount: number): Element | null {
  const counts = new Map<Element, Set<number>>();
  for (const { el, index } of found) {
    for (const a of ancestors(el)) {
      const set = counts.get(a) ?? new Set<number>();
      set.add(index);
      counts.set(a, set);
    }
  }
  // Most of the lines must be shown together; then the smallest element showing (nearly) all
  // of those, so a list in sections isn't cut down to its biggest section.
  const most = Math.max(0, ...[...counts.values()].map((set) => set.size));
  if (most < Math.max(2, Math.ceil(lineCount * 0.8))) return null;
  const needed = most - Math.floor(most * 0.05);
  let best: Element | null = null;
  let bestSize = Infinity;
  for (const [el, set] of counts) {
    if (set.size < needed) continue;
    const size = textLength(el);
    if (size < bestSize) {
      best = el;
      bestSize = size;
    }
  }
  return best;
}

function headingLike(el: Element): boolean {
  if (HEADING_TAG.test(el.name)) return true;
  return HEADING_CLASS.test(getAttributeValue(el, "class") ?? "");
}

/** Elements whose end makes a line break when the page's text is read as lines. */
const BLOCK =
  /^(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|section|article|table|tr|blockquote|figure|figcaption|hr)$/;

/** An element's text as the page shows it: hidden parts left out, a line break after each block. */
function shownText(node: AnyNode): string {
  const parts: string[] = [];
  const walk = (n: AnyNode) => {
    // In HTML, a line break in the text is just a space; blocks make the lines.
    if (n.type === "text") parts.push(n.data.replace(/\s+/g, " "));
    else if (n.type === "tag" && !SKIP.test(n.name) && !hidden(n)) {
      if (n.name === "br") parts.push("\n");
      for (const child of n.children) walk(child);
      const style = getAttributeValue(n, "style") ?? "";
      if (BLOCK.test(n.name) || /display\s*:\s*block/i.test(style)) parts.push("\n");
    }
  };
  walk(node);
  return parts.join("");
}

export interface ShownList {
  lines: CardLine[];
  /** Section headings were taken from the page. */
  headings: boolean;
  /** Some lines read as the page shows them, which says more than the data ("(236 ml)"). */
  texts: boolean;
}

/**
 * A list as the page shows it. The lines from the data stay in their order, and the page adds
 * what it shows that the data leaves out: the section headings between them (unless the data
 * has its own), and a line's fuller wording ("1 cup (236 ml) whole milk" for "1 cup whole
 * milk"). Null when the page doesn't show the list, or shows nothing more.
 */
export function asShown(
  doc: Document,
  lines: readonly CardLine[],
  kind: ListKind,
): ShownList | null {
  const items = lines.filter((l) => !l.heading).map((l) => l.text);
  if (items.length < 2) return null;
  const found = matches(doc, items);
  const box = container(found, items.length);
  if (!box) return null;
  const inBox = found.filter((m) => isInside(m.el, box));
  const matchedEls = new Set(inBox.map((m) => m.el));
  const itemKeys = new Set(items.map(key));
  const dataHasHeadings = lines.some((l) => l.heading);

  // Walk the list's element in order: a heading waits for the next line to go before it.
  const before = new Map<number, string>();
  const shown = new Map<number, string>();
  let pending: string | null = null;
  let last = -1;
  const done: Element[] = [];
  for (const el of visible(box)) {
    if (done.some((d) => isInside(el, d))) continue;
    if (matchedEls.has(el)) {
      done.push(el);
      // Lines are taken in order: a line shown again further on (an ingredient named in a
      // step, say) doesn't count twice.
      const here = inBox.filter((m) => m.el === el && m.index > last);
      if (here.length === 0) continue;
      // The line it shows best ("⅛ teaspoon allspice" rather than "⅛ teaspoon nutmeg").
      const best = here.reduce((a, b) => (better(b.fit, a.fit) ? b : a));
      last = best.index;
      if (pending !== null && !before.has(best.index)) before.set(best.index, pending);
      pending = null;
      // Saying at least as much as the data, the page's wording is used: it's what the person
      // sees ("1/2 cup (1 stick)" where the data says "1/2 c.").
      const text = cleanLine(cleanText(shownText(el), true), kind);
      const data = items[best.index] ?? "";
      if (text !== data && tokens(text).length >= tokens(data).length) shown.set(best.index, text);
      continue;
    }
    if (dataHasHeadings || !headingLike(el)) continue;
    if (inBox.some((m) => isInside(m.el, el))) continue;
    const text = cleanText(shownText(el), true).replace(/\s*:$/, ":");
    if (!text || text.length > 80 || LABEL.test(text.replace(/:$/, ""))) continue;
    if (itemKeys.has(key(text))) continue;
    done.push(el);
    pending = text;
  }
  if (before.size === 0 && shown.size === 0) return null;
  const out: CardLine[] = [];
  let index = 0;
  for (const line of lines) {
    if (line.heading) {
      out.push(line);
      continue;
    }
    const heading = before.get(index);
    if (heading) out.push({ text: heading, heading: true });
    out.push({ text: shown.get(index) ?? line.text, heading: false });
    index += 1;
  }
  return { lines: out, headings: before.size > 0, texts: shown.size > 0 };
}

/** Recipe card plugins' notes sections: WP Recipe Maker, Tasty Recipes, Mediavine Create. */
const NOTES_CLASS =
  /(?:^|\s)(?:wprm-recipe-notes|tasty-recipes-notes-body|tasty-recipe-notes|mv-create-notes-content|ERSNotes)(?:\s|$)/;

/** The recipe card's notes section, if it has one. */
export function notesElement(doc: Document): Element | null {
  for (const el of visible(doc)) {
    if (NOTES_CLASS.test(getAttributeValue(el, "class") ?? "") && cleanText(shownText(el)))
      return el;
  }
  return null;
}

/** The notes a recipe card shows with the recipe, as plain text with paragraphs kept. */
export function cardNotes(doc: Document): string {
  const el = notesElement(doc);
  if (!el) return "";
  return cleanText(shownText(el))
    .replace(/^notes?:?\s*\n/i, "")
    .trim();
}

/** The element showing a list on the page (for saving a trimmed copy of it: import-quality/). */
export function listElement(doc: Document, lines: readonly string[]): Element | null {
  return lines.length < 2 ? null : container(matches(doc, lines), lines.length);
}
