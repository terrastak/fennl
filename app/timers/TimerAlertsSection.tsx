import { useState } from "react";
import styles from "../pages/SettingsPage.module.css";
import recipeStyles from "../recipes/recipes.module.css";
import { turnOffAlerts, turnOnAlerts, useAlertsState } from "./timerAlerts";

/**
 * Settings › Timer alerts (U10, owner's choices 2026-10-28): whether this browser gets an alert
 * when a timer finishes, even with the phone locked, and a way to turn it on or off.
 * It's per browser: each phone, tablet or computer is turned on by itself.
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
        When a timer finishes, the device that started it gets an alert, even with the screen locked
        or Fennl closed. Each browser is turned on by itself.
      </p>
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
