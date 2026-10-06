import { useCallback, useEffect, useState } from "react";
import type { DeviceSummary, RegisterResult } from "../../shared/devices";
import { deviceId } from "./deviceId";

export type DeviceGate =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "over_limit"; max: number; devices: DeviceSummary[] };

async function post(path: string, body: unknown): Promise<RegisterResult | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as RegisterResult) : null;
  } catch {
    return null;
  }
}

/**
 * Registers this browser for the signed-in session (on every app start) and says whether the
 * app may open or the takeover screen is needed. A failed check doesn't lock anyone out: the
 * server still signs out devices that are taken over.
 */
export function useDeviceGate(sessionId: string | undefined) {
  const [gate, setGate] = useState<DeviceGate>({ kind: "idle" });
  const [checkedFor, setCheckedFor] = useState<string | undefined>(undefined);

  if (sessionId !== checkedFor) {
    // A new session (signed in, or switched): check again before showing the app.
    setCheckedFor(sessionId);
    setGate(sessionId ? { kind: "checking" } : { kind: "idle" });
  }

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void post("/api/devices/register", { deviceId: deviceId() }).then((result) => {
      if (cancelled) return;
      setGate(result?.status === "over_limit" ? { kind: "over_limit", ...result } : { kind: "ok" });
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /** "Use Fennl here": signs out the chosen devices (all others when none are given). */
  const takeOver = useCallback(async (signOut?: string[]) => {
    const result = await post("/api/devices/takeover", {
      deviceId: deviceId(),
      ...(signOut ? { signOut } : {}),
    });
    if (!result) return false;
    setGate(result.status === "over_limit" ? { kind: "over_limit", ...result } : { kind: "ok" });
    return true;
  }, []);

  return { gate, takeOver };
}
