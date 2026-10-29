import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { clockText } from "../../shared/cook";
import { alertNeeds } from "../../shared/timerAlerts";
import { Link } from "../router";
import { turnOnAlerts, useAlertsState, type AlertsState } from "./timerAlerts";
import {
  addMinute,
  alertRunningTimers,
  askForNotifications,
  canAskForNotifications,
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
import { openTimer, openTimers, showView, useView } from "./timersView";

// Timers anywhere in the app (U9, owner's choices 2026-10-28). One window, opened from the
// sidebar's Timers button (the ⏱ in a phone's top bar), a floating chip, or cook mode: every
// timer with Pause and Stop, and a new timer of your own in one tap. Tapping a timer changes its
// time: nudged with −5 / −1 / +1 / +5 minutes, or typed as hours, minutes and seconds. The timer
// pauses while it's being changed.

/** What a timer is from: its recipe, or "Your timer". */
const fromText = (timer: Timer) => timer.recipeTitle ?? "Your timer";

/** The Timers window. Mounted once on every screen that shows timers. */
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

  const editing = current?.kind === "edit" ? timers.find((t) => t.id === current.id) : undefined;
  const back = () =>
    showView(current?.kind === "edit" && current.fromList ? { kind: "list" } : null);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={() => showView(null)}
    >
      {current?.kind === "edit" && editing ? (
        <TimerEditor key={editing.id} timer={editing} titleId={titleId} onDone={back} />
      ) : current?.kind === "new" ? (
        <TimerEditor
          key="new"
          timer={null}
          titleId={titleId}
          onDone={() => showView({ kind: "list" })}
        />
      ) : (
        <TimerList timers={timers} now={now} titleId={titleId} />
      )}
    </dialog>
  );
}

const PRESETS = [1, 3, 5, 10, 15, 30, 60];

