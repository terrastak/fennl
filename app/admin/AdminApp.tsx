import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { FeedbackInbox } from "../../shared/feedback";
import { adminRequest } from "./api";
import { adminAuthClient, loadAdminState, type AdminMe, type AdminState } from "./client";
import { AccountsSection } from "./AccountsSection";
import { ActivitySection } from "./ActivitySection";
import { FeedbackSection } from "./FeedbackSection";
import { CodesSection, SignUpSwitch } from "./CodesSection";
import { LimitsSection } from "./LimitsSection";
import styles from "./admin.module.css";

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
    case "impersonating":
      return (
        <Narrow title="You're acting as someone">
          <p className={styles.muted}>
            This browser is acting as another account. Go back to it, or stop acting to use the
            console.
          </p>
          <div className={styles.row}>
            <a className={styles.button} href="/">
              Back to their recipes
            </a>
            <button
              type="button"
              className={styles.secondary}
              onClick={() =>
                void fetch("/api/admin/impersonation/stop", { method: "POST" }).then(refresh)
              }
            >
              Stop acting as them
            </button>
          </div>
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

const SECTIONS = [
  { id: "accounts", name: "Accounts" },
  { id: "feedback", name: "Feedback" },
  { id: "codes", name: "Codes and sign-up" },
  { id: "limits", name: "Plan limits" },
  { id: "activity", name: "Activity" },
  { id: "you", name: "Your admin account" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Home({ me, refresh }: { me: AdminMe; refresh: () => Promise<void> }) {
  const [section, setSection] = useState<SectionId>("accounts");
  // An account opened from the feedback inbox, or the one just acted as (/admin?account=…).
  const [account, setAccount] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("account"),
  );
  const [newFeedback, setNewFeedback] = useState<number | null>(null);
  const onCounts = useCallback((counts: FeedbackInbox["counts"]) => setNewFeedback(counts.new), []);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<FeedbackInbox>("/api/admin/feedback?status=new").then((result) => {
      if (!cancelled && result.ok) setNewFeedback((result.body as FeedbackInbox).counts.new);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const show = (next: SectionId) => {
    setAccount(null);
    setSection(next);
  };
  return (
    <>
      <h1 className={styles.title} tabIndex={-1}>
        Admin console
      </h1>
      <nav aria-label="Admin sections" className={styles.nav}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.navButton}
            aria-current={section === s.id ? "page" : undefined}
            onClick={() => show(s.id)}
          >
            {s.name}
            {s.id === "feedback" && newFeedback ? ` (${newFeedback} new)` : ""}
          </button>
        ))}
      </nav>
      {section === "accounts" ? <AccountsSection key={account ?? ""} open={account} /> : null}
      {section === "feedback" ? (
        <FeedbackSection
          onCounts={onCounts}
          onOpenAccount={(userId) => {
            setAccount(userId);
            setSection("accounts");
          }}
        />
      ) : null}
      {section === "codes" ? (
        <>
          <CodesSection />
          <SignUpSwitch />
        </>
      ) : null}
      {section === "limits" ? <LimitsSection /> : null}
      {section === "activity" ? <ActivitySection /> : null}
      {section === "you" ? <You me={me} refresh={refresh} /> : null}
    </>
  );
}

function You({ me, refresh }: { me: AdminMe; refresh: () => Promise<void> }) {
  return (
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
          Add a second passkey (another device, or a security key) so losing one doesn&rsquo;t lock
          you out.
        </p>
      ) : null}
      <AddBackupPasskey refresh={refresh} />
    </section>
  );
}
