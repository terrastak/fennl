import { useState } from "react";
import { arrived, dismissMissed, forgetArrival, useMissed } from "./arrivals";
import { alertNeeds, type AlertNeeds } from "../../shared/timerAlerts";
import { sendTestAlert, turnOffAlerts, turnOnAlerts, useAlertsState } from "./timerAlerts";
import { alertRunningTimers, askForNotifications, canAskForNotifications } from "./timers";
import styles from "./timers.module.css";

/**
 * Timer notifications, at the foot of the Timers panel (owner's choice 2026-10-29; until then a
 * section in Settings): one line saying whether timers use this device's notifications, with
 * Turn on or Turn off, and How they work opening what this device needs for one to arrive (above
 * all a computer's browser that must stay running, owner's request 2026-10-29) and Send test
 * notification, which checks itself (owner's choice 2026-10-29): allowed here, sent by the
 * server, arrived on this device, then where to find it. A timer's notification that didn't arrive
 * is said here too (./arrivals.ts). An iPhone's Safari tab, notifications blocked in the browser,
 * and a browser that can't take them each get their own line. It's per browser.
 */
export function TimerNotifications() {
  const state = useAlertsState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
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
    void turnOffAlerts().finally(() => setBusy(false));
  };

  if (state === null) return null;
  return (
    <section className={styles.notifications} aria-label="Timer notifications">
      <MissedNotice />
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
              <SelfCheck
                onGone={() =>
                  setProblem(
                    "This browser stopped receiving Fennl’s notifications. Turn them on again above.",
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

type Step = "wait" | "ok" | "no";
const MARK: Record<Step, string> = { wait: "…", ok: "✓", no: "✗" };
/** How long the test waits for this device to say it arrived. */
const ARRIVAL_WAIT_MS = 15_000;

/**
 * Send test notification, checking itself (owner's choice 2026-10-29) so nobody has to leave the
 * page to see it: allowed here, sent by Fennl's server, arrived on this device (the service worker
 * notes it, ./arrivals.ts), then where to find it. What a web page can't see (whether the device
 * shows it on screen, Do Not Disturb, a Focus) is said, not ticked.
 */
function SelfCheck({ onGone }: { onGone: () => void }) {
  const [steps, setSteps] = useState<[Step, Step, Step] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );

  const run = async () => {
    setRunning(true);
    setFailure(null);
    setSteps(["wait", "wait", "wait"]);
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      setSteps(["no", "wait", "wait"]);
      setFailure(
        "Notifications are blocked for Fennl in this browser. Allow them in the browser’s settings for this site, then try again.",
      );
      setRunning(false);
      return;
    }
    await forgetArrival("fennl-test");
    const outcome = await sendTestAlert();
    if (outcome !== "sent") {
      setSteps(["ok", "no", "wait"]);
      setRunning(false);
      if (outcome === "off") onGone();
      else
        setFailure("Couldn’t reach the notification service. Check your connection and try again.");
      return;
    }
    setSteps(["ok", "ok", "wait"]);
    const until = Date.now() + ARRIVAL_WAIT_MS;
    let came = false;
    while (!came && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      came = await arrived("fennl-test");
    }
    setSteps(["ok", "ok", came ? "ok" : "no"]);
    if (!came) {
      setFailure(
        needs.kind === "browser-running"
          ? `It didn’t arrive. This can happen on a slow connection: try again in a minute. ${needs.browser} also needs to stay running for notifications to arrive.`
          : "It didn’t arrive. This can happen on a slow connection: try again in a minute.",
      );
    }
    setRunning(false);
  };

  const lines = [
    "Notifications are allowed for Fennl in this browser",
    "Fennl’s server sent it",
    "It arrived on this device",
  ];
  const done = steps?.every((step) => step === "ok");
  return (
    <>
      <button
        type="button"
        className={styles.textLink}
        disabled={running}
        onClick={() => void run()}
      >
        {steps ? "Send another" : "Send test notification"}
      </button>
      {steps ? (
        <div role="status" className={styles.selfCheck}>
          <ul className={styles.checks}>
            {lines.map((line, i) => (
              <li key={line} data-step={steps[i]}>
                <span aria-hidden="true" className={styles.mark}>
                  {MARK[steps[i] ?? "wait"]}
                </span>
                {line}
                <span className="visually-hidden">
                  {steps[i] === "ok" ? ": done" : steps[i] === "no" ? ": failed" : ": checking"}
                </span>
              </li>
            ))}
          </ul>
          {failure ? <p className={styles.problem}>{failure}</p> : null}
          {done ? (
            <>
              <p className={styles.tested}>{whereItIs(needs)}</p>
              <p className={styles.hint}>{toSeeThemPop(needs)}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Where a notification that arrived waits, on this device. */
function whereItIs(needs: AlertNeeds): string {
  if (needs.kind === "phone") return "Swipe down from the top of the screen to see it.";
  if (needs.system === "mac") {
    return "It’s in Notification Centre: click the date and time in the top-right corner of the screen.";
  }
  if (needs.system === "windows") {
    return "It’s in the notification panel: click the date and time at the bottom-right of the screen.";
  }
  return "It’s with your other notifications.";
}

/** What a web page can't see: whether the device puts them on screen. */
function toSeeThemPop(needs: AlertNeeds): string {
  if (needs.kind === "phone") {
    return "When Fennl isn’t on screen, timer notifications show on the lock screen and at the top. If they don’t, check that notifications are allowed for Fennl in the device’s settings, and that Do Not Disturb or a Focus isn’t on.";
  }
  const where =
    needs.system === "mac"
      ? `that ${needs.browser} is set to show banners or alerts in System Settings › Notifications`
      : needs.system === "windows"
        ? `that notifications are on for ${needs.browser} in Settings › System › Notifications`
        : `that notifications are allowed for ${needs.browser} in the computer’s settings`;
  return `When Fennl isn’t in front, timer notifications pop up on screen. If they don’t, check ${where}, and that Do Not Disturb or a Focus isn’t on.`;
}

/** A timer's notification that never reached this device (./arrivals.ts), until dismissed. */
function MissedNotice() {
  const missed = useMissed();
  const [needs] = useState<AlertNeeds>(() =>
    alertNeeds(navigator.userAgent, navigator.maxTouchPoints > 1),
  );
  if (!missed) return null;
  return (
    <div role="alert" className={styles.missed}>
      <p className={styles.notifyLine}>
        The notification for <strong>{missed.label}</strong> didn&rsquo;t arrive on this device.{" "}
        <button type="button" className={styles.textLink} onClick={dismissMissed}>
          Dismiss
        </button>
      </p>
      <details className={styles.howTheyWork}>
        <summary>What to check</summary>
        <ul className={styles.needs}>
          <li>
            The {needs.kind === "phone" ? "device" : "computer"} was connected
            {needs.kind === "phone" ? "" : " and awake (not asleep)"} when the timer ended; one that
            can&rsquo;t arrive within 10 minutes is dropped.
          </li>
          {needs.kind === "browser-running" ? (
            <li>{needs.browser} was running (quitting it stops notifications).</li>
          ) : null}
          <li>Then Send test notification under How they work checks it now.</li>
        </ul>
      </details>
    </div>
  );
}
