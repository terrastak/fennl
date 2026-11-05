import { CATEGORY_SEPARATOR as SEPARATOR } from "../../shared/recipe";

// Which categories are open in the recipe box (U17): the left panel's and the phone's sheet.

/** Where the open categories are remembered, on this device only. */
const OPEN_KEY = "fennl:open-categories";

export function rememberedOpen(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

export function keepOpen(open: Set<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // Not kept; the categories open now stay open while the page is.
  }
}

/**
 * The open categories after one moved from key `from` to key `to` (keys are lower-case paths):
 * it and the categories inside it stay open or closed as they were, under their new paths.
 */
export function moveOpen(open: Set<string>, from: string, to: string): Set<string> {
  if (from === to) return open;
  const next = new Set<string>();
  for (const key of open) {
    if (key === from) next.add(to);
    else if (key.startsWith(`${from}${SEPARATOR}`)) next.add(to + key.slice(from.length));
    else next.add(key);
  }
  return next;
}
