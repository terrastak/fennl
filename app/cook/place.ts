import { useState } from "react";

// Where someone is in cook mode (U8): kept on this device for the day, so a phone call or a
// reload mid-recipe comes back to the same step; tomorrow starts at the beginning again.

/** The step shown first (0 is step 1), or -1 for "You'll need" (phones). */
export type Place = number;

const key = (recipeId: string, day: string) => `fennl:cook-place:${recipeId}:${day}`;

function load(recipeId: string, day: string): Place {
  try {
    const value = Number(localStorage.getItem(key(recipeId, day)) ?? "-1");
    return Number.isInteger(value) && value >= -1 ? value : -1;
  } catch {
    return -1;
  }
}

export function usePlace(recipeId: string, day: string): [Place, (place: Place) => void] {
  const [place, setPlace] = useState(() => load(recipeId, day));
  const [loadedFor, setLoadedFor] = useState(`${recipeId}:${day}`);
  let current = place;
  if (loadedFor !== `${recipeId}:${day}`) {
    current = load(recipeId, day);
    setLoadedFor(`${recipeId}:${day}`);
    setPlace(current);
  }
  const keep = (next: Place) => {
    setPlace(next);
    try {
      localStorage.setItem(key(recipeId, day), String(next));
    } catch {
      // Kept for this visit only.
    }
  };
  return [current, keep];
}
