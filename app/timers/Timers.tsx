import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { clockText, durationText } from "../../shared/cook";
import { alertNeeds } from "../../shared/timerAlerts";
import { Link } from "../router";
import { turnOnAlerts, useAlertsState, type AlertsState } from "./timerAlerts";
import {
  addMinute,
  alertRunningTimers,
  askForNotifications,
  canAskForNotifications,
  fromText,
  pauseTimer,
  resumeTimer,
  setTimeLeft,
  startTimer,
  stopTimer,
  timeLeft,
  useTimers,
  type Timer,
} from "./timers";
import styles from "./timers.module.css";
import { openTimers, showView, useView, viewStep, type StartOffer } from "./timersView";

// Timers anywhere in the app (U9), laid out as the earlier Fennl had them (owner's choices
// 2026-10-29, from its screenshots): a Timers panel from the right (the whole width on a phone),
// opened from the sidebar's Timers button (the ⏱ in a phone's top bar), a corner card or cook
// mode. Each timer has View step, Pause or Resume, Adjust time, +1 minute and Cancel; Add timer
// starts one of one's own. Adjust time leaves the timer running until Save time sets the new
// time. A time in a recipe's method asks before it starts a timer, with either end of a range to
// pick. Running timers show as cards in the corner of a wide screen,
// each with a ring for how much is left and its own Pause and Stop. A tap outside closes it all.

/** The Timers panel, or a step's "Start a timer?". Mounted once on every screen with timers. */
export function TimersDialog() {
  const current = useView();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { timers, now } = useTimers();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (current && !element.open) element.showModal();
    if (!current && element.open) element.close();
  }, [current]);

  const adjusting =
    current?.kind === "adjust" ? timers.find((t) => t.id === current.id) : undefined;
  // From the list, back to it; opened on its own (cook mode), closed.
  const back = () =>
    showView(current?.kind === "adjust" && !current.fromList ? null : { kind: "list" });

  // A tap or click outside (on the dimmed page) closes it, like Escape: pressed and let go
  // outside, so a drag that starts in a number and ends outside doesn't.
  const pressedOutside = useRef(false);
  const outside = (event: PointerEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return false;
    const box = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  };

  return (
    <dialog
      ref={dialog}
      className={current?.kind === "start" ? styles.startDialog : styles.dialog}
      aria-labelledby={titleId}
      onClose={() => showView(null)}
      onPointerDown={(event) => {
        pressedOutside.current = outside(event);
      }}
      onPointerUp={(event) => {
        if (pressedOutside.current && outside(event)) showView(null);
        pressedOutside.current = false;
      }}
    >
      {current?.kind === "start" ? (
        <StartFromStep key={current.offer.path} offer={current.offer} titleId={titleId} />
      ) : current?.kind === "adjust" && adjusting ? (
        <AdjustTime key={adjusting.id} timer={adjusting} titleId={titleId} onDone={back} />
      ) : current?.kind === "add" ? (
        <AddTimer titleId={titleId} />
      ) : current ? (
        <TimerList timers={timers} now={now} titleId={titleId} />
      ) : null}
    </dialog>
  );
}

/** The panel's top: a small heading over the title, then its buttons. */
function PanelHead({
  eyebrow,
  title,
  titleId,
  children,
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  children: React.ReactNode;
}) {
  return (
    <header className={styles.panelHead}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 id={titleId} className={styles.panelTitle}>
          {title}
        </h2>
      </div>
      <div className={styles.headButtons}>{children}</div>
    </header>
  );
}

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.close} aria-label={label} onClick={onClick}>
      <span aria-hidden="true">×</span>
    </button>
  );
}

