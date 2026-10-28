import { useEffect, useSyncExternalStore } from "react";

// Timers (phase F5; anywhere in the app since U9, owner's choices 2026-10-28): several at once,
// started from a time in a recipe's step or on their own, kept on this device only (so a reload
// or another page doesn't lose them) and counted from when they end, so a phone that slept or a
// tab in the background still shows the right time when it comes back. A timer can be paused,
// and its time changed. A finished timer rings
// (a short tone and a buzz where the device can), and, when Fennl isn't on screen and the person
// allowed it, shows a notification. A countdown on the lock screen isn't possible from a web
// app (spec.md F5 item 4b).

export interface Timer {
  id: string;
  /** What it's for: "Bake 25 to 30 minutes", or the name someone gave it. */
  label: string;
  /** The recipe whose step started it; null for a timer of the person's own. */
  recipeTitle: string | null;
  seconds: number;
  /** When it ends, in milliseconds since 1970 (while it runs). */
  endsAt: number;
  /** Paused: how long it has left, in milliseconds; null while it runs. */
  pausedLeft: number | null;
  /** Rung, and waiting to be dismissed. */
  done: boolean;
}

const KEY = "fennl:cook-timers";
let timers: Timer[] = load();
const listeners = new Set<() => void>();
let audio: AudioContext | null = null;
let clock = Date.now();
let ticking: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function load(): Timer[] {
  try {
    const text = localStorage.getItem(KEY);
    const value = text ? (JSON.parse(text) as unknown) : [];
    // Timers saved before pausing existed have no pausedLeft.
    return Array.isArray(value)
      ? (value as Timer[]).map((t) => ({ ...t, pausedLeft: t.pausedLeft ?? null }))
      : [];
  } catch {
    return [];
  }
}

function set(next: Timer[]): void {
  timers = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
  for (const listener of listeners) listener();
  // The clock may have stood still while nothing ran: bring it up to now with the change.
  clock = Date.now();
  for (const listener of clockListeners) listener();
}

/** Made from a tap, so the browser lets a timer make a sound later. */
function allowSound(): void {
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    audio ??= Context ? new Context() : null;
    void audio?.resume();
  } catch {
    audio = null;
  }
}

const change = (id: string, update: (timer: Timer, now: number) => Timer) => {
  const now = Date.now();
  set(timers.map((t) => (t.id === id ? update(t, now) : t)));
};

/** Every timer, as they stand now. */
export const listTimers = (): readonly Timer[] => timers;

/** How long a timer has left, in milliseconds (never below 0). */
export function timeLeft(timer: Timer, now: number): number {
  return Math.max(0, timer.pausedLeft ?? timer.endsAt - now);
}

export function startTimer(label: string, seconds: number, recipeTitle: string | null): void {
  allowSound();
  set([
    ...timers,
    {
      id: crypto.randomUUID(),
      label,
      recipeTitle,
      seconds,
      endsAt: Date.now() + seconds * 1000,
      pausedLeft: null,
      done: false,
    },
  ]);
}

export function stopTimer(id: string): void {
  set(timers.filter((t) => t.id !== id));
}

export function pauseTimer(id: string): void {
  change(id, (t, now) =>
    t.done || t.pausedLeft !== null ? t : { ...t, pausedLeft: Math.max(0, t.endsAt - now) },
  );
}

export function resumeTimer(id: string): void {
  allowSound();
  change(id, (t, now) =>
    t.pausedLeft === null ? t : { ...t, endsAt: now + t.pausedLeft, pausedLeft: null },
  );
}

/** Sets how long a timer has left, and starts it from there. */
export function setTimeLeft(id: string, seconds: number): void {
  allowSound();
  change(id, (t, now) => ({
    ...t,
    seconds,
    endsAt: now + seconds * 1000,
    pausedLeft: null,
    done: false,
  }));
}

/** One more minute on a timer, running, paused or rung. */
export function addMinute(id: string): void {
  allowSound();
  change(id, (t, now) =>
    t.pausedLeft !== null
      ? { ...t, pausedLeft: t.pausedLeft + 60_000, seconds: t.seconds + 60 }
      : {
          ...t,
          endsAt: Math.max(t.endsAt, now) + 60_000,
          seconds: t.seconds + 60,
          done: false,
        },
  );
}

function ring(timer: Timer): void {
  try {
    if (audio) {
      for (let i = 0; i < 3; i++) {
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        tone.frequency.value = 880;
        gain.gain.value = 0.2;
        tone.connect(gain).connect(audio.destination);
        const at = audio.currentTime + i * 0.5;
        tone.start(at);
        tone.stop(at + 0.3);
      }
    }
  } catch {
    // No sound; the screen still says so.
  }
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    // No buzz on this device.
  }
  if (document.visibilityState === "hidden" && notificationsAllowed()) {
    const text = timer.recipeTitle ? `${timer.label} (${timer.recipeTitle})` : timer.label;
    void navigator.serviceWorker?.ready
      .then((registration) =>
        registration.showNotification("Timer done", { body: text, tag: timer.id }),
      )
      .catch(() => {
        try {
          new Notification("Timer done", { body: text, tag: timer.id });
        } catch {
          // Not shown.
        }
      });
  }
}

export function notificationsAllowed(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

/** Whether Fennl could ask to show notifications here (and hasn't been told no). */
export function canAskForNotifications(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "default";
}

export async function askForNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Marks timers that have ended, ringing each once. */
function check(now = Date.now()): void {
  const ended = timers.filter((t) => !t.done && t.pausedLeft === null && t.endsAt <= now);
  if (ended.length === 0) return;
  set(timers.map((t) => (ended.includes(t) ? { ...t, done: true } : t)));
  for (const timer of ended) ring(timer);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The timers, and the time now (for what's left), updated every second while any runs. */
export function useTimers(): { timers: Timer[]; now: number } {
  const list = useSyncExternalStore(subscribe, () => timers);
  const now = useSyncExternalStore(subscribeClock, () => clock);
  useEffect(() => {
    check();
    const back = () => check();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
  return { timers: list, now };
}

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  ticking ??= setInterval(() => {
    // Only while a timer runs: pages showing the timers don't redraw every second for nothing.
    if (!timers.some((t) => !t.done && t.pausedLeft === null)) return;
    clock = Date.now();
    check(clock);
    for (const l of clockListeners) l();
  }, 1000);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && ticking) {
      clearInterval(ticking);
      ticking = null;
    }
  };
}
