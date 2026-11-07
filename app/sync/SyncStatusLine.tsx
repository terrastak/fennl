import { statusText, statusTone } from "./status";
import styles from "./sync.module.css";
import { useSyncStatus } from "./useSync";

/** "Saved to cloud", "2 changes waiting"...: shown in the app's frame (phase C4). */
export function SyncStatusLine({ className }: { className?: string | undefined }) {
  const status = useSyncStatus();
  return (
    <p className={`${styles.status} ${className ?? ""}`} data-sync-status="">
      <span className={styles.dot} data-tone={statusTone(status)} aria-hidden="true" />
      {statusText(status)}
    </p>
  );
}
