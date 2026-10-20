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

// ---------------------------------------------------------------------------------------------
// Looking through the whole library (phase C14)
// ---------------------------------------------------------------------------------------------

/** A recipe in the library, for finding pairs: who owns it matters, since only a person's own are paired. */
export interface PairCandidate extends DuplicateCandidate {
  ownerId: string;
}

/** Two recipes that may be the same one. `a` is the smaller id, so a pair has one spelling. */
export interface DuplicatePair {
  a: string;
  b: string;
  reason: DuplicateReason;
}

/** One spelling for a pair of recipes, whichever way round they were given. */
export const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

export interface PairOptions {
  /** Most pairs to give: the surest first. */
  maxPairs?: number;
  /** A title word in more recipes than this says too little to compare them by. */
  commonWord?: number;
  /** Most recipes one page address is compared across. */
  maxSamePage?: number;
}

const FILLER = new Set(["the", "and", "with", "for", "from"]);

const titleWords = (title: string): string[] => [
  ...new Set(
    title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !FILLER.has(word)),
  ),
];

/**
 * Pairs of recipes in a library that look like the same recipe saved twice: the same page, or a
 * title that reads the same with mostly the same ingredients (the same rule as an import's
 * duplicate check, `findDuplicates`). Only recipes of one owner are paired. To stay quick on a
 * big library it compares recipes only when they share a page address or a title word that isn't
 * in too many recipes, rather than every recipe with every other.
 */
export function findDuplicatePairs(
  library: readonly PairCandidate[],
  { maxPairs = 500, commonWord = 60, maxSamePage = 25 }: PairOptions = {},
): DuplicatePair[] {
  const byOwner = new Map<string, PairCandidate[]>();
  for (const recipe of library) {
    byOwner.set(recipe.ownerId, [...(byOwner.get(recipe.ownerId) ?? []), recipe]);
  }

  const samePage: (DuplicatePair & { score: number })[] = [];
  const similar: (DuplicatePair & { score: number })[] = [];
  const seen = new Set<string>();
  const add = (x: string, y: string, reason: DuplicateReason, score = 0) => {
    const [a, b] = x < y ? [x, y] : [y, x];
    (reason === "same_page" ? samePage : similar).push({ a, b, reason, score });
  };

  for (const recipes of byOwner.values()) {
    const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));

    // The same page.
    const pages = new Map<string, string[]>();
    for (const recipe of recipes) {
      const keys = new Set(recipe.urls.map(pageKey).filter((k): k is string => k !== null));
      for (const key of keys) pages.set(key, [...(pages.get(key) ?? []), recipe.id]);
    }
    for (const ids of pages.values()) {
      if (ids.length < 2 || ids.length > maxSamePage) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i] as string, ids[j] as string);
          if (seen.has(key)) continue;
          seen.add(key);
          add(ids[i] as string, ids[j] as string, "same_page");
        }
      }
    }

    // Titles that share a word.
    const words = new Map<string, string[]>();
    for (const recipe of recipes) {
      for (const word of titleWords(recipe.title)) {
        words.set(word, [...(words.get(word) ?? []), recipe.id]);
      }
    }
    for (const ids of words.values()) {
      if (ids.length < 2 || ids.length > commonWord) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const first = byId.get(ids[i] as string);
          const second = byId.get(ids[j] as string);
          if (!first || !second) continue;
          const key = pairKey(first.id, second.id);
          if (seen.has(key)) continue;
          seen.add(key);
          const title = textScore(first.title, second.title);
          if (title < TITLE_ALIKE) continue;
          const mine = first.ingredients.filter((line) => !line.heading);
          const theirs = second.ingredients.filter((line) => !line.heading);
          if (mine.length === 0 || theirs.length === 0) {
            if (title >= TITLE_SAME) add(first.id, second.id, "similar", title);
            continue;
          }
          const ingredients = linesScore(mine, theirs).score;
          if (ingredients >= INGREDIENTS_ALIKE) {
            add(first.id, second.id, "similar", title + ingredients);
          }
        }
      }
    }
  }

  similar.sort((x, y) => y.score - x.score || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)));
  samePage.sort((x, y) => pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)));
  return [...samePage, ...similar].slice(0, maxPairs).map(({ a, b, reason }) => ({ a, b, reason }));
}

/** A sanity cap on "not a duplicate" answers per account. */
export const MAX_DISMISSALS = 5000;

/** Whether text looks like a recipe's id (they are UUIDs), before it is stored. */
export const isRecipeId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);
