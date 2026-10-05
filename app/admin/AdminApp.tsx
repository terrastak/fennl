import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  adminAuthClient,
  loadAdminState,
  type AdminMe,
  type AdminState,
  type AuditRow,
} from "./client";
import { CodesSection, SignUpSwitch } from "./CodesSection";
import styles from "./admin.module.css";

const ACTION_NAMES: Record<string, string> = {
  "admin.sign_in": "Signed in",
  "admin.passkey_registered": "Added a passkey",
  "admin.role_changed": "Admin role changed (database)",
  "admin.passkey_removed": "Passkey removed (database)",
  "code.created": "Created a code",
  "code.updated": "Changed a code",
  "code.disabled": "Turned off a code",
  "setting.changed": "Changed invite-only sign-up",
};

function time(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "";
}

/** The admin console: which screen to show is decided by the server (GET /api/admin/me). */
export function AdminApp() {
  const [state, setState] = useState<AdminState>({ kind: "loading" });
  const refresh = useCallback(async () => setState(await loadAdminState()), []);

  useEffect(() => {
    let cancelled = false;
    void loadAdminState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await adminAuthClient.signOut();
    await refresh();
  };

  return (
    <>
      <header className={styles.bar}>
        <p className={styles.brand}>Fennl admin</p>
        {state.kind === "ready" ||
        state.kind === "not_admin" ||
        state.kind === "passkey_sign_in" ? (
          <button type="button" className={styles.barButton} onClick={signOut}>
            Sign out
          </button>
        ) : null}
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        <Screen state={state} refresh={refresh} signOut={signOut} />
      </main>
    </>
  );
}

function Screen({
  state,
  refresh,
  signOut,
}: {
  state: AdminState;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}) {
  switch (state.kind) {
    case "loading":
      return <p role="status">Loading…</p>;
    case "closed":
      return (
        <Narrow title="The admin area is closed">
          <p className={styles.muted}>
            Open it through its admin address, after Cloudflare Access.
          </p>
        </Narrow>
      );
    case "error":
      return (
        <Narrow title="Something went wrong">
          <button type="button" className={styles.button} onClick={() => void refresh()}>
            Try again
          </button>
        </Narrow>
      );
    case "signed_out":
      return <SignIn expired={state.expired} refresh={refresh} />;
    case "not_admin":
      return (
        <Narrow title="Not an admin account">
          <p className={styles.muted}>This account can&rsquo;t use the admin area.</p>
          <button type="button" className={styles.secondary} onClick={() => void signOut()}>
            Sign out
          </button>
        </Narrow>
      );
    case "passkey_setup":
      return <PasskeySetup refresh={refresh} />;
    case "passkey_sign_in":
      return (
        <Narrow title="Use your passkey">
          <p className={styles.muted}>
            Admin access needs this account&rsquo;s passkey, not its password.
          </p>
          <PasskeyButton label="Sign in with passkey" refresh={refresh} />
        </Narrow>
      );
    case "ready":
      return <Home me={state.me} refresh={refresh} />;
  }
}

function Narrow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.narrow}>
      <h1 className={styles.title} tabIndex={-1}>
        {title}
      </h1>
      <div className={styles.card}>{children}</div>
    </div>
  );
}

function PasskeyButton({ label, refresh }: { label: string; refresh: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError(null);
    const result = await adminAuthClient.signIn.passkey();
    setBusy(false);
    if (result?.error) setError("That didn't work. Try again with this account's passkey.");
    else await refresh();
  };
  return (
    <>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <button type="button" className={styles.button} onClick={go} disabled={busy}>
        {busy ? "Waiting for your passkey…" : label}
      </button>
    </>
  );
}

