import { useSyncExternalStore } from "react";

/**
 * A deliberately tiny client-side router: the app has a handful of fixed pages for now.
 * Swap for a full router when pages gain parameters (recipe IDs in Stage C).
 */
export const NAVIGATE_EVENT = "fennl:navigate";

/**
 * A page changed its own address in place (the recipe list's search and filters), without
 * switching page; for anything that shows what the address says, like the sidebar's categories.
 */
export const ADDRESS_EVENT = "fennl:address";

/** Swaps the address for `to` in place, and says so (ADDRESS_EVENT). */
export function replaceAddress(to: string): void {
  window.history.replaceState(null, "", to);
  window.dispatchEvent(new Event(ADDRESS_EVENT));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

export function usePath(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => "/",
  );
}

/** Switches page without reloading. `replace` swaps the current history entry (for redirects). */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === `${window.location.pathname}${window.location.search}`) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** One value from the address's query string, read when a page opens. */
export function queryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Where to go after signing in: the page someone was sent to sign in from (?next=, set by the
 * app), only ever a path on this site, else the recipes.
 */
export function afterSignIn(): string {
  const next = queryParam("next");
  return next && /^\/(?![/\\])/.test(next) ? next : "/";
}
