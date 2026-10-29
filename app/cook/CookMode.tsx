import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type TouchEvent,
} from "react";
import { durationText, stepIngredients, stepTimes, timerName } from "../../shared/cook";
import { bakeNote, panName } from "../../shared/pans";
import type { DirectionStep, IngredientLine, Recipe } from "../../shared/recipe";
import { showIngredient, showStep } from "../../shared/scale";
import { navigate, queryParam } from "../navigation";
import { localDay } from "../recipes/format";
import { Suggestion } from "../recipes/PanControls";
import { ShownText } from "../recipes/ScaleControls";
import { scaleNote, useScaling, type Scaling } from "../recipes/scaling";
import { Link } from "../router";
import { canEdit } from "../sync/status";
import { activeSyncClient, useRecipe, useSyncStatus } from "../sync/useSync";
import { usePlace } from "./place";
import { TimerButtons, TimersDialog } from "../timers/Timers";
import { openTimers } from "../timers/timersView";
import {
  askForNotifications,
  canAskForNotifications,
  fromText,
  startTimer,
  useTimers,
} from "../timers/timers";
import { useWakeLock, type WakeState } from "./wakeLock";
import styles from "./cook.module.css";

// Cook mode (phase F5, made simpler in U8, owner's choices 2026-10-27): as few taps as possible.
// On a phone (or a tablet held upright): "You'll need", then one step per screen, one tap or
// swipe to move on. On a computer or a tablet on its side: the ingredients always in the left
// column, beside two steps, so the cook can read ahead and look back at the amounts; Next and
// Back move two steps at a time. Each step says which ingredients it uses (scaled and converted
// as the recipe page shows them), times in it start timers that stay at the top, the screen is
// kept on, and the last step's button is "Done · I made it today". Where someone is is kept on
// the device for 12 hours. A linked recipe can be cooked first and comes back here.

/** A step with the section heading it sits under ("For the sauce:"), if any. */
interface CookStep {
  step: DirectionStep;
  section: string | null;
}

function stepsOf(recipe: Recipe): CookStep[] {
  let section: string | null = null;
  const steps: CookStep[] = [];
  for (const step of recipe.directions) {
    if (step.heading) section = step.text;
    else steps.push({ step, section });
  }
  return steps;
}

/** Wide enough for the ingredients beside two steps: a computer, or a tablet on its side. */
const WIDE = "(min-width: 900px) and (orientation: landscape)";

function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * An ingredient as a step mentions it: the words before its first comma ("2 lb pork shoulder",
 * not ", cut into 1-inch cubes"); the whole line is in "You'll need".
 */
const shortLine = (text: string) => text.split(", ")[0] ?? text;

/** Steps shown together on a wide screen. */
const PER_SCREEN = 2;

/** "Step 5" or "Steps 3–4" (counting from 1). */
const stepsName = (from: number, to: number) =>
  from === to ? `Step ${from + 1}` : `Steps ${from + 1}–${to + 1}`;

/** Said only when the screen can't be kept on: then the person knows to change Auto-Lock. */
const WAKE_TEXT: Partial<Record<WakeState, string>> = {
  unsupported:
    "This browser can't keep the screen on. Set your device's Auto-Lock to a longer time while you cook.",
  refused:
    "The device didn't let Fennl keep the screen on (Low Power Mode or a low battery can stop it). Set Auto-Lock to a longer time while you cook.",
};

