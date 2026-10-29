import { useEffect, useState } from "react";
import { alertNeeds, type AlertNeeds } from "../../shared/timerAlerts";
import styles from "../pages/SettingsPage.module.css";
import recipeStyles from "../recipes/recipes.module.css";
import { sendTestAlert, turnOffAlerts, turnOnAlerts, useAlertsState } from "./timerAlerts";

/**
 * Settings › Timer alerts (U10, owner's choices 2026-10-28): whether this browser gets an alert
 * when a timer finishes, even with the phone locked, and a way to turn it on or off.
 * It's per browser: each phone, tablet or computer is turned on by itself. What this browser
 * needs for an alert to arrive is said too (owner's request 2026-10-29), above all a computer's
 * browser that must stay running. Send a test alert (owner's request 2026-10-29) shows that
 * nothing on the device holds alerts back.
 */
export function TimerAlertsSection() {
  const state = useAlertsState();
  // Opened from the Timers window's link: brought into view once it has its contents.
  useEffect(() => {
    if (state !== null && window.location.hash === "#timer-alerts") {
      document.getElementById("timer-alerts")?.scrollIntoView();
    }
  }, [state]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tested, setTested] = useState(false);

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
    setTested(false);
    void turnOffAlerts().finally(() => setBusy(false));
  };

  const test = () => {
    setBusy(true);
    setProblem(null);
    setTested(false);
    void sendTestAlert().then((outcome) => {
      setBusy(false);
      if (outcome === "sent") setTested(true);
      else if (outcome === "off") {
        setProblem("This browser no longer gets timer alerts. Turn them on again to test them.");
      } else setProblem("Couldn’t send a test alert. Check your connection and try again.");
    });
  };

  return (
    <section id="timer-alerts" aria-labelledby="timer-alerts-title" className={styles.section}>
      <h2 id="timer-alerts-title">Timer alerts</h2>
      <p className={styles.help}>
        When a timer finishes, the device that started it gets an alert. Each browser is turned on
        by itself.
      </p>
      {state === "on" || state === "off" || state === "blocked" ? <WhatItNeeds /> : null}
      {state === null ? null : state === "on" ? (
        <>
          <p className={styles.help}>On for this browser.</p>
          <div className={styles.buttonRow}>
            <button type="button" className={recipeStyles.secondary} disabled={busy} onClick={test}>
              Send a test alert
            </button>
            <button
              type="button"
              className={recipeStyles.secondary}
              disabled={busy}
              onClick={turnOff}
            >
              Turn off
            </button>
          </div>
          {tested ? <TestSent /> : null}
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
          <li>Alerts arrive even when Safari is closed, as long as the Mac is connected.</li>
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
            <li>The computer needs to be connected.</li>
          </>
        )}
        {phone ? (
          <li>
            An alert that can&rsquo;t arrive within 10 minutes of the timer ending is dropped.
          </li>
        ) : (
          // Owner's request 2026-10-29: a locked computer shows them; a sleeping one can't.
          <li>
            If the computer goes to sleep, alerts wait until it wakes; one that can&rsquo;t arrive
            within 10 minutes of the timer ending is dropped. While cook mode is open, Fennl keeps
            the screen on, which usually stops the computer going to sleep.
          </li>
        )}
        <li>
          {`Do Not Disturb or a Focus can silence or hide them, and notifications must be allowed for ${phone ? "Fennl" : browser} in the ${where}’s settings.`}
        </li>
      </ul>
    </>
  );
}

/** After a test alert: when it should show, and what to check on this device if it doesn't. */
function TestSent() {
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );
  const phone = needs.kind === "phone";
  return (
    <div role="status" className={styles.help}>
      <p>
        Sent. &ldquo;Fennl test alert&rdquo; should appear within a few seconds. If it
        doesn&rsquo;t, check:
      </p>
      <ul>
        {phone ? (
          <li>Notifications are allowed for Fennl in the {"device’s"} settings.</li>
        ) : needs.system === "mac" ? (
          <li>
            On the Mac: System Settings › Notifications › {needs.browser}, with notifications
            allowed.
          </li>
        ) : needs.system === "windows" ? (
          <li>
            In Windows: Settings › System › Notifications, with notifications on, and on for{" "}
            {needs.browser}.
          </li>
        ) : (
          <li>Notifications are allowed for {needs.browser} in the computer&rsquo;s settings.</li>
        )}
        <li>Do Not Disturb or a Focus isn&rsquo;t on.</li>
      </ul>
    </div>
  );
}
