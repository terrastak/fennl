import { useSyncExternalStore } from "react";
import { clockText } from "../../shared/cook";
import { timeLeft, useTimers, type Timer } from "./timers";

// Which part of the Timers window is showing (U9): the list, one timer being changed, or a new
// timer's time being typed; null when it's closed. Any button anywhere can open it.

export type View =
  { kind: "list" } | { kind: "edit"; id: string; fromList: boolean } | { kind: "new" };

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

/** Opens the Timers window: every timer, and a new one. */
export const openTimers = () => showView({ kind: "list" });

/** Opens one timer, to change its time. */
export const openTimer = (id: string) => showView({ kind: "edit", id, fromList: false });

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
