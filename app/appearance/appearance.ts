import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_APPEARANCE, parseAppearance, type Appearance } from "../../shared/appearance";

/**
 * Where appearance choices are kept until accounts exist (Stage B). index.html reads the same
 * key before the app starts, so the right colors show from the first paint.
 */
export const APPEARANCE_STORAGE_KEY = "fennl:appearance";

export function loadAppearance(storage: Pick<Storage, "getItem"> | undefined): Appearance {
  try {
    const raw = storage?.getItem(APPEARANCE_STORAGE_KEY);
    return raw ? parseAppearance(JSON.parse(raw)) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(
  storage: Pick<Storage, "setItem"> | undefined,
  appearance: Appearance,
): void {
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice still applies now.
  }
}

type AttributeTarget = Pick<Element, "setAttribute" | "removeAttribute">;

/** Sets the data-* attributes that tokens.css reads. Defaults remove the attribute. */
export function applyAppearance(root: AttributeTarget, appearance: Appearance): void {
  setOrRemove(root, "data-scheme", appearance.scheme, DEFAULT_APPEARANCE.scheme);
  setOrRemove(root, "data-mode", appearance.mode, DEFAULT_APPEARANCE.mode);
  setOrRemove(root, "data-text-size", appearance.textSize, DEFAULT_APPEARANCE.textSize);
}

function setOrRemove(root: AttributeTarget, name: string, value: string, fallback: string): void {
  if (value === fallback) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

// A tiny store so every component sees the same appearance and updates together.
let current: Appearance | undefined;
const listeners = new Set<() => void>();

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function getSnapshot(): Appearance {
  current ??= loadAppearance(browserStorage());
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearance(): [Appearance, (change: Partial<Appearance>) => void] {
  const appearance = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_APPEARANCE);
  const update = useCallback((change: Partial<Appearance>) => {
    current = { ...getSnapshot(), ...change };
    saveAppearance(browserStorage(), current);
    applyAppearance(document.documentElement, current);
    for (const listener of listeners) listener();
  }, []);
  return [appearance, update];
}
