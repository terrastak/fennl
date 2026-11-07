import { useEffect, useState } from "react";
import { SettingsRow, StatusDot } from "../pages/SettingsRow";
import styles from "../pages/SettingsPage.module.css";
import { usePointer } from "../recipes/usePointer";
import { statusText, statusTone } from "./status";
import { useSyncStatus } from "./useSync";

/** Opened from the home screen or dock (an installed app) rather than in a browser tab. */
function installed(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Settings › This browser's copy (phase C4): what's kept here and whether the browser promised
 * to keep it. With offline editing, changes can wait here, so a browser that won't promise gets
 * a suggestion to install the app (C2: Edge in a tab said no; home-screen apps are kept). On a
 * laptop it's a row of the "Your recipes and this browser" box, its status on the right (U23).
 */
export function LocalCopySection() {
  const laptop = usePointer();
  const status = useSyncStatus();
  const [kept, setKept] = useState<boolean | null>(null);

  useEffect(() => {
    let stopped = false;
    void navigator.storage
      ?.persisted?.()
      .then((value) => {
        if (!stopped) setKept(value);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [status.offlineEnabled]);

  const stored = (
    <p className={styles.help}>
      Your recipes are stored in your account. This browser keeps a copy so Fennl is fast
      {status.offlineEnabled
        ? " and opens and works while you’re offline"
        : " and opens to read while you’re offline"}
      . If the browser clears it, nothing is lost: it&rsquo;s downloaded again.
    </p>
  );
  const notKept =
    status.offlineEnabled && kept === false && !installed() ? (
      <p className={styles.help}>
        This browser hasn&rsquo;t promised to keep the copy, so changes you make offline are safest
        once you&rsquo;re back online. Installing Fennl helps: on a phone, use Share › Add to Home
        Screen; on a computer, use the install button in the address bar.
      </p>
    ) : null;

  if (laptop) {
    return (
      <SettingsRow
        name="This browser’s copy"
        top
        help={
          <>
            {stored}
            {notKept}
          </>
        }
      >
        <p className={styles.status}>
          <span className={styles.statusLabel}>Right now:</span>
          <StatusDot tone={statusTone(status)} />
          {statusText(status)}
        </p>
      </SettingsRow>
    );
  }

  return (
    <section aria-labelledby="copy-title" className={styles.section}>
      <h2 id="copy-title">This browser&rsquo;s copy</h2>
      {stored}
      <p className={styles.help}>Right now: {statusText(status)}.</p>
      {notKept}
    </section>
  );
}
