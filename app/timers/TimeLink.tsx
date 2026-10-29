import { durationText, timerName, type StepTime } from "../../shared/cook";
import styles from "./timers.module.css";
import { showView } from "./timersView";

// A time in a recipe's method, on the recipe page (U11, owner's request 2026-10-29): read as
// part of the step, with a small ⏱ and a dashed underline. Kept quiet on purpose: it mustn't stand
// out more than it needs to or get in the way of reading (cook mode's are bigger buttons, for a
// kitchen). A tap asks before it starts a timer (owner's choice 2026-10-29, as the earlier Fennl
// did): named from the step, with either end of a range to pick.

export function TimeLink({
  time,
  stepText,
  number,
  recipeTitle,
  atStep = true,
}: {
  time: StepTime;
  /** The step's words, which name the timer ("Bake"). */
  stepText: string;
  /** The step's number: "Step 4 · Banana bread". */
  number: number;
  recipeTitle: string;
  /** Whether View step and the alert can open this page at the step (not a linked recipe's). */
  atStep?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.timeLink}
      aria-label={`Start a ${durationText(time.seconds)} timer`}
      aria-haspopup="dialog"
      onClick={() =>
        showView({
          kind: "start",
          offer: {
            name: timerName(stepText, time),
            seconds: time.seconds,
            ...(time.upTo ? { upTo: time.upTo } : {}),
            recipeTitle,
            step: number,
            path: `${window.location.pathname}${atStep ? `#step-${number}` : ""}`,
          },
        })
      }
    >
      <span aria-hidden="true" className={styles.timeIcon}>
        ⏱
      </span>
      {time.text}
    </button>
  );
}
