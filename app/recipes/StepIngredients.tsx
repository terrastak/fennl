import type { DirectionStep, IngredientLine } from "../../shared/recipe";
import type { ShowOptions } from "../../shared/scale";
import type { StepUse } from "../../shared/stepIngredients";
import { markStep } from "../timers/timersView";
import { ShownText } from "./ScaleControls";
import { shownUses } from "./stepUses";
import styles from "./recipes.module.css";

// Each step's ingredients on the recipe page (U16, owner's choices 2026-11-04): the step's
// number, in a soft circle with a small caret, opens a plain list under the step. All closed
// when a recipe opens; nothing about it is kept.

/**
 * A step's number. When Fennl found ingredients for the step, it's the button that shows them,
 * with a caret pointing down while closed and up while open; otherwise just the number.
 */
export function StepNumber({
  number,
  listId,
  open,
  onToggle,
}: {
  number: number;
  /** The list it opens; none when the step has no ingredients to show. */
  listId?: string | undefined;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <span className={styles.stepMark}>
      {listId && onToggle ? (
        <button
          type="button"
          className={styles.stepNumber}
          aria-expanded={!!open}
          aria-controls={listId}
          onClick={onToggle}
        >
          <span className="visually-hidden">Ingredients for step </span>
          {number}
          <span className={styles.stepCaret} aria-hidden="true">
            <svg
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 3.5 5 6.5 8 3.5" />
            </svg>
          </span>
        </button>
      ) : (
        <span className={styles.stepNumber}>{number}</span>
      )}
    </span>
  );
}

/**
 * The step's ingredients, a plain list under its words: amounts scaled, converted and
 * highlighted as on the rest of the page, and Fennl's doubt said in words.
 */
export function StepUsesList({
  id,
  open,
  uses,
  step,
  lines,
  steps,
  scaling,
  stepAnchor,
}: {
  id: string;
  open: boolean;
  uses: readonly StepUse[];
  step: DirectionStep;
  lines: readonly IngredientLine[];
  steps: readonly DirectionStep[];
  scaling: ShowOptions & { held: ReadonlySet<string> };
  /** The element ID of step `number` (counting from 1), for "from step 1". */
  stepAnchor: (number: number) => string;
}) {
  const rows = open ? shownUses(uses, { step, lines, steps, scaling, capital: true }) : [];
  return (
    <ul id={id} className={styles.stepUses} hidden={!open}>
      {rows.map((row) => (
        <li key={row.key}>
          <ShownText line={row.line} />
          {row.from ? (
            <>
              {" "}
              <FromStep anchor={stepAnchor(row.from.number)} number={row.from.number} />
            </>
          ) : null}
          {row.unsure ? (
            <span className={styles.unsure}>
              <span className={styles.unsureMark} aria-hidden="true">
                ?
              </span>
              {row.unsure.long}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** "from step 1": back to that step, in view and marked for a moment, as a timer's View step. */
function FromStep({ anchor, number }: { anchor: string; number: number }) {
  return (
    <button
      type="button"
      className={styles.fromStep}
      onClick={() => {
        if (!markStep(anchor)) return;
        // Focus moves there too, for the keyboard and screen readers: the step takes it only
        // for now, so a tap in a step's words doesn't move focus to the whole step.
        const target = document.getElementById(anchor);
        if (!target) return;
        target.tabIndex = -1;
        target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
        target.focus({ preventScroll: true });
      }}
    >
      from step {number}
    </button>
  );
}
