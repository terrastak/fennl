import { durationText, type StepTime } from "../../shared/cook";
import { startTimer } from "./timers";
import styles from "./timers.module.css";

// A time in a recipe's method, on the recipe page (U11, owner's request 2026-10-29): read as
// part of the step, with a small ⏱ and a dashed underline, and a tap starts a timer for it. Kept
// quiet on purpose: it mustn't stand out more than it needs to or get in the way of reading
// (cook mode's are bigger buttons, for a kitchen).

export function TimeLink({
  time,
  number,
  recipeTitle,
}: {
  time: StepTime;
  /** The step's number, which names the timer ("Step 4 · 25 minutes"), as cook mode does. */
  number: number;
  recipeTitle: string;
}) {
  return (
    <button
      type="button"
      className={styles.timeLink}
      aria-label={`Start a ${durationText(time.seconds)} timer`}
      onClick={() => startTimer(`Step ${number} · ${time.text}`, time.seconds, recipeTitle)}
    >
      <span aria-hidden="true" className={styles.timeIcon}>
        ⏱
      </span>
      {time.text}
    </button>
  );
}
