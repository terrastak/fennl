/**
 * Things that happened on an account that no other table keeps (U15; the `account_event` table):
 * the admin console's account page shows them in "What happened" and uses them for its findings.
 * Kept 90 days, then removed by the hourly job. Never anything a person typed (no address, no
 * password), and never written while an admin acts as the person.
 */
import type { LimitKey } from "./entitlements";

/** How long account events are kept. */
export const ACCOUNT_EVENT_DAYS = 90;

export const ACCOUNT_EVENT_KINDS = [
  "limit_refused",
  "sign_in_failed",
  "signed_in",
  "device_taken_over",
  "import_failed",
] as const;
export type AccountEventKind = (typeof ACCOUNT_EVENT_KINDS)[number];

/**
 * What a refusal was about: a limit (LimitKey), or a part of the plan that isn't included at all
 * (photos, imports without the AI, imports read by the AI).
 */
export type RefusedLimit =
  LimitKey | "images_enabled" | "import_structured_enabled" | "import_ai_enabled";

/**
 * What the person tried to do: add a recipe, put one back from Trash, import (a draft saved, a
 * Paprika file, a web page), add a photo, have the AI read something, or use another device.
 */
export const REFUSED_WHATS = [
  "recipe",
  "restore",
  "import",
  "photo",
  "ai_import",
  "device",
] as const;
export type RefusedWhat = (typeof REFUSED_WHATS)[number];

export function isRefusedWhat(value: unknown): value is RefusedWhat {
  return typeof value === "string" && (REFUSED_WHATS as readonly string[]).includes(value);
}

/** Something refused because of a limit. At most one per person per limit per hour. */
export interface LimitRefusedDetails {
  limit: RefusedLimit;
  what: RefusedWhat;
  /** How much was used, and the limit, when known (counts or bytes). */
  used?: number;
  max?: number | null;
  /** Refused by the server, or stopped by the app before sending (and checked by the server). */
  origin: "server" | "app";
  /**
   * New recipes sync turned away (they wait in the device's outbox and are sent again), so the
   * same recipe sent again isn't kept as another refusal.
   */
  recipeIds?: string[];
}

/**
 * A sign-in with a wrong password, against the account whose address was typed: only the browser
 * ("Safari on iPhone"). `hasPassword` false: the account signs in only with Google or Apple.
 */
export interface SignInFailedDetails {
  browser: string;
  hasPassword: boolean;
}

/** A sign-in: the browser and how ("credential" for email and password, "google", "apple"...). */
export interface SignedInDetails {
  browser: string;
  method: string;
}

/** A device signed out because another took over (Free's one device): which, and by which. */
export interface DeviceTakenOverDetails {
  browser: string;
  by: string;
}

/** An import that gave no draft for a reason other than a limit. */
export interface ImportFailedDetails {
  /** Where from: "web", "photos", "pdf", "text", "document"... */
  source: string;
  /** The error code the import answered with ("no_recipe", "ai_unavailable", ...). */
  reason: string;
}

export interface AccountEventDetailsByKind {
  limit_refused: LimitRefusedDetails;
  sign_in_failed: SignInFailedDetails;
  signed_in: SignedInDetails;
  device_taken_over: DeviceTakenOverDetails;
  import_failed: ImportFailedDetails;
}

/** One account event, as the admin console's records hold it. Times are ms since 1970. */
export type AccountEvent = {
  [K in AccountEventKind]: {
    id: string;
    kind: K;
    details: AccountEventDetailsByKind[K];
    at: number;
  };
}[AccountEventKind];

export function isAccountEventKind(value: unknown): value is AccountEventKind {
  return typeof value === "string" && (ACCOUNT_EVENT_KINDS as readonly string[]).includes(value);
}

/** A stored row as an AccountEvent, or null for one of a kind this code doesn't know. */
export function parseAccountEvent(row: {
  id: string;
  kind: string;
  details: string;
  at: number;
}): AccountEvent | null {
  if (!isAccountEventKind(row.kind)) return null;
  let details: unknown;
  try {
    details = JSON.parse(row.details);
  } catch {
    return null;
  }
  if (!details || typeof details !== "object") return null;
  return { id: row.id, kind: row.kind, details, at: row.at } as AccountEvent;
}
