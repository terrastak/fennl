import { useEffect, useState } from "react";

// Whether timer notifications really reach this device (owner's choice 2026-10-29): the service
// worker (app/offline/sw.js) notes each notification it's sent as it shows it, in Cache Storage
// (where both it and the page can read). A timer whose notification was sent is expected to
// arrive; if it hasn't a few minutes after the timer ended, Fennl says so once, in the Timers
// panel. Nothing shows while everything works. Kept on this device only.

/** Where the service worker notes what arrived (sw.js uses the same names). */
const ARRIVALS = "fennl-timer-arrivals";
const arrivalKey = (tag: string) => `/__arrived/${encodeURIComponent(tag)}`;

const PENDING = "fennl:timer-pending";
const MISSED = "fennl:timer-missed";
/** Past the server's 10 minutes for delivering one, and a minute more. */
const GIVE_UP_MS = 11 * 60_000;

interface Expected {
  id: string;
  label: string;
  endsAt: number;
}

/** A notification that never came: its timer's name and when it ended. */
export interface Missed {
  label: string;
  at: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

const listeners = new Set<() => void>();

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this visit only (not at all, here).
  }
  for (const listener of listeners) listener();
}

/** Whether a notification with this tag arrived (and forgets it, once seen). */
export async function arrived(tag: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(ARRIVALS);
    return await cache.delete(arrivalKey(tag));
  } catch {
    return false;
  }
}

/** Forgets an earlier arrival, before a new one with the same tag (the test's). */
export async function forgetArrival(tag: string): Promise<void> {
  await arrived(tag);
}

/** A timer ended whose notification the server sent: expect it here. */
export function expectArrival(timer: Expected): void {
  const pending = read<Expected[]>(PENDING, []).filter((p) => p.id !== timer.id);
  write(PENDING, [...pending, { id: timer.id, label: timer.label, endsAt: timer.endsAt }]);
}

/** Notifications turned off: nothing more to expect. */
export function expectNothing(): void {
  write(PENDING, null);
}

let checking = false;

/** Ticks off what arrived, and notes one that hasn't long after its timer ended. */
export async function checkArrivals(now = Date.now()): Promise<void> {
  const pending = read<Expected[]>(PENDING, []);
  if (pending.length === 0 || checking) return;
  checking = true;
  try {
    const left: Expected[] = [];
    let missed: Missed | null = null;
    for (const p of pending) {
      if (await arrived(p.id)) continue;
      if (now > p.endsAt + GIVE_UP_MS) missed = { label: p.label, at: p.endsAt };
      else left.push(p);
    }
    write(PENDING, left.length ? left : null);
    if (missed) write(MISSED, missed);
  } finally {
    checking = false;
  }
}

/** The latest notification that didn't arrive, until dismissed. */
export function useMissed(): Missed | null {
  const [missed, setMissed] = useState<Missed | null>(() => read<Missed | null>(MISSED, null));
  useEffect(() => {
    const update = () => setMissed(read<Missed | null>(MISSED, null));
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return missed;
}

export function dismissMissed(): void {
  write(MISSED, null);
}
