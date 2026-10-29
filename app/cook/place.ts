import { useState } from "react";

// Where someone is in cook mode (U8): kept on this device, so a phone call or a reload
// mid-recipe comes back to the same step. It lasts 12 hours from the last move, not to midnight,
// so cooking late into the evening doesn't lose its place; the next day starts at the beginning.

/** The step shown first (0 is step 1), or -1 for "You'll need" (phones). */
export type Place = number;

const KEEP = 12 * 60 * 60 * 1000;
const key = (recipeId: string) => `fennl:cook-place:${recipeId}`;

function load(recipeId: string): Place {
  try {
    const saved = JSON.parse(localStorage.getItem(key(recipeId)) ?? "null") as {
      place?: unknown;
      at?: unknown;
    } | null;
    const place = saved?.place;
    const fresh = typeof saved?.at === "number" && Date.now() - saved.at < KEEP;
    return fresh && typeof place === "number" && Number.isInteger(place) && place >= -1
      ? place
      : -1;
  } catch {
    return -1;
  }
}

export function usePlace(recipeId: string): [Place, (place: Place) => void] {
  const [place, setPlace] = useState(() => load(recipeId));
  const [loadedFor, setLoadedFor] = useState(recipeId);
  let current = place;
  if (loadedFor !== recipeId) {
    current = load(recipeId);
    setLoadedFor(recipeId);
    setPlace(current);
  }
  const keep = (next: Place) => {
    setPlace(next);
    try {
      localStorage.setItem(key(recipeId), JSON.stringify({ place: next, at: Date.now() }));
    } catch {
      // Kept for this visit only.
    }
  };
  return [current, keep];
}
