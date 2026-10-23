import { useEffect, useState } from "react";

// Keeping the screen on in cook mode (phase F5, spec.md item 1b): asked for as cook mode opens,
// asked again whenever the page comes back (the browser lets go when someone switches app or
// tab), and let go when cook mode closes. Never fails silently: the state says what happened.

export type WakeState = "on" | "off" | "unsupported" | "refused";

interface Sentinel {
  release(): Promise<void>;
  released: boolean;
  addEventListener(type: "release", listener: () => void): void;
}

const KEY = "fennl:cook-screen-on";

/** Whether the person wants the screen kept on (yes unless they turned it off). */
export function wantedOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setWantedOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Kept for this visit only.
  }
}

export function useWakeLock(wanted: boolean): WakeState {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  // What the browser last said, while the screen is wanted on.
  const [state, setState] = useState<"on" | "refused" | null>(null);

  useEffect(() => {
    if (!supported || !wanted) return;
    let sentinel: Sentinel | null = null;
    let closed = false;
    const request = async () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const lock = navigator as unknown as {
          wakeLock: { request(type: "screen"): Promise<Sentinel> };
        };
        sentinel = await lock.wakeLock.request("screen");
        if (closed) {
          void sentinel.release();
          return;
        }
        setState("on");
        sentinel.addEventListener("release", () => {
          if (!closed && document.visibilityState === "visible") setState("refused");
        });
      } catch {
        if (!closed) setState("refused");
      }
    };
    const onVisible = () => void request();
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      setState(null);
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [supported, wanted]);

  if (!supported) return "unsupported";
  if (!wanted) return "off";
  return state ?? "off";
}
