import { factorText, namesAPan, panName } from "../../shared/pans";
import type { Recipe, RecipeServings } from "../../shared/recipe";
import { scaledServings, type RecipeScale, type UnitSystem } from "../../shared/scale";
import { servingsText, timeText } from "../recipes/format";

// What a printed recipe says about itself (phase F6): its times and servings on one line, and
// how it's shown when it isn't as written, since the highlights on screen don't print.

/** A recipe's scale and the account's units, as the printout shows the recipe. */
export interface PrintScale {
  factor: number;
  units: UnitSystem;
  held: ReadonlySet<string>;
  pans: RecipeScale["pans"] | null;
}

export function printScale(recipe: Recipe, units: UnitSystem): PrintScale {
  return {
    factor: recipe.scale?.factor ?? 1,
    units,
    held: new Set(recipe.scale?.held ?? []),
    pans: recipe.scale?.pans ?? null,
  };
}

const NAMED = /^(?:Doubled|Tripled|Halved)$/u;

/**
 * The line under the title when the recipe isn't printed as written: "Doubled from the
 * original", "Scaled for your 9×13 pan (about 1¾×)", "Shown in metric". Null when it is.
 */
export function scaleLine({ factor, units, pans }: PrintScale): string | null {
  const factorWords = factorText(factor);
  const scaled = pans
    ? `Scaled for your ${panName(pans.yours)} (${factorWords.toLowerCase()})`
    : factor === 1
      ? null
      : NAMED.test(factorWords)
        ? `${factorWords} from the original`
        : `Scaled ${factorWords} from the original`;
  const shown =
    units === "us" ? "shown in US units" : units === "metric" ? "shown in metric" : null;
  if (!scaled && !shown) return null;
  const said = [scaled, shown].filter(Boolean).join(", ");
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}. Changed amounts are in bold.`;
}

/** The servings as printed: scaled, and naming the person's pan when scaled for it. */
export function printedServings(recipe: Recipe, scale: PrintScale): RecipeServings {
  const scaled = scaledServings(recipe.servings, scale.factor);
  return scale.pans && recipe.servings.yield && namesAPan(recipe.servings.yield)
    ? { ...scaled, yield: `in your ${panName(scale.pans.yours)}` }
    : scaled;
}

/** Prep, cook and total times and what it makes, as short facts for one line. */
export function factsLine(recipe: Recipe, scale: PrintScale): string[] {
  const times = [
    ["Prep", timeText(recipe.times.prep)],
    ["Cook", timeText(recipe.times.cook)],
    ["Total", timeText(recipe.times.total)],
  ].flatMap(([label, value]) => (value ? [`${label} ${value}`] : []));
  const makes = servingsText(printedServings(recipe, scale));
  return makes ? [...times, makes] : times;
}
