import type { AnyNode, Document, Element } from "domhandler";
import { getAttributeValue, textContent } from "domutils";
import { parseDocument } from "htmlparser2";
import { draftContent } from "./importDraft";
import { cardElement, listElement, notesElement } from "./recipeCard";
import { elements } from "./schemaRecipe";
import { readWebRecipes } from "./webRecipe";

/**
 * The recipe card a web page shows, copied without anything that could run or track (phases E3
 * and E4). Two uses:
 *
 * - The quality test set (import-quality/) keeps a trimmed copy of each page (`trimPage`). The
 *   test set is public (decided 2026-10-10), so a saved page keeps only what the importer reads:
 *   the page's recipe data, its address, name and sharing image, and the recipe card as shown.
 * - The import review screen (E4) shows the person the recipe card next to the draft
 *   (`recipeCardHtml`).
 *
 * The site's articles, photos, adverts, scripts and styles are always left out.
 */

/** Head elements the importer reads. */
const HEAD_META =
  /^(?:og:site_name|og:url|og:title|og:image(?::url|:secure_url|:width)?|twitter:image)$/i;

/** Kept attributes: what says where the recipe is, what's hidden, and microdata. */
const KEEP_ATTRIBUTES = new Set([
  "class",
  "id",
  "itemprop",
  "itemscope",
  "itemtype",
  "content",
  "datetime",
  "hidden",
  "aria-hidden",
]);

/** Elements dropped from the kept recipe card: scripts, styles, pictures, forms. */
const DROP =
  /^(?:script|style|noscript|template|svg|iframe|button|select|input|textarea|picture|video|audio|source|canvas|link|meta)$/;

/** Data some sites add to their recipe data that the importer doesn't read: the article, reviews. */
const ARTICLE_KEYS = new Set(["articleBody", "review", "reviews", "comment", "comments"]);

/** The page's JSON-LD without the article text and reviews (the rest as the site wrote it). */
function withoutArticles(json: string): string {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return json.trim();
  }
  const prune = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(prune);
    if (typeof v !== "object" || v === null) return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([key]) => !ARTICLE_KEYS.has(key))
        .map(([key, item]) => [key, prune(item)]),
    );
  };
  return JSON.stringify(prune(value)).replace(/</g, "\\u003c");
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Microdata properties the importer doesn't read, which can hold people's reviews. */
const SKIP_PROPS = /^(?:review|reviews|comment|comments)$/i;

function hasItemprop(node: AnyNode): boolean {
  if (node.type !== "tag") return false;
  if (getAttributeValue(node, "itemprop") || getAttributeValue(node, "itemscope") !== undefined)
    return true;
  return node.children.some(hasItemprop);
}

/**
 * A copy of an element with only what the importer reads. In a microdata recipe, which can span
 * a whole page, only the properties are kept: the text between them (articles, comments) goes.
 */
