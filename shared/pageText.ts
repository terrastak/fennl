import type { AnyNode, Document, Element } from "domhandler";
import { getAttributeValue, removeElement, textContent } from "domutils";
import { parseDocument } from "htmlparser2";
import { cleanedHtml } from "./pageSnapshot";
import { elements } from "./schemaRecipe";

/**
 * A web page without recipe data, made ready for the AI to read (phase E8): its readable text,
 * with headings and lists kept, without what isn't the article (menus, comments, share buttons,
 * adverts, newsletters, related posts); a few photos that may be the dish's; and a copy for the
 * review screen to show beside the draft. Reads only the HTML it's given; never fetches.
 */

export interface PageForAi {
  /** The page's title, as its sharing data or <title> gives it. */
  title: string | null;
  /** The site's name, as its sharing data gives it. */
  site: string | null;
  /** The article as text: "## " starts a heading, "- " a list item. Empty when there's none. */
  text: string;
  /** Whether the text was cut to PAGE_TEXT_CHARS. */
  cut: boolean;
  /** Up to MAX_PAGE_PHOTOS addresses: the page's sharing image first, then the article's. */
  photos: string[];
  /** The article as plain HTML (no scripts, styles, pictures, links or forms), for review. */
  snapshot: string;
}

/** About 15,000 tokens: far past any recipe, and a cap on what one page costs to read. */
export const PAGE_TEXT_CHARS = 60_000;

export const MAX_PAGE_PHOTOS = 3;

/** Never the article: dropped wherever they are. */
const DROP_TAGS =
  /^(?:script|style|noscript|template|svg|iframe|form|button|select|input|textarea|video|audio|canvas|object|embed|link|meta|dialog)$/;

/** Not the article when found outside it, or when no article is marked. */
const PAGE_CHROME = /^(?:nav|header|footer|aside)$/;

/** Class and ID words that mark what isn't the recipe. */
const NOT_CONTENT = new Set([
  "comment",
  "comments",
  "respond",
  "replies",
  "share",
  "sharing",
  "social",
  "newsletter",
  "subscribe",
  "subscription",
  "sidebar",
  "widget",
  "related",
  "recommended",
  "advert",
  "advertisement",
  "ad",
  "ads",
  "adsense",
  "promo",
  "sponsored",
  "cookie",
  "consent",
  "popup",
  "modal",
  "breadcrumb",
  "breadcrumbs",
  "menu",
  "nav",
  "navigation",
  "jump",
  "skip",
]);

const BLOCK =
  /^(?:p|div|section|article|main|ul|ol|li|h[1-6]|table|tr|blockquote|pre|figure|figcaption|dl|dt|dd|header|footer|br|hr)$/;

