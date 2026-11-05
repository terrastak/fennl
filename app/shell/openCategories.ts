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