export function CookMode({ id }: { id: string }) {
  const detail = useRecipe(id);
  const status = useSyncStatus();
  const back = queryParam("back");
  const parent = useRecipe(back ?? id);
  const recipe = detail?.recipe ?? null;
  const scaling = useScaling(recipe);
  const day = localDay();
  const wide = useWide();
  const [place, setPlace] = usePlace(id);
  const wake = useWakeLock(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [made, setMade] = useState<"no" | "saving" | "failed">("no");

  useEffect(() => {
    if (recipe) document.title = `Cooking: ${recipe.title} · Fennl`;
  }, [recipe]);

  const steps = recipe ? stepsOf(recipe) : [];
  const total = steps.length;
  // The first step shown: on a wide screen, always the first of a pair, and never "You'll need"
  // (the ingredients are always there).
  const clamped = Math.max(-1, Math.min(total - 1, place));
  const first = wide ? Math.max(0, clamped - (Math.max(0, clamped) % PER_SCREEN)) : clamped;
  const lastShown = wide ? Math.min(total - 1, first + PER_SCREEN - 1) : first;
  const atEnd = lastShown >= total - 1;
  const atStart = wide ? first <= 0 : first < 0;

  // Each screen starts at its heading, for screen readers and the keyboard.
  const loaded = recipe !== null;
  useEffect(() => heading.current?.focus(), [first, wide, loaded]);

  if (detail === undefined) {
    return (
      <p role="status" className="visually-hidden">
        Opening the recipe…
      </p>
    );
  }
  if (!detail || !recipe || recipe.deletedAt) {
    return (
      <main id="main" className={styles.cook}>
        <h1>This recipe isn&rsquo;t here</h1>
        <p>
          <Link href="/">All recipes</Link>
        </p>
      </main>
    );
  }

  const leaveTo = back ? `/recipes/${back}/cook` : `/recipes/${id}`;
  const parentTitle = back ? parent?.recipe?.title : undefined;
  const uses = stepIngredients(recipe.directions, recipe.ingredients);
  const note = scaling.pans ? bakeNote(recipe, scaling.pans, scaling.factor) : null;
  const step = wide ? PER_SCREEN : 1;

  const forward = () => {
    if (!atEnd) setPlace(wide ? first + PER_SCREEN : first + 1);
  };
  const backward = () => {
    if (!atStart) setPlace(wide ? Math.max(0, first - PER_SCREEN) : first - 1);
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("input, select, textarea")) return;
    if (event.key === "ArrowRight") forward();
    else if (event.key === "ArrowLeft") backward();
  };
  // A swipe across the screen moves on or back, like turning a page.
  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const from = swipe.current;
    const touch = event.changedTouches[0];
    swipe.current = null;
    if (!from || !touch) return;
    const dx = touch.clientX - from.x;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(touch.clientY - from.y) * 1.5) return;
    if (dx < 0) forward();
    else backward();
  };

  // The last button: done, and (cooking the recipe itself) made today, in one tap.
  const markMade = !back && canEdit(status);
  const finish = async () => {
    if (!markMade) return navigate(leaveTo);
    setMade("saving");
    try {
      await activeSyncClient()?.save({
        kind: "made",
        id: crypto.randomUUID(),
        recipeId: id,
        madeOn: day,
        changedAt: Date.now(),
      });
      setPlace(-1);
      navigate(leaveTo);
    } catch {
      setMade("failed");
    }
  };
  const close = () => {
    setPlace(-1);
    navigate(leaveTo);
  };

  const ingredientList = (lines: readonly IngredientLine[]) => (
    <ul className={styles.ingredients}>
      {lines.map((line) =>
        line.heading ? (
          <li key={line.id} className={styles.section}>
            {line.text}
          </li>
        ) : (
          <li key={line.id}>
            <ShownText line={showIngredient(line.text, scaling, scaling.held.has(line.id))} />
            {line.linkedRecipeId && detail.linked[line.linkedRecipeId]?.status === "ok" ? (
              <Link
                className={styles.cookFirst}
                href={`/recipes/${line.linkedRecipeId}/cook?back=${id}`}
              >
                Cook {detail.linked[line.linkedRecipeId]?.title} first
              </Link>
            ) : null}
          </li>
        ),
      )}
    </ul>
  );

  const youllNeed = (headingLevel: "h1" | "h2") => {
    const Heading = headingLevel;
    return (
      <section className={styles.need} aria-labelledby="need-heading">
        <Heading
          id="need-heading"
          ref={headingLevel === "h1" ? heading : undefined}
          tabIndex={headingLevel === "h1" ? -1 : undefined}
          className={styles.needHeading}
        >
          You&rsquo;ll need
        </Heading>
        {recipe.ingredients.length > 0 ? (
          ingredientList(recipe.ingredients)
        ) : (
          <p className={styles.quiet}>No ingredients written.</p>
        )}
      </section>
    );
  };

  const stepColumn = (index: number) => {
    const shown = steps[index];
    if (!shown) return null;
    const used = (uses.get(shown.step.id) ?? []).filter((line) => !line.heading);
    return (
      <section key={shown.step.id} className={styles.step} aria-labelledby={`step-${index}`}>
        {shown.section ? <p className={styles.sectionName}>{shown.section}</p> : null}
        <h2 id={`step-${index}`} className={styles.stepNumber}>
          Step {index + 1} of {total}
        </h2>
        {used.length > 0 ? (
          <p className={styles.uses}>
            Uses{" "}
            {used.map((line, i) => (
              <span key={line.id}>
                {i > 0 ? " · " : ""}
                <ShownText
                  line={showIngredient(shortLine(line.text), scaling, scaling.held.has(line.id))}
                />
              </span>
            ))}
          </p>
        ) : null}
        <p className={styles.stepText}>
          <StepText
            step={shown.step}
            number={index + 1}
            scaling={scaling}
            recipeTitle={recipe.title}
          />
        </p>
        {note?.stepId === shown.step.id ? <Suggestion text={note.text} /> : null}
      </section>
    );
  };

  const shownSteps =
    first < 0 ? [] : Array.from({ length: lastShown - first + 1 }, (_, i) => first + i);
  const nextFrom = first + step;
  const nextName = wide
    ? stepsName(nextFrom, Math.min(total - 1, nextFrom + PER_SCREEN - 1))
    : null;
  const backFrom = Math.max(0, first - PER_SCREEN);
  const doneLabel = back
    ? `Done · Back to ${parentTitle ?? "the recipe"}`
    : markMade
      ? "Done · I made it today"
      : "Done";

  return (
    <main
      id="main"
      className={wide ? `${styles.cook} ${styles.wide}` : styles.cook}
      onKeyDown={onKey}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <header className={styles.top}>
        <p className={styles.title}>{recipe.title}</p>
        {scaling.active ? (
          <p className={styles.scaled}>
            {scaleNote(
              scaling.factor,
              scaling.units,
              scaling.pans ? panName(scaling.pans.yours) : null,
            ).replace(/:.*$/u, "")}
          </p>
        ) : null}
        <button
          type="button"
          className={styles.newTimer}
          aria-haspopup="dialog"
          onClick={openTimers}
        >
          <span aria-hidden="true">⏱ </span>Timer
        </button>
        <Link
          href={leaveTo}
          className={styles.leave}
          aria-label={parentTitle ? `Back to ${parentTitle}` : "Leave cook mode"}
        >
          <span aria-hidden="true">✕</span>
        </Link>
      </header>
      {total > 0 ? (
        <div className={styles.bar} aria-hidden="true">
          <i style={{ width: `${first < 0 ? 0 : ((lastShown + 1) / total) * 100}%` }} />
        </div>
      ) : null}
      {WAKE_TEXT[wake] ? (
        <p className={styles.quiet} role="status">
          {WAKE_TEXT[wake]}
        </p>
      ) : null}

      <Timers recipeTitle={recipe.title} />
      <TimersDialog />

      {wide ? (
        <div className={styles.columns}>
          {youllNeed("h2")}
          <h1 ref={heading} tabIndex={-1} className="visually-hidden">
            {total > 0 ? `${stepsName(first, lastShown)} of ${total}` : recipe.title}
          </h1>
          {shownSteps.map(stepColumn)}
        </div>
      ) : first < 0 ? (
        <div className={styles.body}>{youllNeed("h1")}</div>
      ) : (
        <div className={styles.body}>
          <h1 ref={heading} tabIndex={-1} className="visually-hidden">
            Step {first + 1} of {total}
          </h1>
          {stepColumn(first)}
        </div>
      )}

      <footer className={styles.bottom}>
        {wide ? (
          <button type="button" className={styles.secondary} disabled={atStart} onClick={backward}>
            ‹ Back{atStart ? "" : ` · ${stepsName(backFrom, Math.min(total - 1, first - 1))}`}
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.secondary} ${styles.backArrow}`}
            aria-label="Back"
            disabled={atStart}
            onClick={backward}
          >
            ‹
          </button>
        )}
        <div className={styles.forward}>
          {atEnd && total > 0 && first >= 0 ? (
            <>
              <button
                type="button"
                className={styles.primary}
                disabled={made === "saving"}
                onClick={() => void finish()}
              >
                {made === "saving" ? "Saving…" : doneLabel}
              </button>
              {markMade ? (
                <button type="button" className={styles.textButton} onClick={close}>
                  Close without marking it made
                </button>
              ) : null}
              {made === "failed" ? (
                <p role="alert" className={styles.quiet}>
                  Couldn&rsquo;t save that just now. Try again in a moment.
                </p>
              ) : null}
            </>
          ) : total === 0 ? (
            <button type="button" className={styles.primary} onClick={close}>
              Done
            </button>
          ) : (
            <button type="button" className={styles.primary} onClick={forward}>
              {first < 0
                ? `Start · Step 1 of ${total}`
                : wide
                  ? `Next · ${nextName} ›`
                  : "Next step"}
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}

/** A step's words, each time in it a button that starts a timer. Amounts scale as on the page. */
function StepText({
  step,
  number,
  scaling,
  recipeTitle,
}: {
  step: DirectionStep;
  /** The step's number, which its timers carry ("Step 4 · Green Chile Stew"). */
  number: number;
  scaling: Scaling;
  recipeTitle: string;
}) {
  const times = stepTimes(step.text);
  const parts: React.ReactNode[] = [];
  let at = 0;
  times.forEach((time, i) => {
    if (time.start > at) {
      parts.push(
        <ShownText key={`t${i}`} line={showStep(step.text.slice(at, time.start), scaling)} />,
      );
    }
    parts.push(
      <button
        key={`b${i}`}
        type="button"
        className={styles.timeButton}
        aria-label={`Start a ${durationText(time.seconds)} timer`}
        onClick={() =>
          startTimer(timerName(step.text, time, times), time.seconds, recipeTitle, {
            step: number,
          })
        }
      >
        <span aria-hidden="true">⏱ </span>
        {time.text}
      </button>,
    );
    at = time.end;
  });
  if (at < step.text.length) {
    parts.push(<ShownText key="end" line={showStep(step.text.slice(at), scaling)} />);
  }
  return <>{parts}</>;
}

/**
 * Running timers, at the top on every screen, each with Pause and Stop; tapping its time
 * changes it (U9). The question about alerts in another app comes with the first timer.
 */
function Timers({ recipeTitle }: { recipeTitle: string }) {
  const { timers, now } = useTimers();
  const [askable, setAskable] = useState(canAskForNotifications);
  if (timers.length === 0) return null;
  return (
    <section className={styles.timers} aria-label="Timers">
      <ul>
        {timers.map((timer) => (
          <li key={timer.id} className={timer.done ? styles.timerDone : styles.timer}>
            <span className={styles.timerLabel}>
              <span aria-hidden="true">⏱ </span>
              {timer.label}
              {timer.recipeTitle !== recipeTitle
                ? ` · ${fromText(timer)}`
                : timer.step
                  ? ` · Step ${timer.step}`
                  : ""}
            </span>
            <TimerButtons timer={timer} now={now} />
          </li>
        ))}
      </ul>
      {askable ? (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => void askForNotifications().then(() => setAskable(false))}
        >
          Tell me when a timer finishes while I&rsquo;m in another app
        </button>
      ) : null}
    </section>
  );
}
