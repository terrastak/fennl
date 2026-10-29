import { useState } from "react";
import { alertNeeds, type AlertNeeds } from "../../shared/timerAlerts";
import styles from "../pages/SettingsPage.module.css";
import recipeStyles from "../recipes/recipes.module.css";
import { turnOffAlerts, turnOnAlerts, useAlertsState } from "./timerAlerts";

/**
 * Settings › Timer alerts (U10, owner's choices 2026-10-28): whether this browser gets an alert
 * when a timer finishes, even with the phone locked, and a way to turn it on or off.
 * It's per browser: each phone, tablet or computer is turned on by itself. What this browser
 * needs for an alert to arrive is said too (owner's request 2026-10-29), above all a computer's
 * browser that must stay running.
 */
export function TimerAlertsSection() {
  const state = useAlertsState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const turnOn = () => {
    setBusy(true);
    setProblem(null);
    void turnOnAlerts().then((outcome) => {
      setBusy(false);
      if (outcome === "blocked") {
        setProblem(
          "Notifications are turned off for Fennl in this browser’s settings. Allow them there, then try again.",
        );
      } else if (outcome === "failed") {
        setProblem("Couldn’t turn on timer alerts. Check your connection and try again.");
      }
    });
  };

  const turnOff = () => {
    setBusy(true);
    setProblem(null);
    void turnOffAlerts().finally(() => setBusy(false));
  };

  return (
    <section aria-labelledby="timer-alerts-title" className={styles.section}>
      <h2 id="timer-alerts-title">Timer alerts</h2>
      <p className={styles.help}>
        When a timer finishes, the device that started it gets an alert. Each browser is turned on
        by itself.
      </p>
      {state === "on" || state === "off" || state === "blocked" ? <WhatItNeeds /> : null}
      {state === null ? null : state === "on" ? (
        <>
          <p className={styles.help}>On for this browser.</p>
          <button
            type="button"
            className={recipeStyles.secondary}
            disabled={busy}
            onClick={turnOff}
          >
            Turn off
          </button>
        </>
      ) : state === "off" ? (
        <>
          <p className={styles.help}>Off for this browser.</p>
          <button type="button" className={recipeStyles.secondary} disabled={busy} onClick={turnOn}>
            Turn on
          </button>
        </>
      ) : state === "home-screen" ? (
        <p className={styles.help}>
          On iPhone and iPad, alerts need Fennl opened from the Home Screen: in Safari, tap Share
          (under &bull;&bull;&bull; beside the address), then Add to Home Screen, and open Fennl
          from its icon. Then turn alerts on here.
        </p>
      ) : state === "blocked" ? (
        <p className={styles.help}>
          Notifications are turned off for Fennl in this browser&rsquo;s settings. Allow them there
          to get timer alerts.
        </p>
      ) : (
        <p className={styles.help}>
          This browser can&rsquo;t get timer alerts. Timers still ring while Fennl is on screen.
        </p>
      )}
      {problem ? (
        <p role="alert" className={styles.help}>
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** This browser's own needs, so nobody counts on an alert that can't arrive. */
function WhatItNeeds() {
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );
  const { browser } = needs;
  const phone = needs.kind === "phone";
  const where = phone ? "device" : "computer";
  return (
    <>
      <p className={styles.help}>On this {where}:</p>
      <ul className={styles.help}>
        {phone ? (
          <li>
            Alerts arrive even with the screen locked or Fennl closed, as long as the device has a
            connection.
          </li>
        ) : needs.kind === "mac-safari" ? (
          <li>
            Alerts arrive even when Safari is closed, as long as the Mac is awake and connected.
          </li>
        ) : (
          <>
            <li>
              Alerts arrive only while {browser} is running. Fennl&rsquo;s tab can be closed, but if{" "}
              {browser} is quit, they can&rsquo;t arrive.
              {needs.system === "windows"
                ? ` On Windows, closing ${browser}’s last window usually quits it, so keep one window open (it can be minimized).`
                : needs.system === "mac"
                  ? ` On a Mac, closing ${browser}’s windows leaves it running; quitting it (⌘Q) stops alerts.`
                  : ""}
            </li>
            <li>The computer needs to be awake and connected.</li>
          </>
        )}
        <li>An alert that can&rsquo;t arrive within 10 minutes of the timer ending is dropped.</li>
        <li>
          {`Do Not Disturb or a Focus can silence or hide them, and notifications must be allowed for ${phone ? "Fennl" : browser} in the ${where}’s settings.`}
        </li>
      </ul>
    </>
  );
}
