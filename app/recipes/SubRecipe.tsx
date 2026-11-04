import { useId, useMemo, useState } from "react";
import { showIngredient, showStep, type UnitSystem } from "../../shared/scale";
import { stepParts } from "../timers/stepParts";
import { TimeLink } from "../timers/TimeLink";
import { linkView, type LinkedRecipe } from "../../shared/subRecipes";
import { Link } from "../router";
import { servingsText } from "./format";
import { ShownText } from "./ScaleControls";
import { StepNumber, StepUsesList } from "./StepIngredients";
import { toggled, usesByStep } from "./stepUses";
import styles from "./recipes.module.css";

// A linked sub-recipe on the recipe page (phase F3): "1 cup BBQ sauce" can show the BBQ sauce
// recipe in place, or open it. It's shown as written: scaling this recipe never silently scales
// the one it links to. A link that stopped working keeps its line and says why.

export function SubRecipe({
  targetId,
  path,
  linked,
  units,
  parentScaled,
}: {
  targetId: string;
  /** The recipes already open above this one, the page's own first. */
  path: readonly string[];
  linked: Readonly<Record<string, LinkedRecipe>>;
  units: UnitSystem;
  parentScaled: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const view = linkView(targetId, path, (rid) => linked[rid]);

  if (view.kind === "gone") {
    return (
      <p className={styles.brokenLink}>
        The linked recipe isn&rsquo;t here any more (deleted, or no longer shared). The line is kept
        as written.
      </p>
    );
  }
  const { recipe } = view;
  if (recipe.status === "trash") {
    return (
      <p className={styles.brokenLink}>
        The linked recipe, {recipe.title}, is in <Link href="/trash">Trash</Link>.
      </p>
    );
  }
  if (view.kind !== "recipe") {
    return (
      <p className={styles.subRecipeLink}>
        <Link href={`/recipes/${recipe.id}`}>Open {recipe.title}</Link>
        {view.kind === "loop" ? " (it's already shown above)" : ""}
      </p>
    );
  }

  const makes = recipe.servings ? servingsText(recipe.servings) : null;
  return (
    <div className={styles.subRecipeLink}>
      <button
        type="button"
        className={styles.textButton}
        aria-expanded={open}
        aria-controls={`${id}-recipe`}
        onClick={() => setOpen(!open)}
      >
        {open ? `Hide ${recipe.title}` : `Show ${recipe.title}`}
      </button>{" "}
      <Link href={`/recipes/${recipe.id}`}>Open it</Link>
      <section
        id={`${id}-recipe`}
        className={styles.subRecipe}
        aria-label={recipe.title}
        hidden={!open}
      >
        {open ? (
          <>
            <p className={styles.subRecipeNote}>
              {makes ? `Makes: ${makes}. ` : ""}
              {parentScaled ? "Shown as written: scaling this recipe doesn't change it." : ""}
            </p>
            <ul className={styles.ingredients}>
              {recipe.ingredients.map((line) =>
                line.heading ? (
                  <li key={line.id} className={styles.subRecipeHeading}>
                    {line.text}
                  </li>
                ) : (
                  <li key={line.id}>
                    <ShownText line={showIngredient(line.text, { factor: 1, units })} />
                    {line.linkedRecipeId ? (
                      <SubRecipe
                        targetId={line.linkedRecipeId}
                        path={[...path, recipe.id]}
                        linked={linked}
                        units={units}
                        parentScaled={false}
                      />
                    ) : null}
                  </li>
                ),
              )}
            </ul>
            {recipe.directions.length > 0 ? (
              <SubRecipeSteps recipe={recipe} anchor={id} linked={linked} units={units} />
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

const AS_WRITTEN_HELD: ReadonlySet<string> = new Set();

/**
 * A linked recipe's steps, as written, each number opening the ingredients it uses (U16), as on
 * the page's own method.
 */
function SubRecipeSteps({
  recipe,
  anchor,
  linked,
  units,
}: {
  recipe: LinkedRecipe;
  /** Makes its steps' element IDs, apart from the page's own "step-1". */
  anchor: string;
  linked: Readonly<Record<string, LinkedRecipe>>;
  units: UnitSystem;
}) {
  const { ingredients, directions } = recipe;
  const uses = useMemo(
    () => usesByStep(ingredients, directions, linked),
    [ingredients, directions, linked],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const scaling = { factor: 1, units, held: AS_WRITTEN_HELD };
  const stepAnchor = (n: number) => `${anchor}-step-${n}`;
  return (
    <ol className={styles.steps}>
      {directions
        .filter((step) => !step.heading)
        .map((step, i) => {
          const used = uses.get(step.id) ?? [];
          const listId = `${anchor}-uses-${i + 1}`;
          return (
            <li key={step.id} id={stepAnchor(i + 1)}>
              <StepNumber
                number={i + 1}
                listId={used.length > 0 ? listId : undefined}
                open={open.has(step.id)}
                onToggle={() => setOpen((now) => toggled(now, step.id))}
              />
              <div className={styles.stepBody}>
                {/* Times start timers here too (U11), named for the linked recipe. */}
                {(
                  stepParts(step.text, (words) => showStep(words, { factor: 1, units })) ?? [
                    { line: showStep(step.text, { factor: 1, units }) },
                  ]
                ).map((part, k) =>
                  "time" in part ? (
                    <TimeLink
                      key={k}
                      time={part.time}
                      stepText={step.text}
                      number={i + 1}
                      recipeTitle={recipe.title}
                      atStep={false}
                    />
                  ) : (
                    <ShownText key={k} line={part.line} />
                  ),
                )}
                {used.length > 0 ? (
                  <StepUsesList
                    id={listId}
                    open={open.has(step.id)}
                    uses={used}
                    step={step}
                    lines={ingredients}
                    steps={directions}
                    scaling={scaling}
                    stepAnchor={stepAnchor}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
    </ol>
  );
}
