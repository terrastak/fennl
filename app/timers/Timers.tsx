import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { clockText, durationText } from "../../shared/cook";
import { turnOnAlerts, useAlertsState, type AlertsState } from "./timerAlerts";
import { TimerNotifications } from "./TimerNotifications";
import {
  addMinute,
  alertRunningTimers,
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
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import { usePointer } from "../recipes/usePointer";
import { WarmNote } from "../ui/WarmNote";
import {
  listenForShowStep,
  openTimers,
  showView,
  useView,
  viewStep,
  type StartOffer,
} from "./timersView";

// Timers anywhere in the app (U9), laid out as the earlier Fennl had them (owner's choices
// 2026-10-29, from its screenshots): a Timers panel from the right (the whole width on a phone),
// opened from the sidebar's Timers button (the ⏱ in a phone's top bar), a corner card or cook
// mode. Each timer has View step, Pause or Resume, Adjust time, +1 minute and Cancel; Add timer
// starts one of one's own. Adjust time leaves the timer running until Save time sets the new
// time. A time in a recipe's method asks before it starts a timer, with either end of a range to
// pick. Running timers show as cards in the corner of a wide screen,
// each with a ring for how much is left and its own Pause and Stop. A tap outside closes it all.
//
// On a laptop (U23, mockup approved 2026-11-07) all of it is smaller and quieter: the panel 440px
// wide, the timers rows in one white box (a ring, the name, where it's from, the time large on the
// right, which opens Adjust time), quiet word buttons, notifications an On/Off switch, Save time
// and Start timer the one ink button on their forms with Cancel after them, and the corner cards
// smaller with Pause and Stop as icons. Phones, touch screens and narrow windows look as before.

/** Small icons beside words on a laptop only (LaptopIcon). */
const ICONS = {
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  stop: "M7 7h10v10H7z",
  viewStep: "M4 6h16M4 12h9M4 18h6M16 14l4 4-4 4",
  clock: "M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0M12 9v4l2 2M10 2h4",
};

/** The Timers panel, or a step's "Start a timer?". Mounted once on every screen with timers. */
export function TimersDialog() {
  const current = useView();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { timers, now } = useTimers();

  // A timer's notification, clicked: its step, wherever Fennl is.
  useEffect(() => listenForShowStep(), []);

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
  below = false,
  children,
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  /** On a laptop the small line goes under the title, in grey (Adjust time, Add timer). */
  below?: boolean;
  children: React.ReactNode;
}) {
  return (
    <header className={below ? `${styles.panelHead} ${styles.below}` : styles.panelHead}>
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
      <span aria-hidden="true" className={styles.closeChar}>
        ×
      </span>
      <LaptopIcon path={LAPTOP_ICONS.x} className={styles.closeIcon} />
    </button>
  );
}

