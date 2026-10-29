import { useSyncExternalStore } from "react";
import { clockText } from "../../shared/cook";
import { navigate } from "../navigation";
import { timeLeft, useTimers, type Timer } from "./timers";

// Which part of the Timers panel is showing (U9; as the earlier Fennl had it since 2026-10-29):
// every timer, one timer's time being adjusted, a timer of one's own being added, or the question
// a time in a recipe's step asks before it starts a timer; null when it's closed.

/** A timer a time in a step offers to start (./TimeLink.tsx). */
export interface StartOffer {
  /** Named from the step: "Bake". */
  name: string;
  seconds: number;
  /** A range's other end: "9-11 minutes" offers 9 or 11. */
  upTo?: number;
  recipeTitle: string;
  step: number;
  /** The recipe page at that step, which View step and the alert open. */
  path: string;
}

export type View =
  | { kind: "list" }
  | { kind: "adjust"; id: string; fromList: boolean }
  | { kind: "add" }
  | { kind: "start"; offer: StartOffer };

let view: View | null = null;
const viewListeners = new Set<() => void>();
export const showView = (next: View | null) => {
  view = next;
  for (const listener of viewListeners) listener();
};
export const useView = () =>
  useSyncExternalStore(
    (listener) => {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    () => view,
    () => null,
  );

/** Opens the Timers panel: every timer, and Add timer. */
export const openTimers = () => showView({ kind: "list" });

/** Opens one timer's Adjust time. */
export const openAdjust = (id: string) => showView({ kind: "adjust", id, fromList: false });

/**
 * A step brought into view and gently marked (owner's choice 2026-10-29): a pale tint that fades
 * over about three seconds (`data-flash`, styled with the recipe page's steps), so the eye lands
 * on it. Returns whether the step was there.
 */
export function markStep(id: string): boolean {
  const step = document.getElementById(id);
  if (!step) return false;
  step.scrollIntoView({ block: "center" });
  step.removeAttribute("data-flash");
  // Read the layout, so a second View step on the same step starts the fade again.
  void step.offsetWidth;
  step.setAttribute("data-flash", "");
  setTimeout(() => step.removeAttribute("data-flash"), 3200);
  return true;
}

/**
 * Back to a timer's step: on the recipe page, scrolled to it and marked; in cook mode, that
 * step's screen (./CookMode.tsx reads the address's #step-N).
 */
export function goToStep(path: string): void {
  showView(null);
  // Already on that page: no second history entry for it.
  navigate(path, { replace: path.split("#")[0] === window.location.pathname });
  const id = path.split("#")[1];
  if (!id || path.split("#")[0]?.endsWith("/cook")) return;
  // The recipe page may still be opening: look for the step for a moment.
  let tries = 0;
  const look = () => {
    if (!markStep(id) && ++tries < 40) setTimeout(look, 50);
  };
  look();
}

/** A timer's View step. */
export function viewStep(timer: Timer): void {
  if (timer.path) goToStep(timer.path);
}

/**
 * A timer's notification clicked while Fennl is open (owner's request 2026-10-29): the service
 * worker brings this window forward and says which step to show. Returns the way to stop.
 */
export function listenForShowStep(): () => void {
  const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!worker) return () => {};
  const heard = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; path?: unknown } | null;
    if (data?.type !== "fennl:show-step" || typeof data.path !== "string") return;
    // Only a page of Fennl's own.
    if (!data.path.startsWith("/") || data.path.startsWith("//")) return;
    goToStep(data.path);
  };
  worker.addEventListener("message", heard);
  return () => worker.removeEventListener("message", heard);
}

/** The soonest running timer's time, for the phone's top bar. */
export function useSoonest(): { count: number; text: string | null; ringing: boolean } {
  const { timers, now } = useTimers();
  const running = timers.filter((t) => !t.done && t.pausedLeft === null);
  const soonest = running.reduce<Timer | null>(
    (best, t) => (!best || t.endsAt < best.endsAt ? t : best),
    null,
  );
  return {
    count: timers.length,
    text: soonest ? clockText(timeLeft(soonest, now) / 1000) : null,
    ringing: timers.some((t) => t.done),
  };
}
