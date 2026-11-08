import { useEffect, useState } from "react";
import { adminRequest } from "./api";
import styles from "./admin.module.css";

export interface ActivityRow {
  id: string;
  action: string;
  createdAt: string;
  adminEmail: string | null;
  targetEmail: string | null;
  reason?: string | null;
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
  "impersonation.started": "Started acting as them",
  "impersonation.change": "Changed something while acting as them",
  "impersonation.ended": "Stopped acting as them",
  "premium.extended": "Extended Premium",
  "email.unblocked": "Unblocked an address",
  "sign_up.address_fixed": "Changed a sign-up address",
  "sign_up.link_sent": "Sent a sign-up link again",
  "finding.handled": "Marked something handled",
  "finding.unhandled": "Put something back in Needs attention",
};

function detailText(row: ActivityRow): string {
  const d = row.details ?? {};
  const parts = [d.method, d.code, d.key, d.tier]
    .filter((v) => typeof v === "string" && v)
    .map(String);
  if (typeof d.until === "string") {
    parts.push(`until ${new Date(d.until).toLocaleDateString(undefined, { dateStyle: "medium" })}`);
  }
  if (typeof d.title === "string") parts.push(d.title);
  if (typeof d.from === "string" && typeof d.to === "string") parts.push(`${d.from} → ${d.to}`);
  else if ("to" in d) parts.push(`→ ${d.to === null ? "no limit" : String(d.to)}`);
  if (typeof d.value !== "undefined" && !("to" in d)) {
    parts.push(`= ${d.value === null ? "no limit" : String(d.value)}`);
  }
  // Acting as someone (phase C12): why, and what was changed.
  const acting: string[] = [];
  if (row.reason) acting.push(`Reason: ${row.reason}`);
  if (typeof d.request === "string") acting.push(d.request);
  if (Array.isArray(d.changes)) acting.push(...d.changes.map(String));
  return [parts.join(" "), ...acting].filter(Boolean).join(" · ");
}

/** An address that may break before its "@" on a laptop's table, never inside a word. */
function address(email: string | null, boxed: boolean) {
  if (!email) return "";
  const at = email.indexOf("@");
  if (!boxed || at < 1) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

export function ActivityTable({
  rows,
  boxed = false,
}: {
  rows: ActivityRow[] | null;
  /** A laptop's Activity page: the table in a white box of its own (U23). */
  boxed?: boolean;
}) {
  if (rows === null) {
    return (
      <p role="status" className={boxed ? styles.boxNote : undefined}>
        Loading…
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className={boxed ? styles.boxNote : styles.muted}>Nothing yet.</p>;
  }
  return (
    <div className={boxed ? `${styles.tableWrap} ${styles.tableBox}` : styles.tableWrap}>
      <table className={boxed ? `${styles.table} ${styles.activityTable}` : styles.table}>
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
              <td>{address(row.adminEmail, boxed)}</td>
              <td>{ACTION_NAMES[row.action] ?? row.action}</td>
              <td>{address(row.targetEmail, boxed)}</td>
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

export function ActivitySection({ laptop = false }: { laptop?: boolean }) {
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
  if (laptop) {
    return (
      <section className={styles.page} aria-labelledby="activity-title">
        <header className={styles.pageHead}>
          <h2 id="activity-title" className={styles.pageTitle}>
            Recent admin activity
          </h2>
          <p className={styles.pageLede}>
            Every admin action, newest first. It can&rsquo;t be changed or deleted, and a copy is
            kept in locked storage.
          </p>
        </header>
        <ActivityTable rows={rows} boxed />
      </section>
    );
  }
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
