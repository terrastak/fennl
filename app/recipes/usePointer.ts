import { useSyncExternalStore } from "react";

/** A laptop or desktop with a mouse or trackpad (U23): the same query as tokens.css. */
export const POINTER = "(min-width: 900px) and (pointer: fine)";

/** Whether the laptop look applies, so words can say "click" there and "tap" elsewhere. */
export function usePointer(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(POINTER);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(POINTER).matches,
    () => false,
  );
}
