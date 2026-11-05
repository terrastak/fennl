import { useSyncExternalStore } from "react";

const WIDE = "(min-width: 900px)";

/** Whether the screen is wide enough for the computer layout, with the left panel. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}