function SignIn({ expired, refresh }: { expired: boolean; refresh: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const { error: failure } = await adminAuthClient.signIn.email({ email, password });
    if (failure) setError("That email and password don't match.");
    else await refresh();
  };

  return (
    <Narrow title="Sign in">
      {expired ? (
        <p role="status" className={styles.muted}>
          Your admin session ended. Admin sessions last 30 minutes without use, and 8 hours at most.
        </p>
      ) : null}
      <div className={styles.stack}>
        <PasskeyButton label="Sign in with passkey" refresh={refresh} />
        <p className={styles.muted}>
          Setting up? Sign in with the admin account&rsquo;s email and password once, then add a
          passkey.
        </p>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <form className={styles.stack} onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className={styles.secondary}>
            Sign in with password
          </button>
        </form>
      </div>
    </Narrow>
  );
}

function PasskeySetup({ refresh }: { refresh: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setError(null);
    const added = await adminAuthClient.passkey.addPasskey({ name: "Admin passkey" });
    if (added?.error) {
      setBusy(false);
      setError("The passkey wasn't saved. Try again.");
      return;
    }
    // Admin access needs a passkey sign-in, so use the new passkey straight away.
    const signedIn = await adminAuthClient.signIn.passkey();
    setBusy(false);
    if (signedIn?.error) setError("Passkey saved. Now sign in with it.");
    await refresh();
  };
  return (
    <Narrow title="Set up your passkey">
      <p className={styles.muted}>
        The admin area only opens with a passkey (or a hardware security key). Add one for this
        account now. You&rsquo;ll get an email about it.
      </p>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <button type="button" className={styles.button} onClick={add} disabled={busy}>
        {busy ? "Waiting for your device…" : "Add a passkey"}
      </button>
    </Narrow>
  );
}

function AddBackupPasskey({ refresh }: { refresh: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null);
  const add = async () => {
    setMessage(null);
    const added = await adminAuthClient.passkey.addPasskey({ name: "Backup passkey" });
    if (added?.error) setMessage("The passkey wasn't saved. Try again.");
    else await refresh();
  };
  return (
    <>
      {message ? (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      ) : null}
      <button type="button" className={styles.secondary} onClick={add}>
        Add a backup passkey
      </button>
    </>
  );
}

function Home({ me, refresh }: { me: AdminMe; refresh: () => Promise<void> }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    fetch("/api/admin/audit")
      .then((res) => (res.ok ? (res.json() as Promise<AuditRow[]>) : []))
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  return (
    <>
      <h1 className={styles.title} tabIndex={-1}>
        Admin console
      </h1>
      <CodesSection />
      <SignUpSwitch />
      <section className={styles.card} aria-labelledby="you-title">
        <h2 id="you-title">Signed in as {me.name}</h2>
        <dl className={styles.details}>
          <div>
            <dt>Account</dt>
            <dd>{me.email}</dd>
          </div>
          <div>
            <dt>Signed in</dt>
            <dd>{time(me.signedInAt)}</dd>
          </div>
          <div>
            <dt>Session ends</dt>
            <dd>{time(me.expiresAt)} (30 minutes without use, 8 hours at most)</dd>
          </div>
          <div>
            <dt>Passkeys</dt>
            <dd>
              {me.passkeys.length
                ? me.passkeys.map((p) => `${p.name ?? "Passkey"} (${time(p.createdAt)})`).join(", ")
                : "None"}
            </dd>
          </div>
        </dl>
        {me.passkeys.length < 2 ? (
          <p className={styles.muted}>
            Add a second passkey (another device, or a security key) so losing one doesn&rsquo;t
            lock you out.
          </p>
        ) : null}
        <AddBackupPasskey refresh={refresh} />
      </section>
      <section className={styles.card} aria-labelledby="activity-title">
        <h2 id="activity-title">Recent admin activity</h2>
        {rows === null ? (
          <p role="status">Loading…</p>
        ) : rows.length === 0 ? (
          <p className={styles.muted}>Nothing yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Details</th>
                  <th scope="col">From</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{time(row.createdAt)}</td>
                    <td>{ACTION_NAMES[row.action] ?? row.action}</td>
                    <td>{row.details?.method ?? row.details?.code ?? ""}</td>
                    <td>{[row.details?.ip, row.details?.country].filter(Boolean).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
