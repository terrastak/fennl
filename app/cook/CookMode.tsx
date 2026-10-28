import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { clockText, durationText, stepIngredients, stepTimes } from "../../shared/cook";
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
import { useChecks } from "./checks";
import { turnOnAlerts, useAlertsState, type AlertsState } from "./timerAlerts";
import {
  addMinute,
  alertRunningTimers,
  askForNotifications,
  canAskForNotifications,
  startTimer,
  stopTimer,
  useTimers,
} from "./timers";
import { setWantedOn, useWakeLock, wantedOn, type WakeState } from "./wakeLock";
import styles from "./cook.module.css";

// Cook mode (phase F5): one step at a time in big type, the ingredients each step uses beside it
// (scaled and converted as the recipe page shows them), times that start timers, check-offs kept
// on this device for the day, the screen kept on, and "Made it today?" at the end. A linked
// recipe can be cooked first and comes back here.

/** A step with the section heading it sits under ("For the sauce:"), if any. */
interface Page {
  step: DirectionStep;
  section: string | null;
}

function pagesOf(recipe: Recipe): Page[] {
  let section: string | null = null;
  const pages: Page[] = [];
  for (const step of recipe.directions) {
    if (step.heading) section = step.text;
    else pages.push({ step, section });
  }
  return pages;
}