function TimerList({ timers, now, titleId }: { timers: Timer[]; now: number; titleId: string }) {
  const [name, setName] = useState("");
  const alerts = useAlertsState();
  const nameId = useId();
  const start = (minutes: number) => {
    startTimer(name.trim() || "Timer", minutes * 60, null);
    setName("");
  };
  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          Timers
        </h2>
        <button type="button" className={styles.quiet} onClick={() => showView(null)}>
          Close
        </button>
      </div>
      {timers.length > 0 ? (
        <ul className={styles.list}>
          {timers.map((timer) => (
            <li key={timer.id} className={timer.done ? styles.rowDone : styles.row}>
              <span className={styles.name}>
                {timer.label}
                <span className={styles.from}>
                  {fromText(timer)}
                  {timer.pausedLeft !== null ? " · paused" : ""}
                </span>
              </span>
              <TimerButtons timer={timer} now={now} fromList />
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
      ) : (
        <p className={styles.hint}>No timers running.</p>
      )}
      {timers.length > 0 ? <TimerAlertsOffer state={alerts} /> : null}
      <section className={styles.new} aria-labelledby={`${titleId}-new`}>
        <h3 id={`${titleId}-new`} className={styles.newTitle}>
          New timer
        </h3>
        <label htmlFor={nameId} className="visually-hidden">
          Name (optional)
        </label>
        <input
          id={nameId}
          className={styles.nameInput}
          placeholder="Name (optional)"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
        <div className={styles.presets}>
          {PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className={styles.chip}
              onClick={() => start(minutes)}
            >
              {minutes === 60 ? "1 hr" : `${minutes} min`}
              <span className="visually-hidden"> timer</span>
            </button>
          ))}
          <button type="button" className={styles.chip} onClick={() => showView({ kind: "new" })}>
            Other…
          </button>
        </div>
      </section>
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
 * A timer's time and buttons, wherever it shows: the time opens it to change; running ones have
 * Pause (Resume when paused) and Stop; a rung one has +1 min and Dismiss.
 */
export function TimerButtons({
  timer,
  now,
  fromList = false,
}: {
  timer: Timer;
  now: number;
  fromList?: boolean;
}) {
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
        aria-label={`Change ${timer.label}: ${left} left${paused ? ", paused" : ""}`}
        onClick={() => showView({ kind: "edit", id: timer.id, fromList })}
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

const NUDGES = [-5, -1, 1, 5];
/** The longest a timer can be set to: 23:59:59. */
const LONGEST = 24 * 60 * 60 - 1;

/**
 * Changing a timer's time (or setting a new one's): nudged a few minutes either way, or typed.
 * A running timer pauses while it's open; Done starts it from the new time, Cancel (or Escape)
 * lets it carry on as it was.
 */
function TimerEditor({
  timer,
  titleId,
  onDone,
}: {
  timer: Timer | null;
  titleId: string;
  onDone: () => void;
}) {
  const { now } = useTimers();
  const [total, setTotal] = useState(() =>
    timer && !timer.done ? Math.round(timeLeft(timer, now) / 1000) : timer ? 60 : 5 * 60,
  );
  const [name, setName] = useState("");
  const kept = useRef(false);
  const fieldId = useId();

  // Paused while it's being changed, and carrying on as it was unless the change is kept.
  const wasRunning = useRef(false);
  const id = timer?.id;
  const pauseHere = useEffectEvent(() => {
    if (timer && !timer.done && timer.pausedLeft === null) {
      wasRunning.current = true;
      pauseTimer(timer.id);
    }
  });
  useEffect(() => {
    pauseHere();
    return () => {
      if (id && wasRunning.current && !kept.current) resumeTimer(id);
    };
  }, [id]);

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const setPart = (part: "h" | "m" | "s", text: string) => {
    const value = Math.max(
      0,
      Math.min(part === "h" ? 23 : 59, Number(text.replace(/\D/g, "")) || 0),
    );
    const h = part === "h" ? value : hours;
    const m = part === "m" ? value : minutes;
    const s = part === "s" ? value : seconds;
    setTotal(h * 3600 + m * 60 + s);
  };
  const done = () => {
    if (total <= 0) return;
    kept.current = true;
    if (timer) setTimeLeft(timer.id, total);
    else startTimer(name.trim() || "Timer", total, null);
    onDone();
  };

  const field = (part: "h" | "m" | "s", label: string, value: number) => (
    <span className={styles.field}>
      <label htmlFor={`${fieldId}-${part}`}>{label}</label>
      <input
        id={`${fieldId}-${part}`}
        className={styles.number}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={part === "h" ? String(value) : String(value).padStart(2, "0")}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setPart(part, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") done();
        }}
      />
    </span>
  );

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {timer ? timer.label : "New timer"}
        </h2>
        {timer ? <span className={styles.from}>{fromText(timer)}</span> : null}
      </div>
      {timer ? null : (
        <input
          className={styles.nameInput}
          aria-label="Name (optional)"
          placeholder="Name (optional)"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
      )}
      <div className={styles.hms} role="group" aria-label="Time left">
        {field("h", "hr", hours)}
        <span className={styles.colon} aria-hidden="true">
          :
        </span>
        {field("m", "min", minutes)}
        <span className={styles.colon} aria-hidden="true">
          :
        </span>
        {field("s", "sec", seconds)}
      </div>
      <p className={styles.hint}>Tap a number to type it.</p>
      <div className={styles.nudges}>
        {NUDGES.map((n) => (
          <button
            key={n}
            type="button"
            className={styles.chip}
            onClick={() => setTotal((t) => Math.max(0, Math.min(LONGEST, t + n * 60)))}
          >
            {n > 0 ? `+${n}` : `−${-n}`} min
          </button>
        ))}
      </div>
      <div className={styles.actions}>
        {timer ? (
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              kept.current = true;
              stopTimer(timer.id);
              onDone();
            }}
          >
            Stop timer
          </button>
        ) : null}
        <span className={styles.spacer} />
        <button type="button" className={styles.quiet} onClick={onDone}>
          Cancel
        </button>
        <button type="button" className={styles.primary} disabled={total <= 0} onClick={done}>
          {timer ? "Done" : "Start"}
        </button>
      </div>
    </div>
  );
}

/** Running timers in a corner of every page (wide screens; phones have the ⏱ in the top bar). */
export function FloatingTimers() {
  const { timers, now } = useTimers();
  if (timers.length === 0) return null;
  const shown = timers.slice(0, 3);
  return (
    <div className={styles.floating} role="region" aria-label="Running timers">
      {shown.map((timer) => (
        <button
          key={timer.id}
          type="button"
          className={timer.done ? styles.floatDone : styles.float}
          // A finished one opens the list, where it's dismissed (or given another minute).
          onClick={() => (timer.done ? openTimers() : openTimer(timer.id))}
        >
          <span aria-hidden="true">⏱ </span>
          {timer.label} ·{" "}
          {timer.done
            ? "Done!"
            : `${clockText(timeLeft(timer, now) / 1000)}${timer.pausedLeft !== null ? " (paused)" : ""}`}
        </button>
      ))}
      {timers.length > shown.length ? (
        <button type="button" className={styles.float} onClick={openTimers}>
          +{timers.length - shown.length}
          <span className="visually-hidden"> more timers</span>
        </button>
      ) : null}
    </div>
  );
}
