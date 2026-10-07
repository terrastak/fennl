import { statusText, type SyncStatus } from "./status";
import styles from "./sync.module.css";
import { useSyncStatus } from "./useSync";

function tone(status: SyncStatus): string {
  if (status.phase === "saved" && status.pending === 0) return "ok";
  if (status.phase === "syncing" || status.phase === "starting") return "busy";
  if (["signed_out", "upgrade", "unavailable"].includes(status.phase)) return "problem";
  return "waiting";
}

/** "Saved to cloud", "2 changes waiting"...: shown in the app's frame (phase C4). */
export function SyncStatusLine({ className }: { className?: string | undefined }) {
  const status = useSyncStatus();
  return (
    <p className={`${styles.status} ${className ?? ""}`} data-sync-status="">
      <span className={styles.dot} data-tone={tone(status)} aria-hidden="true" />
      {statusText(status)}
    </p>
  );
}
