/**
 * Devices (phase B6): the browsers someone uses Fennl in. Shared by the Worker and the app.
 */

/** A device as the app shows it. Dates are ISO strings. */
export interface DeviceSummary {
  id: string;
  label: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** The browser asking. */
  current: boolean;
}

/** What registering a browser answers. */
export type RegisterResult =
  | { status: "ok" }
  | {
      status: "over_limit";
      /** How many devices the plan allows at once. */
      max: number;
      /** The devices already in use, which can be signed out to make room. */
      devices: DeviceSummary[];
    };

/** The device list in Settings. max is null when there's no limit. */
export interface DeviceList {
  max: number | null;
  devices: DeviceSummary[];
}

/** Random, made by the browser: letters, digits and dashes, 16 to 64 of them. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,64}$/.test(value);
}

/** "Safari on iPhone", "Chrome on Windows": a name people recognise, from the user agent. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /SamsungBrowser\//.test(ua)
          ? "Samsung Internet"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "A browser";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "Chromebook"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  return system ? `${browser} on ${system}` : browser;
}
