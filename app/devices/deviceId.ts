import { isDeviceId } from "../../shared/devices";

const KEY = "fennl:device-id";
let inMemory: string | null = null;

/**
 * This browser's device ID: random, made on first run and kept in the browser's storage. If the
 * storage is cleared or evicted, a new one is made, and the server recognises the same browser by
 * its sign-in (worker/devices). Where storage isn't allowed, the ID lasts until the page closes.
 */
export function deviceId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (isDeviceId(saved)) return saved;
    const made = crypto.randomUUID();
    localStorage.setItem(KEY, made);
    return made;
  } catch {
    return (inMemory ??= crypto.randomUUID());
  }
}
