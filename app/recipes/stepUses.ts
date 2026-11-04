import { readIngredient } from "../../shared/ingredients";
import type { DirectionStep, IngredientLine } from "../../shared/recipe";
import type { LinkedRecipe } from "../../shared/subRecipes";
import { showIngredient, showStepPart, type ShownLine, type ShowOptions } from "../../shared/scale";
import {
  amountLine,
  ingredientName,
  stepIngredients,
  type StepUse,
} from "../../shared/stepIngredients";

/**
 * The ingredients a step uses (U16), in words, for cook mode's "Uses" line and the recipe
 * page's list under each step. Every amount goes through showIngredient or showStepPart, so it's
 * scaled, converted and highlighted exactly as the recipe page shows the line or the step.
 */
export interface ShownUse {
  key: string;
  /** "¾ cup sugar", "the remaining ¼ cup sugar", "a little of the butter". */
  line: ShownLine;
  /** Fennl isn't sure, in words: short for cook mode, long for the recipe page. */
  unsure: { short: string; long: string } | null;
  /** "The flour mixture" made in an earlier step: which one (counting from 1, as shown). */
  from: { stepId: string; number: number } | null;
}

export interface StepUsesContext {
  step: DirectionStep;
  lines: readonly IngredientLine[];
  /** Every step, for a mixture's step number. */
  steps: readonly DirectionStep[];
  scaling: ShowOptions & { held: ReadonlySet<string> };
  /** The amount and name only ("4 boneless, skinless chicken breasts"): cook mode. */
  short?: boolean;
  /** Each starting with a capital, as a list on the recipe page. */
  capital?: boolean;
}

/**
 * An ingredient as a short mention: the line up to the end of its name ("2 lb pork shoulder",
 * "4 boneless, skinless chicken breasts (about 1½ pounds)"), without how it's cut or kept.
 */
export function shortLine(text: string): string {
  const name = ingredientName(text);
  const last = /([\p{L}\p{N}]+)[^\p{L}\p{N}]*$/u.exec(name)?.[1];
  const main = readIngredient(text).amounts.find((a) => a.role === "main");
  if (!last || !main) return text.split(", ")[0] ?? text;
  const at = text.toLowerCase().indexOf(last.toLowerCase(), main.end);
  if (at < 0) return text.split(", ")[0] ?? text;
  // The first comma after it that isn't in brackets.
  let depth = 0;
  for (let k = at + last.length; k < text.length; k++) {
    const c = text[k];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0 && text[k + 1] === " ") return text.slice(0, k);
  }
  return text;
}

/**
 * What each step uses, by step ID, with linked recipes found by their titles ("the slaw" for a
 * line linked to Coleslaw). Cook mode and the recipe page call it once per recipe change.
 */
export function usesByStep(
  ingredients: readonly IngredientLine[],
  directions: readonly DirectionStep[],
  linked?: Readonly<Record<string, LinkedRecipe>>,
): Map<string, StepUse[]> {
  const linkedTitles = new Map(
    ingredients.flatMap((line) => {
      const found = line.linkedRecipeId ? linked?.[line.linkedRecipeId] : undefined;
      return found?.status === "ok" && found.title ? [[line.id, found.title] as const] : [];
    }),
  );
  return stepIngredients(ingredients, directions, { linkedTitles });
}

/**
 * How a line's ingredient is prepared, for a share of it on the recipe page: ", melted" for
 * "½ cup butter, melted, divided". "Divided" is the whole line's, not the share's, and a part
 * with an amount ("plus 2 tablespoons for the pan") or another choice ("or to taste") isn't
 * the share's either.
 */
export function preparation(text: string, named = ""): string {
  const rest = text.slice(shortLine(text).length);
  if (!rest.startsWith(", ")) return "";
  const kept = rest
    .slice(2)
    .split(/,\s+/u)
    .map((part) => part.replace(/\s*\(\s*divided\s*\)\s*/giu, " ").trim())
    .filter(
      (part) =>
        part &&
        // "divided", "divided equally", "divided between two bowls": the whole line's, not the share's.
        !/^divided\b/iu.test(part) &&
        !/^(?:separated|split)$/iu.test(part) &&
        !/^(?:plus|or|and|for|to)\b/iu.test(part) &&
        !/[\p{N}½¼¾⅓⅔⅛⅜⅝⅞()]/u.test(part) &&
        // Not when the step already says it: "⅓ cup of the melted butter".
        !named.toLowerCase().includes(part.toLowerCase()),
    );
  return kept.length > 0 ? `, ${kept.join(", ")}` : "";
}

const plain = (text: string): ShownLine => ({ pieces: [{ text }], changed: false });

/** Words before a shown line: "the remaining " + "¼ cup sugar". */
function after(words: string, line: ShownLine): ShownLine {
  return { ...line, pieces: [{ text: words }, ...line.pieces] };
}

function capitalised(line: ShownLine): ShownLine {
  const [first, ...rest] = line.pieces;
  if (!first?.text) return line;
  const text = first.text.charAt(0).toUpperCase() + first.text.slice(1);
  return { ...line, pieces: [{ ...first, text }, ...rest] };
}

/** "cheddar or Parmesan", "mozzarella, fontina or Parmesan". */
function either(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** The step's own words, as the step shows them (scaled where the step's amounts scale). */
function stepWords(step: DirectionStep, words: string, scaling: ShowOptions): ShownLine {
  const at = step.text.indexOf(words);
  return at >= 0
    ? showStepPart(step.text, at, at + words.length, scaling)
    : showStepPart(words, 0, words.length, scaling);
}

