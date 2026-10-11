import type { Document } from "domhandler";
import { getAttributeValue } from "domutils";
import { elements, isObject, list } from "./schemaRecipe";

/**
 * The photos a recipe page offers (phase E3): the recipe's own images from its structured data,
 * then the page's sharing image. The same photo in several sizes or crops counts once, in its
 * largest size. Up to three are kept; the first is the cover.
 */

export const MAX_WEB_PHOTOS = 3;

interface Candidate {
  url: string;
  width: number;
}

/** The width assumed for an address that doesn't say: the original upload. */
const ORIGINAL = 100_000;

/** The address of an image value: a string, an ImageObject, or a list of either. */
function imageUrls(value: unknown): { url: string; width: number | null }[] {
  return list(value).flatMap((item) => {
    if (typeof item === "string") return [{ url: item, width: null }];
    if (!isObject(item)) return [];
    const url = item.contentUrl ?? item.url;
    if (typeof url !== "string") return [];
    const width = Number(item.width);
    return [{ url, width: Number.isFinite(width) && width > 0 ? width : null }];
  });
}

/** An absolute address for what a page links to, or null for anything but http(s). */
export function absoluteUrl(href: string, base: string | null): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    const url = base
      ? new URL(trimmed, base)
      : new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Which photo an address shows, ignoring size and crop: "dish-1200x800.jpg", "dish-scaled.jpg"
 * and ".../16:9/w_2000/dish.jpg" are all "dish". Sites change the folders and query for each size.
 */
function photoKey(url: string): string {
  const { hostname, pathname } = new URL(url);
  const parts = pathname.split("/").map((p) => decodeURIComponent(p).toLowerCase());
  let file = (parts.pop() ?? "")
    .replace(/\.(?:jpe?g|png|webp|avif|gif)$/, "")
    .replace(/-(?:\d+x\d+|scaled|e\d{10,})$/, "")
    .replace(/-(?:\d+x\d+|scaled)$/, "");
  // A folder per photo, each size named after it: ".../dish-ab12/dish-ab12-superJumbo.jpg".
  const folder = parts.at(-1);
  if (folder && folder.length >= 6 && file.startsWith(`${folder}-`)) file = folder;
  return `${hostname.replace(/^www\./, "")}/${file}`;
}

/** The width an address asks for, when it says: "-1200x800.jpg", "w_2000", "?w=1200", "1200:*". */
function widthInUrl(url: string): number | null {
  const match =
    /-(\d{3,4})x\d{3,4}\.\w+$/.exec(url) ??
    /[/,]w_(\d{3,4})\b/.exec(url) ??
    /[?&](?:w|width|resize)=(\d{3,4})\b/.exec(url) ??
    /resize=(\d{3,4}):/.exec(url);
  return match?.[1] ? Number(match[1]) : null;
}

/** Placeholders sites show when a recipe has no photo. */
const PLACEHOLDER = /placeholder|no[-_]?image|default[-_]?(?:image|recipe)/i;

/** Up to three photos for the recipe, the cover first, as absolute addresses. */
export function recipePhotos(
  recipe: Record<string, unknown>,
  doc: Document,
  base: string | null,
): string[] {
  const candidates: Candidate[] = [];
  const add = (href: string, width: number | null, unsized: number) => {
    const url = absoluteUrl(href, base);
    if (!url || PLACEHOLDER.test(url)) return;
    candidates.push({ url, width: width ?? widthInUrl(url) ?? unsized });
  };
  // A recipe image with no size in its address is usually the original, larger than any sized
  // copy; a sharing image is usually a crop made for social media.
  for (const image of imageUrls(recipe.image)) add(image.url, image.width, ORIGINAL);
  for (const el of elements(doc)) {
    if (el.name !== "meta") continue;
    const name = getAttributeValue(el, "property") ?? getAttributeValue(el, "name") ?? "";
    if (/^(?:og:image(?::url|:secure_url)?|twitter:image)$/i.test(name)) {
      add(getAttributeValue(el, "content") ?? "", null, 0);
    }
  }
  const groups = new Map<string, Candidate>();
  const order: string[] = [];
  for (const candidate of candidates) {
    const groupKey = photoKey(candidate.url);
    const best = groups.get(groupKey);
    if (!best) {
      groups.set(groupKey, candidate);
      order.push(groupKey);
    } else if (candidate.width > best.width) {
      groups.set(groupKey, candidate);
    }
  }
  return order.slice(0, MAX_WEB_PHOTOS).map((k) => (groups.get(k) as Candidate).url);
}
