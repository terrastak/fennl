import { useEffect, useState } from "react";
import { adminRequest } from "./api";
import styles from "./admin.module.css";

export interface ActivityRow {
  id: string;
  action: string;
  createdAt: string;
  adminEmail: string | null;
  targetEmail: string | null;
  details: Record<string, unknown> | null;
}

const ACTION_NAMES: Record<string, string> = {
  "admin.sign_in": "Signed in",
  "admin.passkey_registered": "Added a passkey",
  "admin.role_changed": "Admin role changed (database)",
  "admin.passkey_removed": "Passkey removed (database)",
  "code.created": "Created a code",
  "code.updated": "Changed a code",
  "code.disabled": "Turned off a code",
  "setting.changed": "Changed invite-only sign-up",
  "account.viewed": "Opened an account",
  "account.password_reset_sent": "Sent a password reset email",
  "account.temporary_password_set": "Set a temporary password",
  "account.signed_out_everywhere": "Signed an account out everywhere",
  "account.email_change_started": "Started an email change",
  "account.email_change_cancelled": "Cancelled an email change",
  "account.email_restored": "Put back an earlier email",
  "limit.override_set": "Set an account's limit",
  "limit.override_removed": "Removed an account's limit",
  "limit.tier_changed": "Changed a plan limit",
  "feedback.read": "Read feedback",
  "feedback.updated": "Updated feedback",
};

function detailText(row: ActivityRow): string {
  const d = row.details ?? {};
  const parts = [d.method, d.code, d.key, d.tier]
    .filter((v) => typeof v === "string" && v)
    .map(String);
  if (typeof d.from === "string" && typeof d.to === "string") parts.push(`${d.from} → ${d.to}`);
  else if ("to" in d) parts.push(`→ ${d.to === null ? "no limit" : String(d.to)}`);
  if (typeof d.value !== "undefined" && !("to" in d)) {
    parts.push(`= ${d.value === null ? "no limit" : String(d.value)}`);
  }
  return parts.join(" ");
}

export function ActivityTable({ rows }: { rows: ActivityRow[] | null }) {
  if (rows === null) return <p role="status">Loading…</p>;
  if (rows.length === 0) return <p className={styles.muted}>Nothing yet.</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Admin</th>
            <th scope="col">What</th>
            <th scope="col">Account</th>
            <th scope="col">Details</th>
            <th scope="col">From</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.createdAt).toLocaleString()}</td>
              <td>{row.adminEmail ?? ""}</td>
              <td>{ACTION_NAMES[row.action] ?? row.action}</td>
              <td>{row.targetEmail ?? ""}</td>
              <td>{detailText(row)}</td>
              <td>
                {[row.details?.ip, row.details?.country]
                  .filter((v) => typeof v === "string" && v)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActivitySection() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void adminRequest<ActivityRow[]>("/api/admin/audit").then((result) => {
      if (!cancelled) setRows(result.ok ? (result.body as ActivityRow[]) : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section className={styles.card} aria-labelledby="activity-title">
      <h2 id="activity-title">Recent admin activity</h2>
      <p className={styles.muted}>
        Every admin action, newest first. It can&rsquo;t be changed or deleted, and a copy is kept
        in locked storage.
      </p>
      <ActivityTable rows={rows} />
    </section>
  );
}
