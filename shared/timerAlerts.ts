/**
 * Timer alerts with the phone locked (U10, owner's choices 2026-10-28): a timer tells
 * the server when it ends, and the server sends a push notification to the browser that started
 * it at that moment, so it rings with the screen off or Fennl closed. Shared by the Worker
 * (worker/push/) and the app (app/cook/timerAlerts.ts).
 */
import { deviceLabel, isDeviceId } from "./devices";

/** The longest label or recipe title kept with an alert; longer ones are cut. */
export const ALERT_TEXT_MAX = 200;
/** How far ahead a timer may end: a few days covers "chill overnight" plus a minute or two. */
export const ALERT_MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/** Timers one person may have waiting at once: far more than anyone cooks with. */
export const MAX_WAITING_ALERTS = 30;

/** A timer's id, made on the device (a UUID). */
export function isTimerId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,64}$/.test(value);
}

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionBody {
  deviceId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** A timer to alert about: `PUT /api/push/timers/:id`. */
export interface TimerAlertBody {
  deviceId: string;
  /** When it ends, in milliseconds since 1970. */
  endsAt: number;
  label: string;
  recipeTitle: string;
  /** The page the alert opens. */
  path: string;
}

/** What a push carries to the service worker (app/offline/sw.js), encrypted on the way. */
export interface TimerPush {
  title: string;
  body: string;
  /** The timer's id: the alert replaces one already shown for the same timer. */
  tag: string;
  path: string;
  /** A test from Settings: shown even with Fennl on screen, where a timer's has rung already. */
  test?: boolean;
}

/** What Settings › Timer notifications › Send a test notification sends (owner's request 2026-10-29). */
export const TEST_PUSH: TimerPush = {
  title: "Fennl test notification",
  body: "Timer notifications work on this browser.",
  tag: "fennl-test",
  path: "/settings#timer-notifications",
  test: true,
};

/**
 * The push services browsers use (Apple, Google for Chrome, Edge's Microsoft one, Mozilla).
 * Fennl only ever sends to these, so a stored address can't make the server call anywhere else.
 */
const PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.port === "" &&
    PUSH_HOSTS.some((host) => host.test(url.hostname))
  );
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** Base64url text of exactly `bytes` bytes. */
function isKey(value: unknown, bytes: number): value is string {
  if (typeof value !== "string" || !BASE64URL.test(value)) return false;
  const length = value.replace(/=+$/, "").length;
  return Math.floor((length * 3) / 4) === bytes;
}

export function cleanSubscription(body: unknown): PushSubscriptionBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { deviceId, endpoint, keys } = body as Record<string, unknown>;
  if (!isDeviceId(deviceId) || !isPushEndpoint(endpoint)) return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  // An uncompressed P-256 public key, and a 16-byte secret.
  if (!isKey(p256dh, 65) || !isKey(auth, 16)) return null;
  return { deviceId, endpoint, keys: { p256dh, auth } };
}

/** Text from the device, tidied and cut to a length the alert can show. */
function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Control characters (new lines and the like) become spaces.
  const text = value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, ALERT_TEXT_MAX) : null;
}

export function cleanTimerAlert(body: unknown, now = Date.now()): TimerAlertBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { deviceId, endsAt, label, recipeTitle, path } = body as Record<string, unknown>;
  if (!isDeviceId(deviceId)) return null;
  if (typeof endsAt !== "number" || !Number.isFinite(endsAt)) return null;
  if (endsAt < now - 60_000 || endsAt > now + ALERT_MAX_AHEAD_MS) return null;
  const cleanLabel = cleanText(label);
  if (!cleanLabel) return null;
  // Only a page of Fennl's own: a path, never another site.
  if (
    typeof path !== "string" ||
    path.length > 500 ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    return null;
  }
  return {
    deviceId,
    endsAt: Math.round(endsAt),
    label: cleanLabel,
    recipeTitle: cleanText(recipeTitle) ?? "",
    path,
  };
}

/** What the alert says: "Bake 25 to 30 minutes (Banana bread)". */
export function timerPush(
  id: string,
  timer: { label: string; recipeTitle: string; path: string },
): TimerPush {
  return {
    title: "Timer done",
    body: timer.recipeTitle ? `${timer.label} (${timer.recipeTitle})` : timer.label,
    tag: id,
    path: timer.path,
  };
}

/**
 * What a browser needs for timer alerts to arrive (U10, owner's request 2026-10-29: people should
 * know, notably that some browsers must stay running). From the user agent; `touch` is whether
 * the device has a touch screen, since an iPad's Safari can say it's a Mac.
 * - "phone": iPhone, iPad, Android: alerts arrive with the phone locked and Fennl closed.
 * - "mac-safari": the Mac receives them itself, even with Safari quit.
 * - "browser-running": a computer's Chrome, Edge, Firefox...: only while the browser runs.
 */
export interface AlertNeeds {
  kind: "phone" | "mac-safari" | "browser-running";
  /** "Chrome", "Edge", "Firefox"... */
  browser: string;
  system: "mac" | "windows" | "other";
}

export function alertNeeds(userAgent: string, touch: boolean): AlertNeeds {
  const label = deviceLabel(userAgent);
  const browser = label.split(" on ")[0] ?? "Your browser";
  const named = browser === "A browser" ? "your browser" : browser;
  if (/ on (iPhone|iPad|Android)$/.test(label) || (/ on Mac$/.test(label) && touch)) {
    return { kind: "phone", browser: named, system: "other" };
  }
  const system = / on Mac$/.test(label) ? "mac" : / on Windows$/.test(label) ? "windows" : "other";
  if (system === "mac" && browser === "Safari") {
    return { kind: "mac-safari", browser: named, system };
  }
  return { kind: "browser-running", browser: named, system };
}