function words(el: Element): string[] {
  return `${getAttributeValue(el, "class") ?? ""} ${getAttributeValue(el, "id") ?? ""}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

const hidden = (el: Element) =>
  getAttributeValue(el, "hidden") !== undefined ||
  getAttributeValue(el, "aria-hidden") === "true" ||
  /display\s*:\s*none|visibility\s*:\s*hidden/i.test(getAttributeValue(el, "style") ?? "");

/**
 * Removes, below `root`, everything that isn't the article. A class or ID word alone never removes
 * most of the article: some sites wrap the whole recipe in a box named for its adverts
 * ("fixed-ad-container").
 */
function prune(root: Element | Document, dropChrome: boolean): void {
  const doomed: Element[] = [];
  const articleText = textContent(root).length;
  const walk = (node: AnyNode) => {
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return;
    const el = node as Element;
    if (
      DROP_TAGS.test(el.name) ||
      (dropChrome && PAGE_CHROME.test(el.name)) ||
      hidden(el) ||
      (words(el).some((w) => NOT_CONTENT.has(w)) && textContent(el).length * 2 < articleText)
    ) {
      doomed.push(el);
      return;
    }
    el.children.forEach(walk);
  };
  root.children.forEach(walk);
  for (const el of doomed) removeElement(el);
}

/** The page's article: its <main> or <article> (the longest, on a page of several), else <body>. */
function article(doc: Document): { el: Element | Document; marked: boolean } {
  const candidates = [...elements(doc)].filter(
    (el) => el.name === "main" || el.name === "article" || getAttributeValue(el, "role") === "main",
  );
  const best = candidates.sort((a, b) => textContent(b).length - textContent(a).length)[0];
  if (best) return { el: best, marked: true };
  const body = [...elements(doc)].find((el) => el.name === "body");
  return { el: body ?? doc, marked: false };
}

/** Text with headings ("## ") and list items ("- "), a line each, blank lines between blocks. */
function asText(root: Element | Document): string {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    const t = line.replace(/\s+/g, " ").trim();
    if (t) out.push(t);
    line = "";
  };
  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      line += node.data;
      return;
    }
    if (node.type !== "tag") return;
    const el = node as Element;
    if (!BLOCK.test(el.name)) {
      el.children.forEach(walk);
      if (el.name === "td" || el.name === "th") line += " | ";
      return;
    }
    flush();
    if (/^h[1-6]$/.test(el.name)) line = "## ";
    else if (el.name === "li") line = "- ";
    el.children.forEach(walk);
    flush();
  };
  walk(root as AnyNode);
  return out
    .filter((l) => l !== "##" && l !== "-")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function meta(doc: Document, names: string[]): string | null {
  for (const el of elements(doc)) {
    if (el.name !== "meta") continue;
    const name = (
      getAttributeValue(el, "property") ??
      getAttributeValue(el, "name") ??
      ""
    ).toLowerCase();
    if (names.includes(name)) {
      const content = getAttributeValue(el, "content")?.trim();
      if (content) return content;
    }
  }
  return null;
}

function absolute(src: string | null | undefined, base: string | null): string | null {
  if (!src || /^data:/i.test(src.trim())) return null;
  try {
    const url = new URL(src.trim(), base ?? undefined);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The address an <img> shows, including lazy-loaded ones (the first of a srcset). */
function imageSource(el: Element): string | null {
  const direct =
    getAttributeValue(el, "data-src") ??
    getAttributeValue(el, "data-lazy-src") ??
    getAttributeValue(el, "src");
  if (direct && !/^data:/i.test(direct)) return direct;
  const set = getAttributeValue(el, "data-srcset") ?? getAttributeValue(el, "srcset");
  return set?.split(",")[0]?.trim().split(/\s+/)[0] ?? null;
}

/** Icons, avatars and tracking pixels say so in their size. */
function smallImage(el: Element): boolean {
  const size = (name: string) => Number(getAttributeValue(el, name) ?? NaN);
  const w = size("width");
  const h = size("height");
  return (Number.isFinite(w) && w < 300) || (Number.isFinite(h) && h < 200);
}

export function pageForAi(html: string, url: string | null): PageForAi {
  const doc = parseDocument(html);
  const titleEl = [...elements(doc)].find((el) => el.name === "title");
  const title =
    meta(doc, ["og:title", "twitter:title"]) ??
    (titleEl ? textContent(titleEl).trim() || null : null);
  const site = meta(doc, ["og:site_name", "application-name"]);
  const sharing = absolute(
    meta(doc, ["og:image", "og:image:url", "og:image:secure_url", "twitter:image"]),
    url,
  );

  const { el: root, marked } = article(doc);
  prune(root, !marked);

  const photos: string[] = sharing ? [sharing] : [];
  for (const el of elements(root)) {
    if (photos.length >= MAX_PAGE_PHOTOS) break;
    if (el.name !== "img" || smallImage(el)) continue;
    const src = absolute(imageSource(el), url);
    if (src && !/\.svg(?:$|\?)/i.test(src) && !photos.includes(src)) photos.push(src);
  }

  const full = asText(root);
  const cut = full.length > PAGE_TEXT_CHARS;
  const snapshot = root.type === "root" ? "" : cleanedHtml(root as Element);
  return {
    title,
    site,
    text: cut ? full.slice(0, PAGE_TEXT_CHARS) : full,
    cut,
    photos,
    snapshot,
  };
}
