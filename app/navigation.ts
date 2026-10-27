import { useSyncExternalStore } from "react";

/**
 * A deliberately tiny client-side router: the app has a handful of fixed pages for now.
 * Swap for a full router when pages gain parameters (recipe IDs in Stage C).
 */
export const NAVIGATE_EVENT = "fennl:navigate";

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

const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * Something on the page that mustn't be lost by leaving it (U7: a note being written). While
 * it's set, leaving the page asks first: `onLeave` is told where to, and goes there itself
 * (navigate with `force`) once the person has chosen. Closing or reloading the tab gets the
 * browser's own question.
 */
let guard: { path: string; onLeave: (to: string) => void } | null = null;

const warnBeforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  // Older browsers ask only when this is set.
  event.returnValue = "";
};

/** Asks before leaving this page; returns the function that stops asking. */
export function guardLeaving(onLeave: (to: string) => void): () => void {
  const mine = { path: here(), onLeave };
  guard = mine;
  window.addEventListener("beforeunload", warnBeforeUnload);
  return () => {
    if (guard !== mine) return;
    guard = null;
    window.removeEventListener("beforeunload", warnBeforeUnload);
  };
}

// Back and forward: the address has changed already, so it's put back while the person chooses.
// Added before any page listens, so pages never see the address they didn't go to.
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (!guard || here() === guard.path) return;
    const to = here();
    window.history.pushState(null, "", guard.path);
    guard.onLeave(to);
  });
}

/**
 * Switches page without reloading. `replace` swaps the current history entry (for redirects);
 * `force` leaves without asking (guardLeaving).
 */
export function navigate(to: string, options: { replace?: boolean; force?: boolean } = {}): void {
  if (to === here()) return;
  if (guard && !options.force && guard.path === here()) {
    guard.onLeave(to);
    return;
  }
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
