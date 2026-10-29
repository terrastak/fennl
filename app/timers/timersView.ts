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

/** Back to a recipe at the step that started a timer (on its page, scrolled to that step). */
export function viewStep(timer: Timer): void {
  if (!timer.path) return;
  showView(null);
  navigate(timer.path);
  const id = timer.path.split("#")[1];
  if (!id) return;
  // The recipe page may still be opening: look for the step for a moment.
  let tries = 0;
  const look = () => {
    const step = document.getElementById(id);
    if (step) step.scrollIntoView({ block: "center" });
    else if (++tries < 40) setTimeout(look, 50);
  };
  look();
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