function cleaned(el: Element, microdata = false): string {
  const walk = (node: AnyNode, insideProp: boolean): string => {
    if (node.type === "text")
      return insideProp || !microdata ? esc(node.data).replace(/\s+/g, " ") : "";
    if (node.type !== "tag") return "";
    const prop = getAttributeValue(node, "itemprop") ?? "";
    if (microdata && SKIP_PROPS.test(prop)) return "";
    if (microdata && !insideProp && !hasItemprop(node)) return "";
    const isProp =
      insideProp || (prop !== "" && getAttributeValue(node, "itemscope") === undefined);
    if (DROP.test(node.name)) return "";
    if (node.name === "img" && !getAttributeValue(node, "itemprop")) return "";
    const attrs: string[] = [];
    for (const [name, value] of Object.entries(node.attribs)) {
      const microdataLink =
        (name === "src" || name === "href") && getAttributeValue(node, "itemprop");
      if (KEEP_ATTRIBUTES.has(name) || microdataLink) {
        attrs.push(value === "" ? name : `${name}="${esc(value)}"`);
      } else if (name === "style" && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(value)) {
        attrs.push('style="display: none"');
      } else if (name === "style" && /display\s*:\s*block/i.test(value)) {
        attrs.push('style="display: block"');
      }
    }
    const open = `<${node.name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
    if (/^(?:br|hr|img|wbr)$/.test(node.name)) return open;
    return `${open}${node.children.map((child) => walk(child, isProp)).join("")}</${node.name}>`;
  };
  return walk(el, false);
}

function isInside(el: Element, ancestor: Element): boolean {
  for (let p = el.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/** The smallest element holding all of them. */
function commonAncestor(els: Element[]): Element | null {
  const [first, ...rest] = els;
  if (!first) return null;
  for (let a: Element | null = first; a; a = a.parent?.type === "tag" ? a.parent : null) {
    if (rest.every((el) => el === a || isInside(el, a as Element))) return a;
  }
  return null;
}

function isMicrodataRecipe(el: Element): boolean {
  return /schema\.org\/Recipe\b/i.test(getAttributeValue(el, "itemtype") ?? "");
}

/** The parts of the page showing the recipe: the lists, the notes, a microdata recipe. */
function recipeParts(doc: Document, html: string, url: string | null): Element[] {
  const parts: Element[] = [];
  for (const draft of readWebRecipes(html, url)) {
    const content = draftContent(draft);
    const lists: Element[] = [];
    for (const list of [content.ingredients, content.directions]) {
      const el = listElement(
        doc,
        list.filter((l) => !l.heading).map((l) => l.text),
      );
      if (el) lists.push(el);
    }
    // The whole recipe card when it's small enough: its notes and yield are read from it.
    const card = cardElement(lists);
    parts.push(...(card ? [card] : lists));
  }
  const notes = notesElement(doc);
  if (notes) parts.push(notes);
  for (const el of elements(doc)) {
    if (isMicrodataRecipe(el)) parts.push(el);
  }
  // The card holding them all, unless that's most of the page (then each part on its own).
  const together = commonAncestor(parts);
  const size = (el: Element) => textContent(el).length;
  const partsSize = parts.reduce((sum, el) => sum + size(el), 0);
  if (together && size(together) <= partsSize * 1.5 + 3000) return [together];
  return parts.filter((el) => !parts.some((other) => other !== el && isInside(el, other)));
}

function cardParts(doc: Document, html: string, url: string | null): string[] {
  return recipeParts(doc, html, url).map((el) =>
    cleaned(el, isMicrodataRecipe(el) || [...elements(el)].some(isMicrodataRecipe)),
  );
}

/**
 * The page's recipe card as HTML: only text and structure, with classes and hidden parts kept
 * (no scripts, styles, pictures, links or forms). Empty when the page shows no card the importer
 * found.
 */
export function recipeCardHtml(html: string, url: string | null): string {
  return cardParts(parseDocument(html), html, url).join("\n");
}

/** The trimmed page, as HTML. `source` says where and when it was saved. */
export function trimPage(html: string, url: string | null, source: string): string {
  const doc = parseDocument(html);
  const head: string[] = [];
  for (const el of elements(doc)) {
    if (el.name === "title" && head.every((h) => !h.startsWith("<title>"))) {
      head.push(`<title>${esc(textContent(el).trim())}</title>`);
    } else if (el.name === "link" && /\bcanonical\b/i.test(getAttributeValue(el, "rel") ?? "")) {
      head.push(`<link rel="canonical" href="${esc(getAttributeValue(el, "href") ?? "")}">`);
    } else if (el.name === "meta") {
      const name = getAttributeValue(el, "property") ?? getAttributeValue(el, "name") ?? "";
      if (HEAD_META.test(name)) {
        head.push(
          `<meta property="${esc(name)}" content="${esc(getAttributeValue(el, "content") ?? "")}">`,
        );
      }
    } else if (el.name === "script" && /ld\+json/i.test(getAttributeValue(el, "type") ?? "")) {
      head.push(`<script type="application/ld+json">${withoutArticles(textContent(el))}</script>`);
    }
  }
  const body = cardParts(doc, html, url);
  return [
    "<!doctype html>",
    `<!-- A trimmed copy of a recipe page for Fennl's import tests: the recipe data and recipe card only. ${source} -->`,
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    ...head,
    "</head>",
    "<body>",
    ...body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
