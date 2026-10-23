import { useState } from "react";

// What's been checked off in cook mode (phase F5): kept on this device for the day, so a phone
// call mid-recipe doesn't lose your place; tomorrow starts fresh. "Clear all checks" empties it.

export interface Checks {
  ingredients: string[];
  steps: string[];
}

const empty: Checks = { ingredients: [], steps: [] };
const key = (recipeId: string, day: string) => `fennl:cook-checks:${recipeId}:${day}`;

function load(recipeId: string, day: string): Checks {
  try {
    const value = JSON.parse(localStorage.getItem(key(recipeId, day)) ?? "null") as Checks | null;
    return value && Array.isArray(value.ingredients) && Array.isArray(value.steps) ? value : empty;
  } catch {
    return empty;
  }
}

export function useChecks(
  recipeId: string,
  day: string,
): [Checks, (kind: keyof Checks, id: string, on: boolean) => void, () => void] {
  const [checks, setChecks] = useState(() => load(recipeId, day));
  const [loadedFor, setLoadedFor] = useState(`${recipeId}:${day}`);
  let current = checks;
  if (loadedFor !== `${recipeId}:${day}`) {
    current = load(recipeId, day);
    setLoadedFor(`${recipeId}:${day}`);
    setChecks(current);
  }
  const keep = (next: Checks) => {
    setChecks(next);
    try {
      if (next.ingredients.length === 0 && next.steps.length === 0) {
        localStorage.removeItem(key(recipeId, day));
      } else {
        localStorage.setItem(key(recipeId, day), JSON.stringify(next));
      }
    } catch {
      // Kept for this visit only.
    }
  };
  const toggle = (kind: keyof Checks, id: string, on: boolean) => {
    const rest = current[kind].filter((x) => x !== id);
    keep({ ...current, [kind]: on ? [...rest, id] : rest });
  };
  return [current, toggle, () => keep(empty)];
}
