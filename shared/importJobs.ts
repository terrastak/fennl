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
  /** Read by the AI (phase E7): whether "Read again" is still on offer, or has been used. */
  ai: { canReadAgain: boolean; readAgain: boolean } | null;
}

/** Something the AI read, kept so "Read again" can read it again (phase E7). */
export type AiPartRecord =
  /** A photo or PDF, kept in R2 (IMAGES) under importPhotoKey. */
  | {
      kind: "image";
      mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      key: string;
      label: string;
    }
  | { kind: "pdf"; key: string; label: string }
  | { kind: "text"; text: string; label: string };

/**
 * What import_job.provenance holds for a recipe the AI read (phase E7): which models read it, so
 * "Read again" uses the next stronger one, once (decided 2026-10-12).
 */
export interface AiProvenance {
  ai: {
    /** The models that read it, in order: the first, any second look, a re-read. */
    models: string[];
    /** Which model, in the configured order (cheapest first), the draft's answer is from. */
    level: number;
    /** Why the first read got a second look; empty when it didn't. */
    secondLook: string[];
    /** When "Read again" was used; it can be used once. */
    rereadAt: string | null;
    /** Which of the recipes found in what was read this is (a card can hold two). */
    index: number;
    parts: AiPartRecord[];
  };
}

/** Why "Read again" didn't happen. */
export type ReadAgainError =
  | "not_found"
  | "already_read_again"
  /** No stronger model is set up to read it. */
  | "none_stronger"
  | "import_not_included"
  /** This month's AI imports are used up. */
  | "monthly_limit"
  /** AI imports are paused for now. */
  | "paused"
  /** AI reading isn't available on this server (no key), or the read failed. */
  | "unavailable"
  /** The photos aren't kept any more. */
  | "inputs_gone";

/** A draft's photo: which of its inputs, and where the page had it. */
export interface ImportPhotoSource {
  input: number;
  url: string;
}

/**
 * POST /api/import/web: one job for each recipe on the page, with the photos it would keep, so
 * the Chrome extension can bring them from the browser (some sites refuse photo downloads from
 * servers; phase E6).
 */
export interface ImportWebResponse {
  jobs: (ImportJobSummary & { photos: ImportPhotoSource[] })[];
}

/** Where a photo the extension brought waits until the draft is saved or removed (R2, IMAGES). */
export const importPhotoKey = (jobId: string, input: number) => `imports/${jobId}/${input}`;
export const IMPORT_PHOTO_PREFIX = "imports/";

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
