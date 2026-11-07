import { useId, useState, type ReactNode } from "react";
import { arrived, dismissMissed, forgetArrival, useMissed } from "./arrivals";
import { alertNeeds, type AlertNeeds } from "../../shared/timerAlerts";
import { sendTestAlert, turnOffAlerts, turnOnAlerts, useAlertsState } from "./timerAlerts";
import { alertRunningTimers, askForNotifications, canAskForNotifications } from "./timers";
import styles from "./timers.module.css";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import { usePointer } from "../recipes/usePointer";
import { WarmNote } from "../ui/WarmNote";

/**
 * Timer notifications, at the foot of the Timers panel (owner's choice 2026-10-29; until then a
 * section in Settings): one line saying whether timers use this device's notifications, with
 * Turn on or Turn off, and How they work opening two short lines on this device (owner's choice
 * 2026-11-02: only what people need) and Send test notification, which checks itself and answers
 * in one line. A timer's notification that didn't arrive is said here too (./arrivals.ts). An iPhone's Safari tab, notifications blocked in the browser,
 * and a browser that can't take them each get their own line. It's per browser.
 *
 * On a laptop (U23, owner's choice 2026-11-07) it is a white box: a "Timer notifications" row
 * with the same sentence under it and an On/Off switch (as Settings' Show nutrition) in place of
 * Turn on and Turn off, then How they work in the same box.
 */