/** Every timer, finished ones first, then the soonest to end. */
function TimerList({ timers, now, titleId }: { timers: Timer[]; now: number; titleId: string }) {
  const alerts = useAlertsState();
  const ordered = [...timers].sort((a, b) =>
    a.done !== b.done ? (a.done ? -1 : 1) : timeLeft(a, now) - timeLeft(b, now),
  );
  return (
    <div className={styles.panel}>
      <PanelHead eyebrow="Keep cooking" title="Timers" titleId={titleId}>
        <button type="button" className={styles.primary} onClick={() => showView({ kind: "add" })}>
          Add timer
        </button>
        <CloseButton label="Close timers" onClick={() => showView(null)} />
      </PanelHead>
      <div className={styles.panelBody}>
        {ordered.length === 0 ? (
          <p className={styles.empty}>
            No timers running. Add one of your own here, or tap a time in a recipe&rsquo;s method.
          </p>
        ) : (
          <ul className={styles.list}>
            {ordered.map((timer) => (
              <li key={timer.id} className={timer.done ? styles.rowDone : styles.row}>
                <div className={styles.rowTop}>
                  <div>
                    <strong className={styles.rowName}>
                      {timer.done ? "Finished: " : ""}
                      {timer.label}
                    </strong>
                    <p className={styles.eyebrow}>
                      {fromText(timer)}
                      {timer.pausedLeft !== null ? " · paused" : ""}
                    </p>
                  </div>
                  <span
                    className={timer.pausedLeft !== null ? styles.rowTimePaused : styles.rowTime}
                  >
                    {clockText(timeLeft(timer, now) / 1000)}
                  </span>
                </div>
                <div className={styles.rowButtons}>
                  {timer.path && timer.recipeTitle ? (
                    <button type="button" className={styles.pill} onClick={() => viewStep(timer)}>
                      View step<span className="visually-hidden"> for {timer.label}</span>
                    </button>
                  ) : null}
                  {timer.done ? (
                    <>
                      <button
                        type="button"
                        className={styles.pill}
                        onClick={() => addMinute(timer.id)}
                      >
                        +1 minute<span className="visually-hidden"> on {timer.label}</span>
                      </button>
                      <span className={styles.spacer} />
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => stopTimer(timer.id)}
                      >
                        Dismiss<span className="visually-hidden"> {timer.label}</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {timer.pausedLeft !== null ? (
                        <button
                          type="button"
                          className={styles.pill}
                          onClick={() => resumeTimer(timer.id)}
                        >
                          Resume<span className="visually-hidden"> {timer.label}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.pill}
                          onClick={() => pauseTimer(timer.id)}
                        >
                          Pause<span className="visually-hidden"> {timer.label}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.pill}
                        onClick={() => showView({ kind: "adjust", id: timer.id, fromList: true })}
                      >
                        Adjust time<span className="visually-hidden"> for {timer.label}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.pill}
                        onClick={() => addMinute(timer.id)}
                      >
                        +1 minute<span className="visually-hidden"> on {timer.label}</span>
                      </button>
                      <span className={styles.spacer} />
                      <button
                        type="button"
                        className={styles.cancel}
                        onClick={() => stopTimer(timer.id)}
                      >
                        Cancel<span className="visually-hidden"> {timer.label}</span>
                      </button>
                    </>
                  )}
                </div>
                {alerts === "on" &&
                !timer.done &&
                timer.pausedLeft === null &&
                timer.alert === "not-set" ? (
                  <p className={styles.note}>
                    No notification for this one: Fennl couldn&rsquo;t reach the internet. It still
                    rings while Fennl is on screen.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {timers.length > 0 ? <TimerAlertsOffer state={alerts} /> : null}
      </div>
    </div>
  );
}

/** The longest a timer can be set to: 23:59:59. */
const LONGEST = 24 * 60 * 60 - 1;
const UNITS = [
  { part: "h", label: "Hours", one: "hour", seconds: 3600, max: 23 },
  { part: "m", label: "Minutes", one: "minute", seconds: 60, max: 59 },
  { part: "s", label: "Seconds", one: "second", seconds: 1, max: 59 },
] as const;

/**
 * Hours, minutes and seconds, each typed or moved one at a time with its ▲ and ▼ (owner's
 * choice 2026-10-29: Fennl's own arrows, since a phone's browser shows none).
 */
function DurationFields({
  legend,
  seconds,
  onChange,
  onFocus,
  onBlur,
  onEnter,
  hint,
}: {
  legend: string;
  seconds: number;
  onChange: (seconds: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onEnter?: () => void;
  hint?: React.ReactNode;
}) {
  const id = useId();
  const parts = {
    h: Math.floor(seconds / 3600),
    m: Math.floor((seconds % 3600) / 60),
    s: seconds % 60,
  };
  const set = (part: "h" | "m" | "s", value: number) => {
    const next = { ...parts, [part]: value };
    onChange(Math.min(LONGEST, next.h * 3600 + next.m * 60 + next.s));
  };
  return (
    <fieldset className={styles.duration}>
      <legend>{legend}</legend>
      <div className={styles.fields}>
        {UNITS.map((unit) => (
          <span key={unit.part} className={styles.field}>
            <label htmlFor={`${id}-${unit.part}`}>{unit.label}</label>
            <span className={styles.numberBox}>
              <input
                id={`${id}-${unit.part}`}
                className={styles.number}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={String(parts[unit.part])}
                onFocus={(event) => {
                  event.currentTarget.select();
                  onFocus?.();
                }}
                onBlur={onBlur}
                onChange={(event) =>
                  set(
                    unit.part,
                    Math.min(unit.max, Number(event.target.value.replace(/\D/g, "")) || 0),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") onEnter?.();
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    const step = event.key === "ArrowUp" ? unit.seconds : -unit.seconds;
                    onChange(Math.max(0, Math.min(LONGEST, seconds + step)));
                  }
                }}
              />
              <span className={styles.arrows}>
                <button
                  type="button"
                  aria-label={`One more ${unit.one}`}
                  disabled={seconds + unit.seconds > LONGEST}
                  onClick={() => onChange(Math.min(LONGEST, seconds + unit.seconds))}
                >
                  <svg viewBox="0 0 10 6" aria-hidden="true">
                    <path d="M1 5l4-4 4 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={`One less ${unit.one}`}
                  disabled={seconds < unit.seconds}
                  onClick={() => onChange(seconds - unit.seconds)}
                >
                  <svg viewBox="0 0 10 6" aria-hidden="true">
                    <path d="M1 1l4 4 4-4" />
                  </svg>
                </button>
              </span>
            </span>
          </span>
        ))}
      </div>
      {hint ? <p className={styles.fieldHint}>{hint}</p> : null}
    </fieldset>
  );
}

/**
 * Adjust time (as the earlier Fennl had it; owner's choice 2026-10-29: the timer keeps running
 * throughout). The time left counts on above; the hours, minutes and seconds follow it until one
 * is changed, then hold the new time. Save time starts the timer again from there (or holds it
 * there, if it was paused); Cancel (a tap outside, Escape, ×) leaves it as it is.
 */
function AdjustTime({
  timer,
  titleId,
  onDone,
}: {
  timer: Timer;
  titleId: string;
  onDone: () => void;
}) {
  const { now } = useTimers();
  const left = Math.ceil(timeLeft(timer, now) / 1000);
  // The new time (null: nothing changed yet, so the numbers follow the timer).
  const [draft, setDraft] = useState<number | null>(null);
  const paused = timer.pausedLeft !== null;
  const shown = draft ?? left;
  const save = () => {
    if (shown <= 0) return;
    if (draft !== null) setTimeLeft(timer.id, draft, !paused);
    onDone();
  };

  return (
    <div className={styles.panel}>
      <PanelHead eyebrow={fromText(timer)} title="Adjust time" titleId={titleId}>
        <CloseButton label="Cancel time adjustment" onClick={onDone} />
      </PanelHead>
      <div className={styles.panelBody}>
        <strong className={styles.adjustName}>{timer.label}</strong>
        <div className={timer.done ? styles.statusHeld : styles.status}>
          <span role="status">
            {timer.done ? "Timer finished" : paused ? "Timer is paused" : "Time remaining"}
          </span>
          <span className={styles.statusTime}>{clockText(left)}</span>
        </div>
        <DurationFields
          legend="Set remaining time"
          seconds={shown}
          onChange={(seconds) => setDraft(Math.max(0, seconds))}
          onEnter={save}
          hint={
            draft === null
              ? "Change any field, then Save time to set the timer to it."
              : `The timer keeps ${paused ? "its time" : "running"} until you tap Save time; then it ${paused ? "is set to" : "starts again from"} ${clockText(draft)}.`
          }
        />
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onDone}>
            Cancel
          </button>
          <button type="button" className={styles.primary} disabled={shown <= 0} onClick={save}>
            Save time
          </button>
        </div>
      </div>
    </div>
  );
}

/** Quick lengths for a timer of one's own, in minutes (U9's one-tap timers). */
const PRESETS = [1, 3, 5, 10, 15, 30, 60];

/** Add timer: a name if wanted, and any length. */
function AddTimer({ titleId }: { titleId: string }) {
  const [name, setName] = useState("");
  const [seconds, setSeconds] = useState(0);
  const nameId = useId();
  const back = () => showView({ kind: "list" });
  const start = () => {
    if (seconds <= 0) return;
    startTimer(name.trim() || "Timer", seconds, null);
    back();
  };
  return (
    <div className={styles.panel}>
      <PanelHead eyebrow="Any length" title="Add timer" titleId={titleId}>
        <CloseButton label="Cancel adding a timer" onClick={back} />
      </PanelHead>
      <div className={styles.panelBody}>
        <label htmlFor={nameId} className={styles.nameLabel}>
          Timer name <small>(optional)</small>
        </label>
        <input
          id={nameId}
          className={styles.nameInput}
          placeholder="Pasta water"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
        <DurationFields
          legend="Set duration"
          seconds={seconds}
          onChange={setSeconds}
          onEnter={start}
        />
        <div className={styles.presets} role="group" aria-label="Quick lengths">
          {PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className={styles.chip}
              aria-pressed={seconds === minutes * 60}
              onClick={() => setSeconds(minutes * 60)}
            >
              {minutes === 60 ? "1 hr" : `${minutes} min`}
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={back}>
            Cancel
          </button>
          <button type="button" className={styles.primary} disabled={seconds <= 0} onClick={start}>
            Start timer
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A time in a recipe's method, tapped (owner's choice 2026-10-29): "Start a timer for 9 minutes?",
 * named from the step, either end of a range to pick, and the time to change before it starts.
 */
function StartFromStep({ offer, titleId }: { offer: StartOffer; titleId: string }) {
  const [seconds, setSeconds] = useState(offer.seconds);
  const rangeId = useId();
  const start = () => {
    if (seconds <= 0) return;
    startTimer(offer.name, seconds, offer.recipeTitle, { step: offer.step, path: offer.path });
    showView(null);
  };
  return (
    <div className={styles.start}>
      <p className={styles.eyebrow}>
        {fromText({ recipeTitle: offer.recipeTitle, step: offer.step })}
      </p>
      <h2 id={titleId} className={styles.startTitle}>
        Start a timer for {durationText(seconds)}?
      </h2>
      <p className={styles.startName}>{offer.name}</p>
      {offer.upTo ? (
        <fieldset className={styles.range}>
          <legend>Choose a duration</legend>
          {[offer.seconds, offer.upTo].map((length) => (
            <label key={length}>
              <input
                type="radio"
                name={rangeId}
                checked={seconds === length}
                onChange={() => setSeconds(length)}
              />
              {durationText(length)}
            </label>
          ))}
        </fieldset>
      ) : null}
      <DurationFields
        legend="Set timer duration"
        seconds={seconds}
        onChange={setSeconds}
        onEnter={start}
        hint={`Suggested duration: ${durationText(offer.seconds)}. Change any field to use your own time.`}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => showView(null)}>
          Cancel
        </button>
        <button type="button" className={styles.primary} disabled={seconds <= 0} onClick={start}>
          Start timer
        </button>
      </div>
    </div>
  );
}

/**
 * Under the timers (U10, owner's choices 2026-10-28): the offer to alert with the phone locked,
 * or, in an iPhone or iPad's Safari tab, how to get it. A browser that can't take alerts from the
 * server can still show one while it runs Fennl. On a computer whose browser must stay running
 * for alerts to arrive, a line says so (owner's choice 2026-10-29), pointing to Settings.
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
          className={styles.quiet}
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
          Notify me when a timer finishes, even when Fennl isn&rsquo;t on screen
        </button>
        <p className={styles.hint}>
          Uses this device&rsquo;s notifications; your browser may ask first.
        </p>
        {result ? (
          <p role="alert" className={styles.hint}>
            {result === "blocked"
              ? "Notifications are turned off for Fennl in this browser’s settings. Allow them there to get timer notifications."
              : "Couldn’t turn on timer notifications. Check your connection and try again."}
          </p>
        ) : null}
        <RunningNote />
      </>
    );
  }
  if (state === "on") return <RunningNote />;
  if (state === "home-screen") {
    return (
      <p className={styles.hint}>
        For timer notifications with the phone locked, add Fennl to your Home Screen: in Safari, tap
        Share (under &bull;&bull;&bull; beside the address), then Add to Home Screen, and open Fennl
        from its icon.
      </p>
    );
  }
  if (state === "unavailable" && askable) {
    return (
      <button
        type="button"
        className={styles.quiet}
        onClick={() => void askForNotifications().then(() => setAskable(false))}
      >
        Tell me when a timer finishes while I&rsquo;m in another app
      </button>
    );
  }
  return null;
}

/** "Notifications arrive only while Chrome is running", on a computer where that's so. */
function RunningNote() {
  const [needs] = useState(() => alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1));
  if (needs.kind !== "browser-running") return null;
  return (
    <p className={styles.hint}>
      Notifications arrive only while {needs.browser} is running. More in{" "}
      <Link href="/settings#timer-notifications" onClick={() => showView(null)}>
        Settings › Timer notifications
      </Link>
      .
    </p>
  );
}

/**
 * A timer's time and buttons in cook mode's list: the time opens Adjust time; running ones have
 * Pause (Resume when paused) and Stop; a rung one has +1 min and Dismiss.
 */
export function TimerButtons({ timer, now }: { timer: Timer; now: number }) {
  const left = clockText(timeLeft(timer, now) / 1000);
  if (timer.done) {
    return (
      <span className={styles.buttons}>
        <span className={styles.clockDone} role="alert">
          Done!
        </span>
        <button type="button" className={styles.small} onClick={() => addMinute(timer.id)}>
          +1 min<span className="visually-hidden"> on {timer.label}</span>
        </button>
        <button type="button" className={styles.small} onClick={() => stopTimer(timer.id)}>
          Dismiss<span className="visually-hidden"> {timer.label}</span>
        </button>
      </span>
    );
  }
  const paused = timer.pausedLeft !== null;
  return (
    <span className={styles.buttons}>
      <button
        type="button"
        className={paused ? `${styles.clock} ${styles.clockPaused}` : styles.clock}
        aria-label={`Adjust ${timer.label}: ${left} left${paused ? ", paused" : ""}`}
        onClick={() => showView({ kind: "adjust", id: timer.id, fromList: false })}
      >
        {left}
      </button>
      {paused ? (
        <button type="button" className={styles.small} onClick={() => resumeTimer(timer.id)}>
          Resume<span className="visually-hidden"> {timer.label}</span>
        </button>
      ) : (
        <button type="button" className={styles.small} onClick={() => pauseTimer(timer.id)}>
          Pause<span className="visually-hidden"> {timer.label}</span>
        </button>
      )}
      <button type="button" className={styles.small} onClick={() => stopTimer(timer.id)}>
        Stop<span className="visually-hidden"> {timer.label}</span>
      </button>
    </span>
  );
}

/** How much of a timer is left, as a ring that empties (grey while paused). */
function Ring({ timer, now }: { timer: Timer; now: number }) {
  const r = 16;
  const round = 2 * Math.PI * r;
  const share = timer.done
    ? 0
    : Math.max(0, Math.min(1, timeLeft(timer, now) / 1000 / Math.max(1, timer.seconds)));
  return (
    <svg className={styles.ring} viewBox="0 0 40 40" aria-hidden="true">
      <circle className={styles.ringTrack} cx="20" cy="20" r={r} />
      {share > 0 ? (
        <circle
          className={timer.pausedLeft !== null ? styles.ringPaused : styles.ringLeft}
          cx="20"
          cy="20"
          r={r}
          strokeDasharray={`${share * round} ${round}`}
          transform="rotate(-90 20 20)"
        />
      ) : null}
    </svg>
  );
}

/**
 * Timers as cards in the corner of every page (wide screens; phones have the ⏱ in the top bar),
 * owner's choice 2026-10-29: a ring for how much is left, the time, where it's from and its name,
 * with Pause (Resume) and Stop on the card; a finished one has +1 min and Dismiss. Tapping a card
 * opens the Timers panel.
 */
export function FloatingTimers() {
  const { timers, now } = useTimers();
  if (timers.length === 0) return null;
  const shown = [...timers]
    .sort((a, b) => (a.done !== b.done ? (a.done ? -1 : 1) : timeLeft(a, now) - timeLeft(b, now)))
    .slice(0, 3);
  return (
    <div className={styles.floating} role="region" aria-label="Running timers">
      {shown.map((timer) => {
        const paused = timer.pausedLeft !== null;
        return (
          <div key={timer.id} className={timer.done ? styles.cardDone : styles.card}>
            <button type="button" className={styles.cardMain} onClick={openTimers}>
              <Ring timer={timer} now={now} />
              <span className={styles.cardText}>
                <strong className={paused ? styles.cardTimePaused : styles.cardTime}>
                  {timer.done ? "Done!" : clockText(timeLeft(timer, now) / 1000)}
                  {paused ? <small> paused</small> : null}
                </strong>
                <span className={styles.cardFrom}>{fromText(timer)}</span>
                <span className={styles.cardName}>{timer.label}</span>
              </span>
            </button>
            {timer.done ? (
              <>
                <button
                  type="button"
                  className={styles.cardPill}
                  onClick={() => addMinute(timer.id)}
                >
                  +1 min<span className="visually-hidden"> on {timer.label}</span>
                </button>
                <button
                  type="button"
                  className={styles.cardDismiss}
                  onClick={() => stopTimer(timer.id)}
                >
                  Dismiss<span className="visually-hidden"> {timer.label}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.round}
                  aria-label={`${paused ? "Resume" : "Pause"} ${timer.label}`}
                  onClick={() => (paused ? resumeTimer(timer.id) : pauseTimer(timer.id))}
                >
                  {paused ? (
                    <svg viewBox="0 0 10 10" aria-hidden="true" className={styles.playIcon}>
                      <path d="M2 1v8l7-4z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 10 10" aria-hidden="true" className={styles.pauseIcon}>
                      <path d="M3 1v8M7 1v8" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className={styles.round}
                  aria-label={`Stop ${timer.label}`}
                  onClick={() => stopTimer(timer.id)}
                >
                  <svg viewBox="0 0 10 10" aria-hidden="true" className={styles.stopIcon}>
                    <rect width="10" height="10" rx="1.5" />
                  </svg>
                </button>
              </>
            )}
          </div>
        );
      })}
      {timers.length > shown.length ? (
        <button type="button" className={styles.more} onClick={openTimers}>
          View all {timers.length}
        </button>
      ) : null}
    </div>
  );
}
