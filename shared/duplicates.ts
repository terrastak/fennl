import { linesScore, textScore } from "./importScore";

/**
 * "This looks like a recipe you already have" (phase E4): before an import is saved, the review
 * screen looks for recipes in the household's library it may duplicate, so the person can save
 * it as new, update the one they have, or not import it.
 *
 * Two signs: the same page (the recipe's source address or the address it was imported from),
 * or a title that reads the same with mostly the same ingredients.
 */

export interface DuplicateQuery {
  title: string;
  /** The addresses the import came from (the page's own, its canonical address). */
  urls: (string | null)[];
  ingredients: string[];
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  /** Addresses the recipe is known by: its source link, and the page it was imported from. */
  urls: (string | null)[];
  ingredients: { text: string; heading: boolean }[];
}

export type DuplicateReason = "same_page" | "similar";

export interface DuplicateMatch {
  id: string;
  reason: DuplicateReason;
}

/** How alike titles must read, and then ingredient lists, for "similar". */
const TITLE_ALIKE = 0.85;
const INGREDIENTS_ALIKE = 0.6;
/** Without ingredients to compare, titles must read the same. */
const TITLE_SAME = 0.97;

/** Query keys that only say how someone got to a page, never which page it is. */
const TRACKING = /^(?:utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|igshid|_ga|cmp|src)$/i;

/**
 * An address in a form two links to the same page share: no "www.", no "http" vs "https", no
 * "#part", no tracking keys, no trailing slash, and query keys in order. Null for a non-address.
 */
export function pageKey(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|amp)\./, "");
  const path = url.pathname.replace(/\/(?:amp\/?)?$/, "").replace(/\/+$/, "") || "/";
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => `${key}=${v}`)
    .join("&");
  return `${host}${path.toLowerCase()}${params ? `?${params}` : ""}`;
}

/** The recipes in `library` the import may duplicate: the same page first, then similar ones. */
export function findDuplicates(
  query: DuplicateQuery,
  library: readonly DuplicateCandidate[],
  limit = 3,
): DuplicateMatch[] {
  const keys = new Set(query.urls.map(pageKey).filter((k): k is string => k !== null));
  const samePage: DuplicateMatch[] = [];
  const similar: { id: string; score: number }[] = [];
  const lines = query.ingredients.map((text) => ({ text, heading: false }));
  for (const recipe of library) {
    if (recipe.urls.some((url) => keys.has(pageKey(url) ?? ""))) {
      samePage.push({ id: recipe.id, reason: "same_page" });
      continue;
    }
    const title = textScore(query.title, recipe.title);
    if (title < TITLE_ALIKE) continue;
    const theirs = recipe.ingredients.filter((l) => !l.heading);
    if (lines.length === 0 || theirs.length === 0) {
      if (title >= TITLE_SAME) similar.push({ id: recipe.id, score: title });
      continue;
    }
    const ingredients = linesScore(lines, theirs).score;
    if (ingredients >= INGREDIENTS_ALIKE) {
      similar.push({ id: recipe.id, score: title + ingredients });
    }
  }
  similar.sort((a, b) => b.score - a.score);
  return [...samePage, ...similar.map(({ id }) => ({ id, reason: "similar" as const }))].slice(
    0,
    limit,
  );
}
