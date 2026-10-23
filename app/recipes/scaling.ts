import { useState } from "react";
import type { Recipe } from "../../shared/recipe";
import { factorName, type RecipeScale, type ShownLine, type UnitSystem } from "../../shared/scale";
import { activeSyncClient } from "../sync/useSync";
import { useUnits } from "./units";

// Scaling and units on the recipe page (phase F1). The scale is kept with the recipe for the
// whole household, so a doubled recipe stays doubled on every device until someone puts it back;
// the units belong to the account. Fennl only changes how amounts are shown, never the recipe:
// every number it changed is highlighted, and tapping a line shows the original and the working.

export interface Scaling {
  factor: number;
  units: UnitSystem;
  held: ReadonlySet<string>;
  /** Shown differently from the recipe as written. */
  active: boolean;
  /** Keep a line at its written amount, or let it scale again. */
  hold: (lineId: string, held: boolean) => void;
  setFactor: (factor: number) => void;
  setUnits: (units: UnitSystem) => void;
  /** The scale couldn't be saved for the household (shown on this device only). */
  saveFailed: boolean;
  /** The units couldn't be saved to the account (kept on this device only). */
  unitsFailed: boolean;
}

/** The recipe exactly as written, as Trash shows it. */
export const AS_WRITTEN: Scaling = {
  factor: 1,
  units: "written",
  held: new Set(),
  active: false,
  hold: () => undefined,
  setFactor: () => undefined,
  setUnits: () => undefined,
  saveFailed: false,
  unitsFailed: false,
};

export const SHOWN_IN: Record<UnitSystem, string> = {
  written: "",
  us: "shown in US units",
  metric: "shown in metric",
};

/** A scale worth keeping, or null for the recipe as written. */
function kept(factor: number, held: string[]): RecipeScale | null {
  return factor === 1 ? null : { factor, held };
}

const sameScale = (a: RecipeScale | null, b: RecipeScale | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/** What the page says at the top when the recipe isn't shown as written. */
export function scaleNote(factor: number, units: UnitSystem): string {
  const parts = [factor === 1 ? "" : factorName(factor), SHOWN_IN[units]].filter(Boolean);
  const said = parts.join(" and ");
  return `${said[0]?.toUpperCase()}${said.slice(1)}: changed amounts are highlighted. Tap a line to see the original.`;
}

/** The recipe's scale and the account's units, and ways to change them. */
export function useScaling(recipe: Recipe | null): Scaling {
  const stored = recipe?.scale ?? null;
  // A choice that hasn't come back from the household's copy yet, or couldn't be saved.
  const [local, setLocal] = useState<RecipeScale | null | undefined>(undefined);
  const [saveFailed, setSaveFailed] = useState(false);
  const [units, chooseUnits] = useUnits();
  const [unitsFailed, setUnitsFailed] = useState(false);
  const storedKey = JSON.stringify(stored);

  const [seen, setSeen] = useState(storedKey);
  if (seen !== storedKey) {
    // The household's copy changed (this choice arrived, or someone else's): show that.
    setSeen(storedKey);
    setLocal(undefined);
    setSaveFailed(false);
  }

  const scale = local !== undefined ? local : stored;
  const factor = scale?.factor ?? 1;
  const held = scale?.held ?? [];

  const apply = async (next: RecipeScale | null) => {
    if (!recipe || sameScale(next, scale)) return;
    setLocal(next);
    setSaveFailed(false);
    try {
      await activeSyncClient()?.save({
        kind: "recipe",
        id: recipe.id,
        fields: {},
        scale: next,
        changedAt: Date.now(),
      });
    } catch {
      setSaveFailed(true);
    }
  };

  const hold = (lineId: string, keep: boolean) => {
    const rest = held.filter((id) => id !== lineId);
    void apply(kept(factor, keep ? [...rest, lineId] : rest));
  };

  return {
    factor,
    units,
    held: new Set(held),
    active: factor !== 1 || units !== "written",
    hold,
    setFactor: (next) => void apply(kept(next, held)),
    setUnits: (next) => {
      setUnitsFailed(false);
      void chooseUnits(next).then((saved) => setUnitsFailed(!saved));
    },
    saveFailed,
    unitsFailed,
  };
}

/** A shown line's words. */
export const lineText = (line: ShownLine) => line.pieces.map((p) => p.text).join("");
