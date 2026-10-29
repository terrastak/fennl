import { useEffect, useState } from "react";
import { deviceId } from "../devices/deviceId";

// Timer alerts with the phone locked (U10, owner's choices 2026-10-28). Once alerts are on for
// this browser, each running timer tells the server when it ends, and the server sends this
// browser a push notification then, so it rings with the screen off or Fennl closed. Only the
// browser that started a timer gets its alert. Turned on from the Timers window or Settings ›
// Timer alerts. On iPhone and iPad it works only for Fennl opened from the Home Screen.

/** "on" while this browser gets alerts; "off" once turned off here. */
const KEY = "fennl:timer-alerts";

export type AlertsState =
  | "on"
  /** Can be turned on. */
  | "off"
  /** An iPhone or iPad with Fennl in a Safari tab: alerts need it opened from the Home Screen. */
  | "home-screen"
  /** Notifications refused for Fennl in the browser's settings. */
  | "blocked"
  /** This browser can't receive them, or the server isn't set up to send them. */
  | "unavailable";

function flag(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

/** Null: neither (as before alerts were ever turned on). */
function setFlag(value: "on" | "off" | null): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for this visit only.
  }
  for (const listener of listeners) listener();
}

/** Whether timers should ask the server for an alert. */
export function alertsOn(): boolean {
  return flag() === "on";
}

/** Turned off here: no notifications at all, not even while the browser runs Fennl. */
export function alertsTurnedOff(): boolean {
  return flag() === "off";
}

/** Safari on iPhone or iPad, in a tab rather than opened from the Home Screen. */
function iosTab(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return standalone === false && !("PushManager" in window);
}

function canPush(): boolean {
  return (
    "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined"
  );
}

let serverKey: Promise<string | null> | null = null;

/** The key browsers subscribe with, or null when the server doesn't send alerts. */
function pushKey(): Promise<string | null> {
  serverKey ??= fetch("/api/push/key")
    .then((res) => (res.ok ? (res.json() as Promise<{ key: string | null }>) : { key: null }))
    .then((body) => body.key)
    .catch(() => {
      serverKey = null;
      return null;
    });
  return serverKey;
}

async function subscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function readAlertsState(): Promise<AlertsState> {
  if (iosTab()) return "home-screen";
  if (!canPush()) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  if (!(await pushKey())) return "unavailable";
  if (alertsOn() && Notification.permission === "granted" && (await subscription())) return "on";
  return "off";
}

/** This browser's alerts state, kept up to date as it's turned on or off. */
export function useAlertsState(): AlertsState | null {
  const [state, setState] = useState<AlertsState | null>(null);
  useEffect(() => {
    let stopped = false;
    const read = () =>
      void readAlertsState()
        .catch((): AlertsState => "unavailable")
        .then((value) => {
          if (!stopped) setState(value);
        });
    read();
    listeners.add(read);
    return () => {
      stopped = true;
      listeners.delete(read);
    };
  }, []);
  return state;
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const plain = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(plain + "=".repeat((4 - (plain.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((byte, i) => byte === b[i]);
}

/** The service worker, once it's running (it must be, to subscribe). */
function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
}

/**
 * Turns alerts on for this browser: asks to show notifications (call it from a tap), subscribes
 * with the browser's push service and tells the server.
 */
export async function turnOnAlerts(): Promise<"on" | "blocked" | "failed"> {
  if (!canPush()) return "failed";
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return "failed";
  }
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "failed";
  try {
    const key = await pushKey();
    const registration = await activeRegistration();
    if (!key || !registration) return "failed";
    const keyBytes = fromBase64Url(key);
    let sub = await registration.pushManager.getSubscription();
    // Made with an earlier key of Fennl's: the push service would refuse what's sent with this one.
    if (sub && !sameKey(sub.options.applicationServerKey, keyBytes)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes,
    });
    const res = await fetch("/api/push/subscription", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId(), ...sub.toJSON() }),
    });
    if (!res.ok) return "failed";
  } catch {
    return "failed";
  }
  setFlag("on");
  return "on";
}

export async function turnOffAlerts(): Promise<void> {
  setFlag("off");
  try {
    await (await subscription())?.unsubscribe();
  } catch {
    // The server forgets it below either way.
  }
  await fetch(`/api/push/subscription?deviceId=${encodeURIComponent(deviceId())}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

/**
 * Settings › Timer alerts › Send a test alert: the server sends this browser an alert now.
 * "sent" means the push service took it; whether it shows is up to the device's settings.
 */
export async function sendTestAlert(): Promise<"sent" | "off" | "failed"> {
  try {
    const res = await fetch("/api/push/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId() }),
    });
    if (res.status === 409) {
      // The server no longer has this browser: offer to turn alerts on again.
      setFlag(null);
      return "off";
    }
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Asks the server to alert this browser when a timer ends (started, or given another minute).
 * True once it will; false when it can't (no connection), so the timer can say so.
 */
export async function scheduleAlert(timer: {
  id: string;
  endsAt: number;
  label: string;
  recipeTitle: string;
  path: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`/api/push/timers/${encodeURIComponent(timer.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: deviceId(),
        endsAt: timer.endsAt,
        label: timer.label,
        recipeTitle: timer.recipeTitle,
        path: timer.path,
      }),
    });
    if (res.status === 409) {
      // The server no longer has this browser (its subscription ended): offer to turn on again.
      setFlag(null);
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** A timer stopped or dismissed: no alert. */
export function cancelAlert(id: string): void {
  void fetch(`/api/push/timers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => undefined);
}