/** Every timer, finished ones first, then the soonest to end. */
function TimerList({ timers, now, titleId }: { timers: Timer[]; now: number; titleId: string }) {
  const alerts = useAlertsState();
  const laptop = usePointer();
  const ordered = [...timers].sort((a, b) =>
    a.done !== b.done ? (a.done ? -1 : 1) : timeLeft(a, now) - timeLeft(b, now),
  );
  return (
    <div className={styles.panel}>
      <PanelHead eyebrow="Keep cooking" title="Timers" titleId={titleId}>
        <button
          type="button"
          className={`${styles.primary} ${styles.addTimer}`}
          onClick={() => showView({ kind: "add" })}
        >
          <LaptopIcon path={LAPTOP_ICONS.plus} />
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
          <>
            {/* On a laptop, a line saying how the list is ordered (hidden elsewhere). */}
            <p className={styles.order}>
              {ordered.length === 1 ? "1 timer" : `${ordered.length} timers · soonest to end first`}
            </p>
            <ul className={styles.list}>
              {ordered.map((timer) => {
                const paused = timer.pausedLeft !== null;
                const time = clockText(timeLeft(timer, now) / 1000);
                const timeClass = paused ? styles.rowTimePaused : styles.rowTime;
                return (
                  <li key={timer.id} className={timer.done ? styles.rowDone : styles.row}>
                    <div className={styles.rowTop}>
                      <Ring timer={timer} now={now} className={styles.rowRing} />
                      <div>
                        <strong className={styles.rowName}>
                          {timer.done ? "Finished: " : ""}
                          {timer.label}
                          {paused ? (
                            <span className={styles.pausedTag} aria-hidden="true">
                              Paused
                            </span>
                          ) : null}
                        </strong>
                        <p className={`${styles.eyebrow} ${styles.rowFrom}`}>
                          {fromText(timer)}
                          {paused ? <span className={styles.pausedWords}> · paused</span> : null}
                        </p>
                      </div>
                      {laptop && !timer.done ? (
                        // The time opens Adjust time, as it does in cook mode (its own button is in the
                        // row, so this one is for the pointer only and isn't a second tab stop).
                        <button
                          type="button"
                          tabIndex={-1}
                          className={`${timeClass} ${styles.rowTimeButton}`}
                          onClick={() => showView({ kind: "adjust", id: timer.id, fromList: true })}
                        >
                          {time}
                          {paused ? <span className="visually-hidden">, paused</span> : null}
                        </button>
                      ) : (
                        <span className={timeClass}>{time}</span>
                      )}
                    </div>
                    <div className={styles.rowButtons}>
                      {timer.path && timer.recipeTitle ? (
                        <button
                          type="button"
                          className={styles.pill}
                          onClick={() => viewStep(timer)}
                        >
                          <LaptopIcon path={ICONS.viewStep} />
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
                            {laptop ? "+1 min" : "+1 minute"}
                            <span className="visually-hidden"> on {timer.label}</span>
                          </button>
                          <span className={styles.spacer} />
                          <button
                            type="button"
                            className={`${styles.primary} ${styles.rowDismiss}`}
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
                              <LaptopIcon
                                path={LAPTOP_ICONS.play}
                                fill
                                className={styles.smallIcon}
                              />
                              Resume<span className="visually-hidden"> {timer.label}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.pill}
                              onClick={() => pauseTimer(timer.id)}
                            >
                              <LaptopIcon path={ICONS.pause} fill className={styles.smallIcon} />
                              Pause<span className="visually-hidden"> {timer.label}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.pill}
                            onClick={() =>
                              showView({ kind: "adjust", id: timer.id, fromList: true })
                            }
                          >
                            Adjust time<span className="visually-hidden"> for {timer.label}</span>
                          </button>
                          <button
                            type="button"
                            className={styles.pill}
                            onClick={() => addMinute(timer.id)}
                          >
                            {laptop ? "+1 min" : "+1 minute"}
                            <span className="visually-hidden"> on {timer.label}</span>
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
                    {!timer.done && timer.pausedLeft === null ? (
                      <AlertProblem timer={timer} alerts={alerts} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <TimerNotifications />
      </div>
    </div>
  );
}

/** A running timer whose notification couldn't be set up (the quiet checks found a problem). */
const wontNotify = (timer: Timer) =>
  timer.alert === "not-set" || timer.alert === "gone" || timer.alert === "blocked";

/**
 * Said under a running timer when its notification couldn't be set up (owner's choice
 * 2026-10-29: Fennl checks quietly as each timer starts and speaks up only when something's
 * wrong), with the way to fix it where there is one.
 */
function AlertProblem({ timer, alerts }: { timer: Timer; alerts: AlertsState | null }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (timer.alert === "not-set" && alerts === "on") {
    return (
      <p className={styles.note}>
        No notification for this one: Fennl couldn&rsquo;t reach the internet. It still rings while
        Fennl is on screen.
      </p>
    );
  }
  if (timer.alert === "blocked") {
    return (
      <WarmNote className={styles.problem}>
        This timer won&rsquo;t notify: notifications are blocked for Fennl in this browser&rsquo;s
        settings. Allow them there, then turn them on again below.
      </WarmNote>
    );
  }
  if (timer.alert !== "gone") return null;
  return (
    <WarmNote className={styles.problem}>
      This timer won&rsquo;t notify: this browser stopped receiving Fennl&rsquo;s notifications.{" "}
      <button
        type="button"
        className={styles.textLink}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void turnOnAlerts().then((outcome) => {
            setBusy(false);
            if (outcome === "on") alertRunningTimers();
            else setFailed(true);
          });
        }}
      >
        Turn on again
      </button>
      {failed ? " Couldn’t turn them on. Check your connection and try again." : null}
    </WarmNote>
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
  markChanged = false,
}: {
  legend: string;
  seconds: number;
  onChange: (seconds: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onEnter?: () => void;
  hint?: React.ReactNode;
  /** Outline (on a laptop) each number that has been typed in or moved (Adjust time). */
  markChanged?: boolean;
}) {
  const id = useId();
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const touch = (part: string) => {
    if (markChanged && !touched.has(part)) setTouched(new Set([...touched, part]));
  };
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
            <span
              className={
                touched.has(unit.part) ? `${styles.numberBox} ${styles.changed}` : styles.numberBox
              }
            >
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
                onChange={(event) => {
                  touch(unit.part);
                  set(
                    unit.part,
                    Math.min(unit.max, Number(event.target.value.replace(/\D/g, "")) || 0),
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onEnter?.();
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    touch(unit.part);
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
                  onClick={() => {
                    touch(unit.part);
                    onChange(Math.min(LONGEST, seconds + unit.seconds));
                  }}
                >
                  <svg viewBox="0 0 10 6" aria-hidden="true">
                    <path d="M1 5l4-4 4 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={`One less ${unit.one}`}
                  disabled={seconds < unit.seconds}
                  onClick={() => {
                    touch(unit.part);
                    onChange(seconds - unit.seconds);
                  }}
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
  const laptop = usePointer();
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
      <PanelHead eyebrow={fromText(timer)} title="Adjust time" titleId={titleId} below>
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
          markChanged
          hint={
            draft === null
              ? "Change any field, then Save time to set the timer to it."
              : `The timer keeps ${paused ? "its time" : "running"} until you ${laptop ? "click" : "tap"} Save time; then it ${paused ? "is set to" : "starts again from"} ${clockText(draft)}.`
          }
        />
        <Actions
          laptop={laptop}
          cancel={
            <button type="button" className={styles.secondary} onClick={onDone}>
              Cancel
            </button>
          }
          main={
            <button type="button" className={styles.primary} disabled={shown <= 0} onClick={save}>
              Save time
            </button>
          }
        />
      </div>
    </div>
  );
}

/**
 * A form's buttons: Cancel then the main one at the right on a phone; on a laptop (the button
 * rule, U23) the main one first, as the one ink button, then Cancel in plain words.
 */
function Actions({
  laptop,
  main,
  cancel,
}: {
  laptop: boolean;
  main: React.ReactNode;
  cancel: React.ReactNode;
}) {
  return (
    <div className={styles.actions}>
      {laptop ? (
        <>
          {main}
          {cancel}
        </>
      ) : (
        <>
          {cancel}
          {main}
        </>
      )}
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
  const laptop = usePointer();
  const back = () => showView({ kind: "list" });
  const start = () => {
    if (seconds <= 0) return;
    startTimer(name.trim() || "Timer", seconds, null);
    back();
  };
  return (
    <div className={styles.panel}>
      <PanelHead eyebrow="Any length" title="Add timer" titleId={titleId} below>
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
        {/* On a laptop the group's name shows above it too (hidden elsewhere). */}
        <p className={styles.presetsLabel} aria-hidden="true">
          Quick lengths
        </p>
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
        <Actions
          laptop={laptop}
          cancel={
            <button type="button" className={styles.secondary} onClick={back}>
              Cancel
            </button>
          }
          main={
            <button
              type="button"
              className={styles.primary}
              disabled={seconds <= 0}
              onClick={start}
            >
              <LaptopIcon path={LAPTOP_ICONS.play} fill className={styles.smallIcon} />
              Start timer
            </button>
          }
        />
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
  const laptop = usePointer();
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
      <p className={styles.startName}>
        <span className={styles.named}>Named </span>
        <span className={styles.startNameText}>{offer.name}</span>
      </p>
      {offer.upTo ? (
        <fieldset className={styles.range}>
          <legend>Choose a duration</legend>
          {/* A small switch on a laptop; elsewhere the choices sit straight in the box. */}
          <span className={styles.rangeChoices}>
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
          </span>
        </fieldset>
      ) : null}
      <DurationFields
        legend="Set timer duration"
        seconds={seconds}
        onChange={setSeconds}
        onEnter={start}
        hint={`Suggested duration: ${durationText(offer.seconds)}. Change any field to use your own time.`}
      />
      <Actions
        laptop={laptop}
        cancel={
          <button type="button" className={styles.secondary} onClick={() => showView(null)}>
            Cancel
          </button>
        }
        main={
          <button type="button" className={styles.primary} disabled={seconds <= 0} onClick={start}>
            <LaptopIcon path={LAPTOP_ICONS.play} fill className={styles.smallIcon} />
            Start timer
          </button>
        }
      />
    </div>
  );
}

/**
 * A timer's time and buttons in cook mode's list: the time opens Adjust time; running ones have
 * Pause (Resume when paused) and Stop; a rung one has +1 min and Dismiss.
 */
export function TimerButtons({ timer, now }: { timer: Timer; now: number }) {
  const laptop = usePointer();
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
        <button
          type="button"
          className={`${styles.small} ${styles.stripDismiss}`}
          onClick={() => stopTimer(timer.id)}
        >
          Dismiss<span className="visually-hidden"> {timer.label}</span>
        </button>
      </span>
    );
  }
  const paused = timer.pausedLeft !== null;
  const pauseName = `${paused ? "Resume" : "Pause"} ${timer.label}`;
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
      {laptop ? (
        // On a laptop (owner's choice 2026-11-07): "Paused" in words, then Pause (Resume) and
        // Stop as small icons, each with a tooltip and its spoken name.
        <>
          {paused ? (
            <span className={styles.stripPaused} aria-hidden="true">
              Paused
            </span>
          ) : null}
          <button
            type="button"
            className={styles.stripIcon}
            aria-label={pauseName}
            title={pauseName}
            onClick={() => (paused ? resumeTimer(timer.id) : pauseTimer(timer.id))}
          >
            {paused ? (
              <LaptopIcon path={LAPTOP_ICONS.play} fill />
            ) : (
              <LaptopIcon path={ICONS.pause} fill />
            )}
          </button>
          <button
            type="button"
            className={styles.stripIcon}
            aria-label={`Stop ${timer.label}`}
            title={`Stop ${timer.label}`}
            onClick={() => stopTimer(timer.id)}
          >
            <LaptopIcon path={ICONS.stop} fill />
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
    </span>
  );
}

/** A clock, drawn on a laptop only (beside a timer's name in cook mode's strip). */
export function ClockIcon({ className }: { className?: string | undefined }) {
  return <LaptopIcon path={ICONS.clock} className={className} />;
}

/** How much of a timer is left, as a ring that empties (grey while paused). */
function Ring({
  timer,
  now,
  className,
}: {
  timer: Timer;
  now: number;
  className?: string | undefined;
}) {
  const r = 16;
  const round = 2 * Math.PI * r;
  const share = timer.done
    ? 0
    : Math.max(0, Math.min(1, timeLeft(timer, now) / 1000 / Math.max(1, timer.seconds)));
  return (
    <svg
      className={className ? `${styles.ring} ${className}` : styles.ring}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
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
  const laptop = usePointer();
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
                  {timer.done ? <LaptopIcon path={LAPTOP_ICONS.check} /> : null}
                  {timer.done ? "Done!" : clockText(timeLeft(timer, now) / 1000)}
                  {paused ? <small> paused</small> : null}
                </strong>
                <span className={styles.cardFrom}>{fromText(timer)}</span>
                <span className={styles.cardName}>{timer.label}</span>
                {!timer.done && timer.pausedLeft === null && wontNotify(timer) ? (
                  <span className={styles.cardWarn}>Won&rsquo;t notify · tap for details</span>
                ) : null}
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
                  // A tooltip on a laptop only, where the buttons are icons (U23).
                  title={laptop ? `${paused ? "Resume" : "Pause"} ${timer.label}` : undefined}
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
                  title={laptop ? `Stop ${timer.label}` : undefined}
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