/** A step's uses, each as it's shown. */
export function shownUses(uses: readonly StepUse[], context: StepUsesContext): ShownUse[] {
  const { step, lines, steps, scaling } = context;
  const text = (id: string) => lines.find((l) => l.id === id)?.text ?? "";
  const held = (id: string) => scaling.held.has(id);
  const ingredient = (id: string, words: string) => showIngredient(words, scaling, held(id));
  const method = steps.filter((s) => !s.heading);
  const scaled = scaling.factor !== 1;
  // A share keeps how it's prepared on the recipe page ("⅓ cup butter, melted"), not in cook
  // mode's short mentions.
  const prepared = (id: string, named?: string) =>
    context.short ? "" : preparation(text(id), named);

  const seen = new Set<string>();
  const shown: ShownUse[] = [];
  uses.forEach((use, i) => {
    const key = `${i}-${"lineId" in use ? use.lineId : use.kind}`;
    let row: ShownUse;
    switch (use.kind) {
      case "all": {
        const words = context.short ? shortLine(text(use.lineId)) : text(use.lineId);
        row = { key, line: ingredient(use.lineId, words), unsure: null, from: null };
        break;
      }
      case "written": {
        // The step's own amount, shown exactly as the step shows it.
        const amount = showStepPart(step.text, use.start, use.end, scaling);
        const name = ` ${use.name}${prepared(use.lineId, use.name)}`;
        const line = { ...amount, pieces: [...amount.pieces, { text: name }] };
        row = {
          key,
          line: use.remaining ? after("the remaining ", line) : line,
          unsure: null,
          from: null,
        };
        break;
      }
      case "remaining": {
        // Worked out at the recipe's own amounts. Once scaled, a count the step writes ("2 of
        // the eggs") stays as written while the line doubles, and a line kept as written stays
        // while the step's measures double: the sum would be off, so the step's words instead.
        const words = amountLine(text(use.lineId), use.value, use.unit);
        // Converted to other units, each amount is rounded on its own, so 175 ml and the
        // remaining 59 ml wouldn't add up to the 235 ml listed: the step's words then too.
        const converted =
          !!use.fromSteps && showIngredient(words, { ...scaling, factor: 1 }, true).changed;
        const apart =
          converted ||
          (scaled &&
            (use.fromSteps === "counts" || (use.fromSteps === "measures" && held(use.lineId))));
        row = {
          key,
          line: apart
            ? plain(`the remaining ${ingredientName(text(use.lineId))}`)
            : after("the remaining ", ingredient(use.lineId, words + prepared(use.lineId))),
          unsure: null,
          from: null,
        };
        break;
      }
      case "part":
        row = {
          key,
          line: ingredient(
            use.lineId,
            amountLine(text(use.lineId), use.value, use.unit) + prepared(use.lineId),
          ),
          unsure: null,
          from: null,
        };
        break;
      case "small":
        // The step's words, with any amount in them shown as the step shows it.
        row = { key, line: stepWords(step, use.words, scaling), unsure: null, from: null };
        break;
      case "some": {
        // "some of the 1 cup sugar"; "some of the sugar (about 2 cups)".
        const line = text(use.lineId);
        const about = /^\s*(?:about|approximately|approx\.?|around|roughly|~)\s+/iu.test(line);
        const main = readIngredient(line).amounts.find((a) => a.role === "main");
        let shownLine = after("some of the ", ingredient(use.lineId, shortLine(line)));
        if (about && main) {
          const written = line.slice(main.start, main.end).replace(/^\s*\p{L}+\.?\s+/u, "");
          const amount = ingredient(use.lineId, `about ${written}`);
          shownLine = after(`some of the ${ingredientName(line)} (`, {
            ...amount,
            pieces: [...amount.pieces, { text: ")" }],
          });
        }
        row = {
          key,
          line: shownLine,
          unsure: {
            short: "not sure how much",
            long: "Not sure how much: the recipe doesn’t say",
          },
          from: null,
        };
        break;
      }
      case "which":
        row = {
          key,
          line: plain(use.word.toLowerCase()),
          unsure: {
            short: `not sure which: ${either(use.names)}`,
            long: `Not sure which: ${either(use.names)}`,
          },
          from: null,
        };
        break;
      case "mixture": {
        const number = method.findIndex((s) => s.id === use.fromStepId) + 1;
        row = {
          key,
          line: plain(`the ${use.name}`.replace(/^the (half|some|most|the) /u, "$1 ")),
          unsure: null,
          from: number > 0 ? { stepId: use.fromStepId, number } : null,
        };
        break;
      }
    }
    // Each once: "the flour mixture from step 1" twice in a step is one use. The step's own
    // amounts stay, each where it's written ("¼ teaspoon pepper" for each vegetable).
    if (use.kind !== "written" && use.kind !== "small") {
      const same = `${row.line.pieces.map((p) => p.text).join("")}|${row.from?.stepId ?? ""}`;
      if (seen.has(same)) return;
      seen.add(same);
    }
    shown.push(context.capital ? { ...row, line: capitalised(row.line) } : row);
  });
  return shown;
}

/** Whether every step with ingredients is open, for "Show all" or "Hide all". */
export function allOpen(withUses: readonly string[], open: ReadonlySet<string>): boolean {
  return withUses.length > 0 && withUses.every((id) => open.has(id));
}

/** `open` with `id` opened or closed. */
export function toggled(open: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
