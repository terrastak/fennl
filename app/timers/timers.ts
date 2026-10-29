import { useEffect, useSyncExternalStore } from "react";
import { alertsOn, alertsTurnedOff, cancelAlert, scheduleAlert } from "./timerAlerts";

// Timers (phase F5; anywhere in the app since U9, owner's choices 2026-10-28): several at once,
// started from a time in a recipe's step or on their own, kept on this device only (so a reload
// or another page doesn't lose them) and counted from when they end, so a phone that slept or a
// tab in the background still shows the right time when it comes back. A timer can be paused,
// and its time changed. A finished timer rings
// (a short tone and a buzz where the device can), and, when Fennl isn't on screen and the person
// allowed it, shows a notification. With timer alerts on (U10, ./timerAlerts.ts), the server
// also sends this browser an alert when each running timer ends, so it rings with the phone
// locked. A countdown on the lock screen isn't possible from a web app (spec.md F5 item 4b).

export interface Timer {
  id: string;
  /** What it's for: named from its step ("Bake"), or the name someone gave it. */
  label: string;
  /** The recipe whose step started it; null for a timer of the person's own. */
  recipeTitle: string | null;
  /** The number of the step that started it (timers started before 2026-10-29 have none). */
  step?: number;
  seconds: number;
  /** When it ends, in milliseconds since 1970 (while it runs). */
  endsAt: number;
  /** Paused: how long it has left, in milliseconds; null while it runs. */
  pausedLeft: number | null;
  /** Rung, and waiting to be dismissed. */
  done: boolean;
  /** The page it was started on (at its step, on the recipe page), which its alert opens. */
  path?: string;
  /**
   * With timer alerts on: "set" once the server will alert this browser when it ends,
   * "not-set" when it couldn't be asked (no connection).
   */
  alert?: "set" | "not-set";
}

const KEY = "fennl:cook-timers";
/**
 * A finished timer clears itself this long after it ended (U10 fix, 2026-10-29): one that rang
 * and was never dismissed, or that ended while Fennl was closed, doesn't stay on every page.
 */
const FORGET_AFTER_MS = 60 * 60_000;
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
      ? (value as Timer[])
          .map((t) => ({ ...t, pausedLeft: t.pausedLeft ?? null }))
          .filter((t) => !stale(t, Date.now()))
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

/** Where a timer is from, as its card and its alert say: "Step 5 · Banana bread", "Your timer". */
export function fromText(timer: Pick<Timer, "recipeTitle" | "step">): string {
  if (!timer.recipeTitle) return "Your timer";
  return timer.step ? `Step ${timer.step} · ${timer.recipeTitle}` : timer.recipeTitle;
}

export function startTimer(
  label: string,
  seconds: number,
  recipeTitle: string | null,
  from: { step?: number; path?: string } = {},
): void {
  allowSound();
  const timer: Timer = {
    id: crypto.randomUUID(),
    label,
    recipeTitle,
    ...(from.step ? { step: from.step } : {}),
    seconds,
    endsAt: Date.now() + seconds * 1000,
    pausedLeft: null,
    done: false,
    path: from.path ?? here(),
  };
  set([...timers, timer]);
  askForAlert(timer);
}

export function stopTimer(id: string): void {
  const timer = timers.find((t) => t.id === id);
  set(timers.filter((t) => t.id !== id));
  if (timer && !timer.done && alertsOn()) cancelAlert(id);
}

export function pauseTimer(id: string): void {
  const before = timers.find((t) => t.id === id);
  change(id, (t, now) =>
    t.done || t.pausedLeft !== null ? t : { ...t, pausedLeft: Math.max(0, t.endsAt - now) },
  );
  // Paused: no alert until it runs again.
  if (before && !before.done && before.pausedLeft === null && alertsOn()) cancelAlert(id);
}

export function resumeTimer(id: string): void {
  allowSound();
  change(id, (t, now) =>
    t.pausedLeft === null ? t : { ...t, endsAt: now + t.pausedLeft, pausedLeft: null },
  );
  alertFor(id);
}

