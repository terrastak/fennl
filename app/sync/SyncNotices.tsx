import styles from "./sync.module.css";
import { useSyncStatus } from "./useSync";
import { useNewVersion } from "./version";

const reload = () => window.location.reload();

/**
 * Notices above every page when syncing needs the person (phase C4): a newer release to load,
 * editing paused without a connection (plans without offline editing), signed out, or a browser
 * that can't keep a copy.
 */
export function SyncNotices() {
  const status = useSyncStatus();
  const newVersion = useNewVersion();
  const notices: { key: string; text: string; action?: string }[] = [];

  if (newVersion || status.phase === "upgrade") {
    notices.push({
      key: "version",
      text: "A new version of Fennl is ready.",
      action: "Reload to update",
    });
  }
  if (!status.offlineEnabled && status.phase === "offline") {
    notices.push({
      key: "offline",
      text: "You’re offline. Editing is paused until you’re back online, so nothing gets lost.",
    });
  }
  if (!status.offlineEnabled && status.phase === "waiting") {
    notices.push({
      key: "waiting",
      text: "Your last change hasn’t reached your account yet. Editing is paused while Fennl keeps trying.",
    });
  }
  if (status.phase === "signed_out") {
    notices.push({
      key: "signed-out",
      text: "This browser was signed out.",
      action: "Sign in again",
    });
  }
  if (status.phase === "unavailable") {
    notices.push({
      key: "unavailable",
      text: "This browser can’t keep a copy of your recipes, so they can’t be shown here. A normal (not private) window, or another browser, should work.",
    });
  }
  if (notices.length === 0) return null;

  return (
    <div className={styles.notices}>
      {notices.map((notice) => (
        <div key={notice.key} role="alert" className={styles.notice}>
          <p>{notice.text}</p>
          {notice.action ? (
            <button type="button" onClick={reload}>
              {notice.action}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