const WAKE_TEXT: Record<WakeState, string> = {
  on: "Screen stays on",
  off: "Screen may turn off",
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
  const [checks, toggle, clearChecks] = useChecks(id, day);
  const [page, setPage] = useState(0);
  const [wanted, setWanted] = useState(wantedOn);
  const wake = useWakeLock(wanted);
  const heading = useRef<HTMLHeadingElement>(null);
  const [made, setMade] = useState<"no" | "saving" | "saved" | "failed">("no");

  useEffect(() => {
    if (recipe) document.title = `Cooking: ${recipe.title} · Fennl`;
  }, [recipe]);
  // Each page starts at its heading, for screen readers and the keyboard.
  const loaded = recipe !== null;
  useEffect(() => heading.current?.focus(), [page, loaded]);

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
  const pages = pagesOf(recipe);
  const total = pages.length;
  const current = page > 0 ? pages[page - 1] : undefined;
  const last = page === total;
  const uses = stepIngredients(recipe.directions, recipe.ingredients);
  const note = scaling.pans ? bakeNote(recipe, scaling.pans, scaling.factor) : null;

  const go = (to: number) => setPage(Math.max(0, Math.min(total, to)));
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    // Not while typing or choosing (where the arrows already do something).
    if ((event.target as HTMLElement).closest('input:not([type="checkbox"]), select, textarea')) {
      return;
    }
    if (event.key === "ArrowRight") go(page + 1);
    else if (event.key === "ArrowLeft") go(page - 1);
  };

  const madeIt = async () => {
    setMade("saving");
    try {
      await activeSyncClient()?.save({
        kind: "made",
        id: crypto.randomUUID(),
        recipeId: id,
        madeOn: day,
        changedAt: Date.now(),
      });
      setMade("saved");
    } catch {
      setMade("failed");
    }
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
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={checks.ingredients.includes(line.id)}
                onChange={(e) => toggle("ingredients", line.id, e.target.checked)}
              />
              <span>
                <ShownText line={showIngredient(line.text, scaling, scaling.held.has(line.id))} />
              </span>
            </label>
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

  return (
    <main id="main" className={styles.cook} onKeyDown={onKey}>
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
        <Link href={leaveTo} className={styles.leave}>
          {back && parent?.recipe ? `Back to ${parent.recipe.title}` : "Leave cook mode"}
        </Link>
      </header>

      <Timers recipeTitle={recipe.title} />

      <div className={styles.body}>
        {page === 0 ? (
          <section className={styles.step} aria-labelledby="cook-heading">
            <h1 id="cook-heading" ref={heading} tabIndex={-1} className={styles.stepHeading}>
              Get everything ready
            </h1>
            {recipe.ingredients.length > 0 ? (
              ingredientList(recipe.ingredients)
            ) : (
              <p>No ingredients written.</p>
            )}
          </section>
        ) : current ? (
          <>
            <aside className={styles.uses} aria-label="For this step">
              <h2 className={styles.usesHeading}>For this step</h2>
              {(uses.get(current.step.id) ?? []).length > 0 ? (
                ingredientList(uses.get(current.step.id) ?? [])
              ) : (
                <p className={styles.quiet}>Nothing new from the list.</p>
              )}
            </aside>
            <section className={styles.step} aria-labelledby="cook-heading">
              {current.section ? <p className={styles.sectionName}>{current.section}</p> : null}
              <h1 id="cook-heading" ref={heading} tabIndex={-1} className={styles.stepHeading}>
                Step {page} of {total}
              </h1>
              <p className={styles.stepText}>
                <StepText step={current.step} scaling={scaling} recipeTitle={recipe.title} />
              </p>
              {note?.stepId === current.step.id ? <Suggestion text={note.text} /> : null}
              <label className={`${styles.check} ${styles.stepDone}`}>
                <input
                  type="checkbox"
                  checked={checks.steps.includes(current.step.id)}
                  onChange={(e) => toggle("steps", current.step.id, e.target.checked)}
                />
                <span>Done with this step</span>
              </label>
              {last ? (
                <div className={styles.end}>
                  {back && parent?.recipe ? (
                    <Link href={leaveTo} className={styles.primary}>
                      Back to {parent.recipe.title}
                    </Link>
                  ) : null}
                  {made === "saved" ? (
                    <p role="status">Saved: made today. Enjoy it!</p>
                  ) : (
                    <button
                      type="button"
                      className={back ? styles.secondary : styles.primary}
                      disabled={!canEdit(status) || made === "saving"}
                      onClick={() => void madeIt()}
                    >
                      Made it today
                    </button>
                  )}
                  {made === "failed" ? (
                    <p role="alert">Couldn&rsquo;t save that just now. Try again in a moment.</p>
                  ) : null}
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </div>

      <footer className={styles.bottom}>
        <button
          type="button"
          className={styles.secondary}
          disabled={page === 0}
          onClick={() => go(page - 1)}
        >
          Back
        </button>
        <span className={styles.progress} aria-hidden="true">
          {page === 0 ? "Ready" : `${page} / ${total}`}
        </span>
        {last ? (
          <button type="button" className={styles.secondary} onClick={() => navigate(leaveTo)}>
            Finish
          </button>
        ) : (
          <button type="button" className={styles.primary} onClick={() => go(page + 1)}>
            {page === 0 ? "Start" : "Next"}
          </button>
        )}
      </footer>

      <div className={styles.extras}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={wanted}
            onChange={(e) => {
              setWanted(e.target.checked);
              setWantedOn(e.target.checked);
            }}
          />
          <span>Keep the screen on</span>
        </label>
        <p className={styles.quiet} role="status">
          {wanted ? WAKE_TEXT[wake] : "The screen may turn off as usual."}
        </p>
        <button
          type="button"
          className={styles.textButton}
          disabled={checks.ingredients.length === 0 && checks.steps.length === 0}
          onClick={clearChecks}
        >
          Clear all checks
        </button>
      </div>
    </main>
  );
}

/** A step's words, each time in it a button that starts a timer. Amounts scale as on the page. */
function StepText({
  step,
  scaling,
  recipeTitle,
}: {
  step: DirectionStep;
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
        onClick={() => startTimer(time.text, time.seconds, recipeTitle)}
      >
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

function Timers({ recipeTitle }: { recipeTitle: string }) {
  const { timers, now } = useTimers();
  const alerts = useAlertsState();
  if (timers.length === 0) return null;
  return (
    <section className={styles.timers} aria-label="Timers">
      <ul>
        {timers.map((timer) => (
          <li key={timer.id} className={timer.done ? styles.timerDone : styles.timer}>
            <span className={styles.timerLabel}>
              {timer.label}
              {timer.recipeTitle !== recipeTitle ? ` · ${timer.recipeTitle}` : ""}
            </span>
            <span className={styles.timerClock} role={timer.done ? "alert" : undefined}>
              {timer.done ? "Done!" : clockText((timer.endsAt - now) / 1000)}
            </span>
            <button type="button" className={styles.textButton} onClick={() => addMinute(timer.id)}>
              +1 min
            </button>
            <button type="button" className={styles.textButton} onClick={() => stopTimer(timer.id)}>
              {timer.done ? "Dismiss" : "Stop"}
            </button>
            {alerts === "on" && !timer.done && timer.alert === "not-set" ? (
              <p className={styles.timerNote}>
                No alert with the phone locked for this one: Fennl couldn&rsquo;t reach the
                internet. It still rings while Fennl is on screen.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <TimerAlertsOffer state={alerts} />
    </section>
  );
}

/**
 * Under the timers (U8, owner's choices 2026-10-28): the offer to alert with the phone locked,
 * or, in an iPhone or iPad's Safari tab, how to get it.
 */
function TimerAlertsOffer({ state }: { state: AlertsState | null }) {
  const [result, setResult] = useState<"blocked" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [askable, setAskable] = useState(canAskForNotifications);

  if (state === "off") {
    return (
      <>
        <button
          type="button"
          className={styles.textButton}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setResult(null);
            void turnOnAlerts().then((outcome) => {
              setBusy(false);
              if (outcome === "on") alertRunningTimers();
              else setResult(outcome);
            });
          }}
        >
          Alert me when a timer finishes, even with the phone locked
        </button>
        {result ? (
          <p role="alert" className={styles.quiet}>
            {result === "blocked"
              ? "Notifications are turned off for Fennl in this browser’s settings. Allow them there to get timer alerts."
              : "Couldn’t turn on timer alerts. Check your connection and try again."}
          </p>
        ) : null}
      </>
    );
  }
  if (state === "home-screen") {
    return (
      <p className={styles.quiet}>
        For timer alerts with the phone locked, add Fennl to your Home Screen: in Safari, tap Share
        (under &bull;&bull;&bull; beside the address), then Add to Home Screen, and open Fennl from
        its icon.
      </p>
    );
  }
  // A browser that can't get alerts from the server can still show one while it runs Fennl.
  if (state === "unavailable" && askable) {
    return (
      <button
        type="button"
        className={styles.textButton}
        onClick={() => void askForNotifications().then(() => setAskable(false))}
      >
        Tell me when a timer finishes while I&rsquo;m in another app
      </button>
    );
  }
  return null;
}
