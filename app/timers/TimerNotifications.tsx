import { useState } from "react";
import { alertNeeds, type AlertNeeds } from "../../shared/timerAlerts";
import { sendTestAlert, turnOffAlerts, turnOnAlerts, useAlertsState } from "./timerAlerts";
import { alertRunningTimers, askForNotifications, canAskForNotifications } from "./timers";
import styles from "./timers.module.css";

/**
 * Timer notifications, at the foot of the Timers panel (owner's choice 2026-10-29; until then a
 * section in Settings): one line saying whether timers use this device's notifications, with
 * Turn on or Turn off, and How they work opening what this device needs for one to arrive (above
 * all a computer's browser that must stay running, owner's request 2026-10-29) and Send test
 * notification. An iPhone's Safari tab, notifications blocked in the browser, and a browser that
 * can't take them each get their own line. It's per browser: each is turned on by itself.
 */
export function TimerNotifications() {
  const state = useAlertsState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const [askable, setAskable] = useState(canAskForNotifications);

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
        setProblem("This browser no longer gets timer notifications. Turn them on again.");
      } else setProblem("Couldn’t send a test notification. Check your connection and try again.");
    });
  };

  if (state === null) return null;
  return (
    <section className={styles.notifications} aria-label="Timer notifications">
      {state === "on" || state === "off" ? (
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
              <button type="button" className={styles.textLink} disabled={busy} onClick={test}>
                Send test notification
              </button>
            ) : null}
            {tested ? <TestSent /> : null}
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
        <p role="alert" className={styles.hint}>
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** This browser's own needs, so nobody counts on a notification that can't arrive. */
function WhatItNeeds() {
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );
  const { browser } = needs;
  const phone = needs.kind === "phone";
  const where = phone ? "device" : "computer";
  return (
    <ul className={styles.needs}>
      <li>Only this {where} is notified, and each browser is turned on by itself.</li>
      {phone ? (
        <li>
          Notifications arrive even with the screen locked or Fennl closed, as long as the device
          has a connection.
        </li>
      ) : needs.kind === "mac-safari" ? (
        <li>Notifications arrive even when Safari is closed, as long as the Mac is connected.</li>
      ) : (
        <li>
          Notifications arrive only while {browser} is running. Fennl&rsquo;s tab can be closed, but
          if {browser} is quit, they can&rsquo;t arrive.
          {needs.system === "windows"
            ? ` On Windows, closing ${browser}’s last window usually quits it, so keep one window open (it can be minimized).`
            : needs.system === "mac"
              ? ` On a Mac, closing ${browser}’s windows leaves it running; quitting it (⌘Q) stops them.`
              : ""}
        </li>
      )}
      {phone ? (
        <li>
          A notification that can&rsquo;t arrive within 10 minutes of the timer ending is dropped.
        </li>
      ) : (
        // Owner's request 2026-10-29: a locked computer shows them; a sleeping one can't.
        <li>
          If the computer goes to sleep, notifications wait until it wakes; one that can&rsquo;t
          arrive within 10 minutes of the timer ending is dropped. While cook mode is open, Fennl
          keeps the screen on, which usually stops the computer going to sleep.
        </li>
      )}
      <li>
        {`Do Not Disturb or a Focus can silence or hide them, and notifications must be allowed for ${phone ? "Fennl" : browser} in the ${where}’s settings.`}
      </li>
    </ul>
  );
}

/** After a test: when it should show, and what to check on this device if it doesn't. */
function TestSent() {
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );
  const phone = needs.kind === "phone";
  return (
    <div role="status" className={styles.hint}>
      <p className={styles.tested}>
        Sent. &ldquo;Fennl test notification&rdquo; should appear within a few seconds. If it
        doesn&rsquo;t, check:
      </p>
      <ul className={styles.needs}>
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
