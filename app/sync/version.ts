import { useEffect, useState } from "react";

// "A new version is ready" (phase C4). A home-screen app has no reload button (C2), so the app
// itself says when a newer release is live, and offers to reload.

/** How often to ask while the app is open, besides when it comes back into view. */
const CHECK_EVERY_MS = 10 * 60_000;

/** Whether the server runs a different build than this page. Local builds ("dev") never ask. */
export function isNewer(serverVersion: unknown, ownVersion: string): boolean {
  return (
    typeof serverVersion === "string" &&
    serverVersion !== "dev" &&
    ownVersion !== "dev" &&
    serverVersion !== ownVersion
  );
}

async function serverVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** True once a newer release is live. */
export function useNewVersion(): boolean {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      const version = await serverVersion();
      if (!stopped && isNewer(version, __APP_VERSION__)) setNewer(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    const every = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(every);
    };
  }, []);
  return newer;
}
