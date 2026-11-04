import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPaprikaRecipe } from "./paprika";
import { bytesSource, paprikaEntries, readPaprikaEntry } from "./paprikaFile";
import type { DirectionStep, IngredientLine } from "./recipe";
import { amountLine, stepIngredients, type StepUse } from "./stepIngredients";

// U14: the ingredients under each step, scored on recipes from the owner's library (the text-only
// copy in test_recipes/). Every answer in stepIngredients.scorecard.json was checked by hand
// against the recipe. A wrong ingredient is worse than a missing one (the cook adds it to the
// bowl), so any wrong row fails; a missed one is only counted.
//
// Each step's expected rows are written as `describe` writes them below. `optional` lists lines
// the step may show or not: a line named again once it's in the bowl ("toss the pasta with…"),
// which the owner's rule shows as the whole line (2026-11-04). It only ever excuses that whole
// line, never a share, a worked-out amount or an unsure row.
//
// The set includes the patterns reviewers found wrong on the rest of the library (2026-11-04):
// greasing and flouring pans and counters, letting dough rise, a knife dipped in water, tool
// words (an ice cream scoop, the skillet used to cook the bacon), plural words across ingredient
// sections, frying oil, and "not sure which" over lines a step uses together.
//
// To see what the matcher says now: STEP_SCORECARD_DRAFT=/some/file.json npx vitest run --project
// node shared/stepIngredients.scorecard.test.ts

interface Expected {
  title: string;
  /** Its first ingredient line, when two recipes have the same title. */
  first?: string;
  steps: { uses: string[]; optional?: string[] }[];
}

const root = join(import.meta.dirname, "..");

async function library(wanted: Expected[]) {
  const titles = new Set(wanted.map((e) => e.title));
  const bytes = await readFile(join(root, "test_recipes/all-recipes.paprikarecipes"));
  const source = bytesSource(new Uint8Array(bytes));
  const { recipes } = await paprikaEntries(source);
  const found = new Map<string, { ingredients: IngredientLine[]; directions: DirectionStep[] }>();
  for (const entry of recipes) {
    const read = readPaprikaRecipe(await readPaprikaEntry(source, entry), entry.name);
    if ("problem" in read) continue;
    const title = read.draft.fields.title?.value.trim() ?? "";
    if (!titles.has(title)) continue;
    const ingredients = read.draft.fields.ingredients?.value ?? [];
    const first = wanted.find((e) => e.title === title)?.first;
    if (first && ingredients[0]?.text !== first) continue;
    if (found.has(title)) continue;
    found.set(title, { ingredients, directions: read.draft.fields.directions?.value ?? [] });
  }
  return found;
}

/** A row as the fixture writes it: "written 3/4 cup sugar | 1 cup sugar, divided". */
function describe_(
  use: StepUse,
  step: DirectionStep,
  lines: readonly IngredientLine[],
  steps: readonly DirectionStep[],
): string {
  const text = (id: string) => lines.find((l) => l.id === id)?.text ?? id;
  switch (use.kind) {
    case "all":
      return text(use.lineId);
    case "written":
      return `written ${use.remaining ? "remaining " : ""}${step.text.slice(use.start, use.end)} ${use.name} | ${text(use.lineId)}`;
    case "remaining":
    case "part":
      return `${use.kind} ${amountLine(text(use.lineId), use.value, use.unit)} | ${text(use.lineId)}`;
    case "small":
      return `small ${use.words} | ${text(use.lineId)}`;
    case "some":
      return `some | ${text(use.lineId)}`;
    case "which":
      return `which ${use.word} | ${use.lineIds.map(text).join(" | ")}`;
    case "mixture": {
      const number = steps.filter((s) => !s.heading).findIndex((s) => s.id === use.fromStepId) + 1;
      return `mixture ${use.name} from step ${number}`;
    }
  }
}

/** The lines a row is about, for the optional ones. */
const linesOf = (use: StepUse, lines: readonly IngredientLine[]) =>
  ("lineId" in use ? [use.lineId] : "lineIds" in use ? use.lineIds : []).map(
    (id) => lines.find((l) => l.id === id)?.text ?? id,
  );

describe("the ingredients under each step, on the owner's own recipes", () => {
  it("never lists a wrong ingredient, and says how many it misses", async () => {
    const expected = JSON.parse(
      await readFile(join(import.meta.dirname, "stepIngredients.scorecard.json"), "utf8"),
    ) as Expected[];
    const recipes = await library(expected);
    const drafting = !!process.env.STEP_SCORECARD_DRAFT;
    const draft: Expected[] = [];
    const wrong: string[] = [];
    let rows = 0;
    let missed = 0;
    let steps = 0;
    let exact = 0;
    for (const want of expected) {
      const recipe = recipes.get(want.title);
      expect(recipe, want.title).toBeDefined();
      if (!recipe) continue;
      const map = stepIngredients(recipe.ingredients, recipe.directions);
      const methodSteps = recipe.directions.filter((d) => !d.heading);
      if (!drafting) expect(methodSteps.length, want.title).toBe(want.steps.length);
      const got: Expected["steps"] = [];
      methodSteps.forEach((step, n) => {
        const uses = map.get(step.id) ?? [];
        const shown = uses.map((u) => describe_(u, step, recipe.ingredients, recipe.directions));
        got.push({ uses: shown });
        const wanted = want.steps[n] ?? { uses: [] };
        const optional = new Set(wanted.optional ?? []);
        steps++;
        rows += wanted.uses.length;
        let ok = true;
        uses.forEach((u, k) => {
          const row = shown[k] ?? "";
          if (wanted.uses.includes(row)) return;
          // Optional only excuses a line named again, shown whole (the owner's rule): never a
          // worked-out or written amount, a share, or a guess.
          if (u.kind === "all" && linesOf(u, recipe.ingredients).every((l) => optional.has(l))) {
            return;
          }
          ok = false;
          wrong.push(`${want.title}, step ${n + 1}: ${row}`);
        });
        for (const row of wanted.uses) {
          if (!shown.includes(row)) {
            missed++;
            ok = false;
          }
        }
        if (ok) exact++;
      });
      draft.push({ title: want.title, steps: got });
    }
    if (process.env.STEP_SCORECARD_DRAFT) {
      await writeFile(process.env.STEP_SCORECARD_DRAFT, JSON.stringify(draft, null, 2));
    }
    console.log(
      `Step ingredients on ${expected.length} of the owner's recipes: ${steps} steps, ${exact} exactly right, ` +
        `${wrong.length} wrong rows, ${missed} of ${rows} rows missed (${((100 * missed) / Math.max(1, rows)).toFixed(1)}%).`,
    );
    if (!drafting) expect(wrong).toEqual([]);
  }, 60_000);
});
