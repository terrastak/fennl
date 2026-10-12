import type { Tier } from "./entitlements";

/**
 * The Chrome extension's connection to an account (phase E5), shared by the server, the app's
 * connect page and Settings, and the extension itself (extension/).
 */

export const EXTENSION_RULES = {
  /** A key nobody has used for this many days stops working. */
  unusedDays: 90,
  /** Extensions connected to one account at once. */
  maxLinks: 10,
  /** Every key starts with this, so one is easy to recognise (and to search for if leaked). */
  keyPrefix: "fnx_",
} as const;

/** How the connect page hands the key to the extension's script on that page. */
export const CONNECT_MESSAGE = "fennl-extension-connect";
/** The extension's answer once it has kept the key. */
export const CONNECTED_MESSAGE = "fennl-extension-connected";
/** Where the extension opens Fennl to connect. */
export const CONNECT_PATH = "/connect-extension";

/** A connected extension, as Settings lists it. */
export interface ExtensionLinkSummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
}

/** POST /api/extension/links: the new key, shown once and handed to the extension. */
export interface ExtensionLinkCreated {
  id: string;
  key: string;
}

/** GET /api/extension/me: who the extension is connected to, and what it may import. */
export interface ExtensionMe {
  name: string;
  email: string;
  tier: Tier;
  /** Pages with recipe data (import_structured_enabled). Off: "Premium required". */
  importPages: boolean;
  /** Pages and photos read by the AI (import_ai_enabled, phase E8). */
  importWithAi: boolean;
  /** The page's photos are kept (images_enabled). */
  photos: boolean;
}

export function isExtensionKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(EXTENSION_RULES.keyPrefix) &&
    /^[A-Za-z0-9_-]{40,100}$/.test(value)
  );
}
