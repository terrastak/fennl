import { useEffect, useSyncExternalStore } from "react";

// Cook mode's timers (phase F5): several at once, kept on this device (so a reload or opening a
// linked recipe doesn't lose them) and counted from when they end, so a phone that slept or a
// tab in the background still shows the right time when it comes back. A finished timer rings
// (a short tone and a buzz where the device can), and, when Fennl isn't on screen and the person
// allowed it, shows a notification. A countdown on the lock screen isn't possible from a web
// app (spec.md F5 item 4b).

export interface Timer {
  id: string;
  /** What it's for: "Bake 25 to 30 minutes". */
  label: string;
  recipeTitle: string;
  seconds: number;
  /** When it ends, in milliseconds since 1970. */
  endsAt: number;
  /** Rung, and waiting to be dismissed. */
  done: boolean;
}

const KEY = "fennl:cook-timers";
let timers: Timer[] = load();
const listeners = new Set<() => void>();
let audio: AudioContext | null = null;

function load(): Timer[] {
  try {
    const text = localStorage.getItem(KEY);
    const value = text ? (JSON.parse(text) as unknown) : [];
    return Array.isArray(value) ? (value as Timer[]) : [];
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
}

export function startTimer(label: string, seconds: number, recipeTitle: string): void {
  // Made from the tap, so the browser lets it make a sound later.
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    audio ??= Context ? new Context() : null;
    void audio?.resume();
  } catch {
    audio = null;
  }
  set([
    ...timers,
    {
      id: crypto.randomUUID(),
      label,
      recipeTitle,
      seconds,
      endsAt: Date.now() + seconds * 1000,
      done: false,
    },
  ]);
}

export function stopTimer(id: string): void {
  set(timers.filter((t) => t.id !== id));
}

/** One more minute on a timer, running or rung. */
export function addMinute(id: string): void {
  set(
    timers.map((t) =>
      t.id === id
        ? {
            ...t,
            endsAt: Math.max(t.endsAt, Date.now()) + 60_000,
            seconds: t.seconds + 60,
            done: false,
          }
        : t,
    ),
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
    const text = `${timer.label} (${timer.recipeTitle})`;
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
  const ended = timers.filter((t) => !t.done && t.endsAt <= now);
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

let clock = Date.now();
let ticking: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  ticking ??= setInterval(() => {
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