/** Sets how long a timer has left: running from there, or paused at it. */
export function setTimeLeft(id: string, seconds: number, running = true): void {
  allowSound();
  const before = timers.find((t) => t.id === id);
  change(id, (t, now) => ({
    ...t,
    seconds,
    endsAt: now + seconds * 1000,
    pausedLeft: running ? null : seconds * 1000,
    done: false,
  }));
  if (running) alertFor(id);
  else if (before && !before.done && before.pausedLeft === null && alertsOn()) cancelAlert(id);
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
  alertFor(id);
}

/** The page this is (the app's start where there's no page, as in tests). */
const here = () => (typeof location === "undefined" ? "/" : location.pathname);

/** With alerts on, asks the server to alert this browser when a running timer ends. */
function askForAlert(timer: Timer): void {
  if (!alertsOn() || timer.done || timer.pausedLeft !== null) return;
  void scheduleAlert({
    ...timer,
    // Said under the alert's title: "Step 5 · Banana bread" (a timer of one's own: nothing).
    recipeTitle: timer.recipeTitle ? fromText(timer) : "",
    path: timer.path ?? here(),
  }).then((ok) => {
    const current = timers.find((t) => t.id === timer.id);
    // Stopped or paused while the server was being asked: take the alert back, now it's there.
    if (ok && (!current || current.pausedLeft !== null)) cancelAlert(timer.id);
    // Only if the timer is still the one asked about (not moved on since).
    if (current && current.endsAt === timer.endsAt && current.pausedLeft === null) {
      set(timers.map((t) => (t === current ? { ...t, alert: ok ? "set" : "not-set" } : t)));
    }
  });
}

const alertFor = (id: string) => {
  const timer = timers.find((t) => t.id === id);
  if (timer) askForAlert(timer);
};

/** Alerts just turned on: the timers already running get theirs too. */
export function alertRunningTimers(): void {
  for (const timer of timers) askForAlert(timer);
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
  if (document.visibilityState === "hidden" && notificationsAllowed() && !alertsTurnedOff()) {
    const title = `Timer finished: ${timer.label}`;
    const body = fromText(timer);
    // Clicked (or its Show step): back to the timer's step, as the server's alerts do (sw.js).
    const data = { path: timer.path ?? "/" };
    const actions = [{ action: "show", title: "Show step" }];
    void navigator.serviceWorker?.ready
      .then((registration) =>
        registration.showNotification(title, {
          body,
          tag: timer.id,
          data,
          actions,
        } as NotificationOptions),
      )
      .catch(() => {
        try {
          new Notification(title, { body, tag: timer.id });
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

/** Ended over an hour ago (a paused timer hasn't ended). */
function stale(timer: Timer, now: number): boolean {
  return timer.pausedLeft === null && timer.endsAt <= now - FORGET_AFTER_MS;
}

/**
 * Marks timers that have ended, ringing each once, and clears those that ended over an hour ago
 * (without ringing: one that ended that long ago while Fennl was closed is no use now).
 */
export function checkTimers(now = Date.now()): void {
  const kept = timers.filter((t) => !stale(t, now));
  const ended = kept.filter((t) => !t.done && t.pausedLeft === null && t.endsAt <= now);
  if (ended.length === 0 && kept.length === timers.length) return;
  set(kept.map((t) => (ended.includes(t) ? { ...t, done: true } : t)));
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
    checkTimers();
    const back = () => checkTimers();
    // Back online: alerts that couldn't be asked for are asked for now.
    const online = () => {
      for (const timer of timers) if (timer.alert === "not-set") askForAlert(timer);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("online", online);
    };
  }, []);
  return { timers: list, now };
}

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  ticking ??= setInterval(() => {
    // Redrawn only while a timer runs: pages showing the timers don't redraw every second for
    // nothing. A finished one is still cleared once it's an hour old.
    if (!timers.some((t) => !t.done && t.pausedLeft === null)) {
      if (timers.some((t) => t.done)) checkTimers();
      return;
    }
    clock = Date.now();
    checkTimers(clock);
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
