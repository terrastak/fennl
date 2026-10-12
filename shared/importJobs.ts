import type { RecipeDraft } from "./importDraft";

/**
 * Import jobs as the app sees them (phase E4): a draft read on the server (POST /api/import/web
 * for a web page), kept in the account until the person saves it as a recipe or discards it.
 * The same routes serve the Chrome extension (E6).
 */

export const IMPORT_RULES = {
  /** The largest page accepted. Saved pages carry their scripts and styles, so allow plenty. */
  pageBytes: 8 * 1024 * 1024,
  /** The recipe card kept for the review screen; a bigger one isn't kept (the link still is). */
  snapshotBytes: 512 * 1024,
  /** Recipes taken from one page; a page listing more is a collection, not a recipe. */
  recipesPerPage: 20,
  /** Drafts not saved or discarded are removed after this many days. */
  keepDays: 30,
} as const;

/** The page a draft came from. */
export interface ImportPage {
  /** Its address, when known (a saved file may not say). */
  url: string | null;
  /** The page's own title. */
  title: string | null;
}

/** What import_job.provenance holds for a web page. */
export interface WebProvenance {
  page: ImportPage;
  /** The page's recipe card, cleaned of scripts and everything else (shared/pageSnapshot.ts). */
  snapshot: string | null;
  /** The size of the page as sent. */
  bytes: number;
}

/** A draft waiting for review, in a list. */
export interface ImportJobSummary {
  id: string;
  title: string;
  url: string | null;
  createdAt: string;
}

/** GET /api/import/jobs/:id */
export interface ImportJobDetail extends ImportJobSummary {
  status: "ready" | "saved";
  draft: RecipeDraft;
  page: ImportPage;
  snapshot: string | null;
  /** The recipe it became, once saved. */
  recipeId: string | null;
}

/** POST /api/import/web: one job for each recipe on the page. */
export interface ImportWebResponse {
  jobs: ImportJobSummary[];
}

export type ImportWebError =
  | "invalid_request"
  | "import_not_included"
  | "page_too_large"
  | "no_recipe"
  | "rate_limited"
  | "daily_limit";

/**
 * The address a browser recorded in a page saved with "Save Page As" (Chrome and Edge write
 * `<!-- saved from url=(0047)https://... -->` at the top), for a saved file sent without one.
 */
export function savedFromUrl(html: string): string | null {
  const match = /<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i.exec(html.slice(0, 2000));
  return match?.[1] && /^https?:\/\//i.test(match[1]) ? match[1] : null;
}

/** An address a photo may be fetched from for a draft: http(s), a host name, not this app's. */
export function fetchableImageUrl(value: string | null, ownHosts: string[]): URL | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  // Only named hosts on the public web: no addresses written as numbers, no local names.
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|localdomain)$/.test(host)) {
    return null;
  }
  if (ownHosts.some((own) => own && (host === own || host.endsWith(`.${own}`)))) return null;
  return url;
}
