import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { FeedbackInbox } from "../../shared/feedback";
import { adminRequest } from "./api";
import { adminAuthClient, loadAdminState, type AdminMe, type AdminState } from "./client";
import { AccountPage, AccountsSection } from "./AccountsSection";
import { AttentionSection } from "./AttentionSection";
import { AiSection } from "./AiSection";
import { ActivitySection } from "./ActivitySection";
import { FeedbackSection } from "./FeedbackSection";
import { CodesSection, SignUpSwitch } from "./CodesSection";
import { LimitsSection } from "./LimitsSection";
import { AdminPanel } from "./AdminPanel";
import { AdminIcon } from "./AdminIcon";
import { SECTIONS, useSlashToFind, type SectionId } from "./adminSections";
import { timeZoneQuery, type AttentionOverview } from "./accountView";
import { Logo } from "../shell/Logo";
import { usePointer } from "../recipes/usePointer";
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

  // On a laptop (U23) the console is a left panel beside the page once signed in, and the other
  // screens one small box in the middle; elsewhere the top bar and the row of buttons as before.
  const laptop = usePointer();
  // Signed in, the same tree on every screen (Home draws its own frame), so an open account and
  // its tools stay put when a window is made narrower or wider.
  if (state.kind === "ready") {
    return <Home me={state.me} refresh={refresh} signOut={signOut} laptop={laptop} />;
  }
  if (laptop) {
    return (
      <main id="main" className={styles.entry} tabIndex={-1}>
        <p className={styles.entryBrand}>
          <Logo />
          <span className={styles.adminTag}>Admin</span>
        </p>
        <Screen state={state} refresh={refresh} signOut={signOut} />
        {state.kind === "passkey_sign_in" ? (
          <button type="button" className={styles.entryOut} onClick={() => void signOut()}>
            Sign out
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <>
      <header className={styles.bar}>
        <p className={styles.brand}>Fennl admin</p>
        {state.kind === "not_admin" || state.kind === "passkey_sign_in" ? (
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
      // Drawn by AdminApp itself (Home).
      return null;
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

function AddBackupPasskey({
  refresh,
  laptop = false,
}: {
  refresh: () => Promise<void>;
  laptop?: boolean;
}) {
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
      <button
        type="button"
        className={laptop ? `${styles.quiet} ${styles.outdent}` : styles.secondary}
        onClick={add}
      >
        {laptop ? <AdminIcon name="key" /> : null}
        Add a backup passkey
      </button>
    </>
  );
}

const BACK_LABELS: Partial<Record<SectionId, string>> = {
  attention: "Back to Needs attention",
  accounts: "Back to search",
  feedback: "Back to feedback",
};

function Home({
  me,
  refresh,
  signOut,
  laptop,
}: {
  me: AdminMe;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  laptop: boolean;
}) {
  // The account just acted as (/admin?account=…) opens straight away; otherwise Needs attention.
  const [account, setAccount] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("account"),
  );
  const [section, setSection] = useState<SectionId>(() => (account ? "accounts" : "attention"));
  // The last search, so "Back to search" shows it again.
  const [query, setQuery] = useState("");
  // A feedback message to open, from an account page.
  const [feedbackOpen, setFeedbackOpen] = useState<string | null>(null);
  const [newFeedback, setNewFeedback] = useState<number | null>(null);
  const onCounts = useCallback((counts: FeedbackInbox["counts"]) => setNewFeedback(counts.new), []);
  // Going back from an account page removes the button that had focus: it goes to the page's
  // heading, so the keyboard carries on from the top of the section, not the top of the page.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  useEffect(() => {
    if (account || !focusTitle.current) return;
    focusTitle.current = false;
    titleRef.current?.focus();
  }, [account]);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<FeedbackInbox>("/api/admin/feedback?status=new").then((result) => {
      if (!cancelled && result.ok) setNewFeedback((result.body as FeedbackInbox).counts.new);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The left panel on a laptop: how many accounts need you, and Find an account ("/" jumps to it).
  const [attentionCount, setAttentionCount] = useState<number | null>(null);
  const [searchRun, setSearchRun] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  useSlashToFind(findRef, laptop);
  const countAttention = useCallback(() => {
    void adminRequest<AttentionOverview>(`/api/admin/attention${timeZoneQuery()}`).then(
      (result) => {
        if (result.ok) setAttentionCount((result.body as AttentionOverview).items.length);
      },
    );
  }, []);
  // Opened on an account (back from acting as someone), Needs attention isn't loaded to count.
  // Once Needs attention has counted, it isn't asked again here.
  const countAsked = useRef(false);
  useEffect(() => {
    if (!laptop || countAsked.current || section === "attention" || attentionCount !== null) return;
    countAsked.current = true;
    countAttention();
  }, [laptop, section, attentionCount, countAttention]);

  const show = (next: SectionId) => {
    setAccount(null);
    setFeedbackOpen(null);
    setSection(next);
  };
  const openAccount = (userId: string, from: SectionId) => {
    setFeedbackOpen(null);
    setSection(from);
    setAccount(userId);
  };

  const nav = (
    <nav aria-label="Admin sections" className={styles.nav}>
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={styles.navButton}
          aria-current={!account && section === s.id ? "page" : undefined}
          onClick={() => show(s.id)}
        >
          {s.name}
          {s.id === "feedback" && newFeedback ? ` (${newFeedback} new)` : ""}
        </button>
      ))}
    </nav>
  );

  const sections = (
    <>
      {section === "attention" ? (
        <AttentionSection
          onFind={(q) => {
            setQuery(q);
            setSection("accounts");
          }}
          onOpen={(userId) => openAccount(userId, "attention")}
          onCount={setAttentionCount}
        />
      ) : null}
      {section === "accounts" ? (
        <AccountsSection
          key={searchRun}
          query={query}
          onOpen={(userId, q) => {
            setQuery(q);
            openAccount(userId, "accounts");
          }}
        />
      ) : null}
      {section === "feedback" ? (
        <FeedbackSection
          onCounts={onCounts}
          initialOpen={feedbackOpen}
          onOpenAccount={(userId) => openAccount(userId, "feedback")}
        />
      ) : null}
      {section === "codes" ? (
        laptop ? (
          <section
            className={`${styles.page} ${styles.settingsPage}`}
            aria-labelledby="codes-page-title"
          >
            <header className={styles.pageHead}>
              <h2 id="codes-page-title" className={styles.pageTitle}>
                Codes and sign-up
              </h2>
              <p className={styles.pageLede}>
                Codes give free Premium. They never touch money: price discounts are Stripe
                promotion codes.
              </p>
            </header>
            <SignUpSwitch laptop />
            <CodesSection laptop />
          </section>
        ) : (
          <>
            <CodesSection />
            <SignUpSwitch />
          </>
        )
      ) : null}
      {section === "limits" ? <LimitsSection laptop={laptop} /> : null}
      {section === "ai" ? <AiSection laptop={laptop} /> : null}
      {section === "activity" ? <ActivitySection laptop={laptop} /> : null}
      {section === "you" ? <You me={me} refresh={refresh} laptop={laptop} /> : null}
    </>
  );

  const accountPage = account ? (
    <AccountPage
      key={account}
      id={account}
      backLabel={BACK_LABELS[section] ?? "Back to search"}
      onBack={() => {
        focusTitle.current = true;
        setAccount(null);
      }}
      onOpenFeedback={(feedbackId) => {
        setAccount(null);
        setFeedbackOpen(feedbackId);
        setSection("feedback");
      }}
      onFindingsChanged={laptop ? countAttention : undefined}
    />
  ) : null;

  // A laptop: the left panel beside the page (U23); elsewhere the top bar, the page's title and
  // the row of buttons, as before. The account page and the sections keep their place in the tree
  // either way.
  return (
    <div className={laptop ? styles.frame : undefined}>
      {laptop ? (
        <a className={styles.skipLink} href="#main">
          Skip to content
        </a>
      ) : null}
      {laptop ? (
        <AdminPanel
          me={me}
          section={section}
          accountOpen={account !== null}
          attentionCount={attentionCount}
          newFeedback={newFeedback}
          findRef={findRef}
          onShow={show}
          onFind={(q) => {
            setQuery(q);
            setSearchRun((n) => n + 1);
            show("accounts");
          }}
          onSignOut={() => void signOut()}
        />
      ) : (
        <header className={styles.bar}>
          <p className={styles.brand}>Fennl admin</p>
          <button type="button" className={styles.barButton} onClick={() => void signOut()}>
            Sign out
          </button>
        </header>
      )}
      <main id="main" className={laptop ? styles.frameMain : styles.main} tabIndex={-1}>
        {accountPage ? null : (
          <h1 ref={titleRef} className={laptop ? "visually-hidden" : styles.title} tabIndex={-1}>
            Admin console
          </h1>
        )}
        {laptop ? null : nav}
        {accountPage ?? sections}
      </main>
    </div>
  );
}

function You({
  me,
  refresh,
  laptop,
}: {
  me: AdminMe;
  refresh: () => Promise<void>;
  laptop: boolean;
}) {
  if (laptop) {
    // A laptop (U23): the page's title, then its facts as a white box of rows, as Settings.
    return (
      <section className={styles.page} aria-labelledby="you-title">
        <header className={styles.pageHead}>
          <h2 id="you-title" className={styles.pageTitle}>
            Your admin account
          </h2>
          <p className={styles.pageLede}>Signed in as {me.name}</p>
        </header>
        <dl className={styles.infoRows}>
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
        <div className={styles.underBox}>
          {me.passkeys.length < 2 ? (
            <p className={styles.muted}>
              Add a second passkey (another device, or a security key) so losing one doesn&rsquo;t
              lock you out.
            </p>
          ) : null}
          <AddBackupPasskey refresh={refresh} laptop />
        </div>
      </section>
    );
  }
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
