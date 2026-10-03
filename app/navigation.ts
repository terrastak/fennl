import { useSyncExternalStore } from "react";

/**
 * A deliberately tiny client-side router: the app has a handful of fixed pages for now.
 * Swap for a full router when pages gain parameters (recipe IDs in Stage C).
 */
const NAVIGATE_EVENT = "fennl:navigate";

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