export function TimerNotifications() {
  const state = useAlertsState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [askable, setAskable] = useState(canAskForNotifications);
  const laptop = usePointer();
  const switchId = useId();

  const turnOn = () => {
    setBusy(true);
    setProblem(null);
    void turnOnAlerts().then((outcome) => {
      setBusy(false);
      if (outcome === "on") alertRunningTimers();
      else if (outcome === "blocked") {
        setProblem("Notifications are blocked for Fennl in this browser’s settings.");
      } else if (outcome === "failed") {
        setProblem("Couldn’t turn on timer notifications. Check your connection and try again.");
      }
    });
  };
  const turnOff = () => {
    setBusy(true);
    setProblem(null);
    void turnOffAlerts().finally(() => setBusy(false));
  };

  if (state === null) return null;

  /** On a laptop: the row's name, its sentence under it, and its control on the right. */
  const row = (sentence: ReactNode, control?: ReactNode) => (
    <div className={styles.notifyRow}>
      <div>
        {control ? (
          <label htmlFor={switchId} className={styles.notifyName}>
            Timer notifications
          </label>
        ) : (
          <p className={styles.notifyName}>Timer notifications</p>
        )}
        <p className={styles.notifyLine}>{sentence}</p>
      </div>
      {control}
    </div>
  );

  return (
    <section className={styles.notifications} aria-label="Timer notifications">
      <MissedNotice />
      {laptop && (state === "on" || state === "off") ? (
        <>
          {row(
            state === "on"
              ? "Timers will use this device’s notifications."
              : "Timers won’t use this device’s notifications.",
            // The knob moves and the word says it, so it isn't shown by colour alone.
            <span className={styles.switch}>
              <span className={styles.switchWord} aria-hidden="true">
                {state === "on" ? "On" : "Off"}
              </span>
              <input
                id={switchId}
                type="checkbox"
                role="switch"
                className={styles.switchInput}
                checked={state === "on"}
                disabled={busy}
                onChange={state === "on" ? turnOff : turnOn}
              />
              <span className={styles.track} aria-hidden="true" />
            </span>,
          )}
          <details className={styles.howTheyWork}>
            <summary>
              <LaptopIcon path={LAPTOP_ICONS.chevronRight} className={styles.howIcon} />
              How they work
            </summary>
            <div className={styles.howBody}>
              <WhatItNeeds />
              {state === "on" ? (
                <SelfCheck
                  onGone={() =>
                    setProblem(
                      "This browser stopped receiving Fennl’s notifications. Turn them on again.",
                    )
                  }
                />
              ) : null}
            </div>
          </details>
        </>
      ) : laptop && state === "home-screen" ? (
        <>
          {row("On iPhone and iPad, timer notifications need Fennl opened from the Home Screen.")}
          <details className={styles.howTheyWork}>
            <summary>
              <LaptopIcon path={LAPTOP_ICONS.chevronRight} className={styles.howIcon} />
              How
            </summary>
            <div className={styles.howBody}>
              <p className={styles.hint}>
                In Safari, tap Share (under &bull;&bull;&bull; beside the address), then Add to Home
                Screen, and open Fennl from its icon. Then turn notifications on here.
              </p>
            </div>
          </details>
        </>
      ) : laptop && state === "blocked" ? (
        row(
          <>
            Notifications are blocked for Fennl in this browser&rsquo;s settings. Allow them there
            for timers to use them.
          </>,
        )
      ) : laptop ? (
        row(
          <>
            This browser can&rsquo;t send timer notifications; timers ring while Fennl is on screen.
            {askable ? (
              <>
                {" "}
                <button
                  type="button"
                  className={styles.textLink}
                  onClick={() => void askForNotifications().then(() => setAskable(false))}
                >
                  Tell me while I&rsquo;m in another app
                </button>
              </>
            ) : null}
          </>,
        )
      ) : state === "on" || state === "off" ? (
        <>
          <p className={styles.notifyLine}>
            {state === "on"
              ? "Timers will use this device’s notifications."
              : "Timers won’t use this device’s notifications."}{" "}
            <button
              type="button"
              className={styles.textLink}
              disabled={busy}
              onClick={state === "on" ? turnOff : turnOn}
            >
              {state === "on" ? "Turn off" : "Turn on"}
            </button>
          </p>
          <details className={styles.howTheyWork}>
            <summary>How they work</summary>
            <WhatItNeeds />
            {state === "on" ? (
              <SelfCheck
                onGone={() =>
                  setProblem(
                    "This browser stopped receiving Fennl’s notifications. Turn them on again.",
                  )
                }
              />
            ) : null}
          </details>
        </>
      ) : state === "home-screen" ? (
        <>
          <p className={styles.notifyLine}>
            On iPhone and iPad, timer notifications need Fennl opened from the Home Screen.
          </p>
          <details className={styles.howTheyWork}>
            <summary>How</summary>
            <p className={styles.hint}>
              In Safari, tap Share (under &bull;&bull;&bull; beside the address), then Add to Home
              Screen, and open Fennl from its icon. Then turn notifications on here.
            </p>
          </details>
        </>
      ) : state === "blocked" ? (
        <p className={styles.notifyLine}>
          Notifications are blocked for Fennl in this browser&rsquo;s settings. Allow them there for
          timers to use them.
        </p>
      ) : (
        <p className={styles.notifyLine}>
          This browser can&rsquo;t send timer notifications; timers ring while Fennl is on screen.
          {askable ? (
            <>
              {" "}
              <button
                type="button"
                className={styles.textLink}
                onClick={() => void askForNotifications().then(() => setAskable(false))}
              >
                Tell me while I&rsquo;m in another app
              </button>
            </>
          ) : null}
        </p>
      )}
      {problem ? (
        <p role="alert" className={`${styles.hint} ${styles.notifyProblem}`}>
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/**
 * How they work, in two lines (owner's choice 2026-11-02: only what people need): when
 * notifications arrive on this device, and where to look if they don't pop up.
 */
function WhatItNeeds() {
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );
  const { browser } = needs;
  return (
    <ul className={styles.needs}>
      <li>
        {needs.kind === "phone"
          ? "Notifications arrive even with the screen locked or Fennl closed."
          : needs.kind === "mac-safari"
            ? "Notifications arrive even with Safari closed."
            : `Notifications arrive while ${browser} is open, even if Fennl’s tab is closed.`}
      </li>
      <li>
        {needs.kind === "phone"
          ? "Not seeing them? Check Do Not Disturb or a Focus, and that notifications are allowed for Fennl in Settings."
          : `Not seeing them pop up? Check Do Not Disturb and ${browser}’s notification settings.`}
      </li>
    </ul>
  );
}

/** How long the test waits for this device to say it arrived. */
const ARRIVAL_WAIT_MS = 15_000;

/**
 * Send test notification, checking itself (owner's choices 2026-11-02) so nobody has to leave the
 * page to see it: allowed here, sent by Fennl's server, arrived on this device (the service worker
 * notes it, ./arrivals.ts). One line says how it went: where to find it, or the one likeliest fix.
 */
function SelfCheck({ onGone }: { onGone: () => void }) {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );

  const run = async () => {
    setRunning(true);
    setResult(null);
    const finish = (ok: boolean, text: string) => {
      setResult({ ok, text });
      setRunning(false);
    };
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      finish(false, "Notifications are blocked for Fennl in this browser’s settings.");
      return;
    }
    await forgetArrival("fennl-test");
    const outcome = await sendTestAlert();
    if (outcome === "off") {
      setRunning(false);
      onGone();
      return;
    }
    if (outcome !== "sent") {
      finish(false, "Couldn’t send it. Check your connection and try again.");
      return;
    }
    const until = Date.now() + ARRIVAL_WAIT_MS;
    let came = false;
    while (!came && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      came = await arrived("fennl-test");
    }
    if (came) finish(true, `Test notification arrived. ${whereItIs(needs)}`);
    else {
      finish(
        false,
        needs.kind === "browser-running"
          ? `It didn’t arrive. Make sure ${needs.browser} stays open, then try again.`
          : "It didn’t arrive. Check your connection, then try again.",
      );
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.textLink}
        disabled={running}
        onClick={() => void run()}
      >
        {result ? "Send another" : "Send test notification"}
      </button>
      <p role="status" className={result && !result.ok ? styles.problem : styles.tested}>
        {running ? "Sending a test notification…" : null}
        {result ? (
          <>
            <span aria-hidden="true" className={styles.mark}>
              {result.ok ? "✓" : "✗"}
            </span>
            {result.text}
          </>
        ) : null}
      </p>
    </>
  );
}

/** Where a notification that arrived waits, on this device. */
function whereItIs(needs: AlertNeeds): string {
  if (needs.kind === "phone") return "Swipe down from the top of the screen to see it.";
  if (needs.system === "mac") {
    return "It’s in Notification Centre (click the date and time, top right).";
  }
  if (needs.system === "windows") {
    return "It’s in the notification panel (click the date and time, bottom right).";
  }
  return "It’s with your other notifications.";
}

/** A timer's notification that never reached this device (./arrivals.ts), until dismissed. */
function MissedNotice() {
  const missed = useMissed();
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );
  if (!missed) return null;
  return (
    <WarmNote role="alert" className={styles.missed}>
      <span className={styles.missedWords}>
        The notification for <strong>{missed.label}</strong> didn&rsquo;t arrive.{" "}
        {needs.kind === "browser-running"
          ? `Keep ${needs.browser} open and the computer awake while a timer runs.`
          : needs.kind === "phone"
            ? "Check the device had a connection when the timer ended."
            : "Keep the Mac awake and connected while a timer runs."}
      </span>{" "}
      <button
        type="button"
        className={`${styles.textLink} ${styles.missedDismiss}`}
        onClick={dismissMissed}
      >
        Dismiss
      </button>
    </WarmNote>
  );
}
