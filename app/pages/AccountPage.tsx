import { useEffect, useId, useState, type FormEvent } from "react";
import type { Entitlements } from "../../shared/entitlements";
import { authClient, useSession } from "../auth/client";
import { SignedInSection } from "../account/SignedInSection";
import { UsageCard } from "../limits/Usage";
import { codeErrorMessage } from "../auth/signUpCode";
import { navigate } from "../navigation";
import { Link } from "../router";
import { ACCOUNT_ICONS } from "../account/accountIcons";
import { usePointer } from "../recipes/usePointer";
import { PageHeader } from "./PageHeader";
import { planDetails, planName, planStatus } from "./plan";
import { CHECK, RowIcon, SettingsRow } from "./SettingsRow";
import acc from "./AccountPage.module.css";
import settings from "./SettingsPage.module.css";
import styles from "./pages.module.css";

const PROVIDER_NAMES: Record<string, string> = {
  credential: "Email and password",
  google: "Google",
  apple: "Apple",
};

export function AccountPage() {
  const { data: session } = useSession();
  const [methods, setMethods] = useState<string[] | null>(null);
  const [household, setHousehold] = useState<string | null>(null);
  const [plan, setPlan] = useState<Entitlements | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void authClient.listAccounts().then(({ data }) => {
      if (!cancelled && data)
        setMethods(data.map((a) => PROVIDER_NAMES[a.providerId] ?? a.providerId));
    });
    fetch("/api/household")
      .then((res) => (res.ok ? (res.json() as Promise<{ name: string }>) : null))
      .then((body) => {
        if (!cancelled && body) setHousehold(body.name);
      })
      .catch(() => {});
    fetch("/api/entitlements")
      .then((res) => (res.ok ? (res.json() as Promise<Entitlements>) : null))
      .then((body) => {
        if (!cancelled && body) setPlan(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    setBusy(true);
    await authClient.signOut();
    navigate("/sign-in", { replace: true });
  };

  const laptop = usePointer();
  if (!session) return null;

  if (laptop) {
    // On a laptop (U23 slice 9): laid out like Settings, a plain heading above one white box of
    // rows per section; the same words in the same order as elsewhere.
    return (
      <div className={`${settings.page} ${acc.page}`}>
        <PageHeader title="Account" />
        <section className={settings.section} aria-labelledby="account-details">
          <h2 id="account-details">Your account</h2>
          <div className={`${settings.box} ${acc.box}`}>
            <SettingsRow
              name={<span className={acc.who}>{session.user.name}</span>}
              help={<p className={settings.help}>{session.user.email}</p>}
            >
              <button
                type="button"
                className={settings.rowButton}
                onClick={signOut}
                disabled={busy}
              >
                <RowIcon path={ACCOUNT_ICONS.signOut} />
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </SettingsRow>
            <SettingsRow name="Household" className={acc.fact}>
              <span className={acc.value}>{household ?? "…"}</span>
            </SettingsRow>
            <SettingsRow name="Sign in with" className={acc.fact}>
              <span className={acc.value}>{methods ? methods.join(", ") : "…"}</span>
            </SettingsRow>
          </div>
        </section>
        {plan ? <PlanSection plan={plan} laptop /> : null}
        <UsageCard className={settings.section ?? ""} />
        <SignedInSection />
        <CodeSection onUsed={setPlan} laptop />
        <section className={settings.section} aria-labelledby="feedback-title">
          <h2 id="feedback-title">Help shape Fennl</h2>
          <div className={`${settings.box} ${acc.box}`}>
            <SettingsRow
              name="Send feedback"
              help={
                <p className={settings.help}>
                  Found something broken, or have an idea? We read every message.
                </p>
              }
            >
              <Link href="/feedback?from=%2Faccount" className={settings.rowButton}>
                <RowIcon path={ACCOUNT_ICONS.chat} />
                Send feedback
              </Link>
            </SettingsRow>
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Account" />
      <section className={styles.card} aria-labelledby="account-details">
        <h2 id="account-details">{session.user.name}</h2>
        <dl className={styles.details}>
          <div>
            <dt>Email</dt>
            <dd>{session.user.email}</dd>
          </div>
          <div>
            <dt>Household</dt>
            <dd>{household ?? "…"}</dd>
          </div>
          <div>
            <dt>Sign in with</dt>
            <dd>{methods ? methods.join(", ") : "…"}</dd>
          </div>
        </dl>
        <button type="button" className={styles.button} onClick={signOut} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </section>
      {plan ? <PlanSection plan={plan} /> : null}
      <UsageCard className={`${styles.card} ${styles.stacked}`} />
      <SignedInSection />
      <CodeSection onUsed={setPlan} />
      <section className={`${styles.card} ${styles.stacked}`} aria-labelledby="feedback-title">
        <h2 id="feedback-title">Help shape Fennl</h2>
        <p>Found something broken, or have an idea? We read every message.</p>
        <Link href="/feedback?from=%2Faccount" className={styles.button}>
          Send feedback
        </Link>
      </section>
    </>
  );
}

function PlanSection({ plan, laptop = false }: { plan: Entitlements; laptop?: boolean }) {
  const status = planStatus(plan);
  if (laptop) {
    // The plan's name and what happens when it ends at the top of the box, then what it includes
    // in three short columns.
    return (
      <section className={settings.section} aria-labelledby="plan-title">
        <p className={acc.sectionTitle} aria-hidden="true">
          Your plan
        </p>
        <div className={`${settings.box} ${acc.box}`}>
          <div className={`${settings.row} ${settings.rowTop}`}>
            <div className={settings.rowText}>
              <h2 id="plan-title" className={acc.planName}>
                <span className="visually-hidden">Your plan: </span>
                {planName(plan)}
              </h2>
              {status ? <p className={settings.help}>{status}</p> : null}
            </div>
          </div>
          <dl className={acc.planDetails}>
            {planDetails(plan).map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    );
  }
  return (
    <section className={`${styles.card} ${styles.stacked}`} aria-labelledby="plan-title">
      <p className={styles.eyebrow} aria-hidden="true">
        Your plan
      </p>
      <h2 id="plan-title">
        <span className="visually-hidden">Your plan: </span>
        {planName(plan)}
      </h2>
      {status ? <p>{status}</p> : null}
      <dl className={styles.details}>
        {planDetails(plan).map((line) => (
          <div key={line.label}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** "Have a code?": an invite or promo code that gives this household Premium. */
function CodeSection({
  onUsed,
  laptop = false,
}: {
  onUsed: (plan: Entitlements) => void;
  laptop?: boolean;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/codes/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as unknown;
      if (res.ok) {
        const plan = body as Entitlements;
        onUsed(plan);
        setCode("");
        setMessage({ kind: "success", text: `Done. You now have ${planName(plan)}.` });
      } else {
        setMessage({ kind: "error", text: codeErrorMessage(body, res.status) });
      }
    } catch {
      setMessage({ kind: "error", text: "We couldn't reach Fennl. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  if (laptop) {
    // The box and a soft grey Use code on one row; the answer just under it, a short red line
    // with a warning sign when the code didn't work.
    return (
      <section className={settings.section} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Have a code?</h2>
        <div className={`${settings.box} ${acc.box}`}>
          <SettingsRow
            name="Invite or promo code"
            labelFor={`${id}-code`}
            help={
              <p className={settings.help}>Invite and promo codes add Premium to your account.</p>
            }
          >
            <form className={acc.codeForm} onSubmit={submit}>
              <input
                id={`${id}-code`}
                className={acc.codeInput}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                required
                value={code}
                aria-invalid={message?.kind === "error" ? true : undefined}
                aria-describedby={message ? `${id}-message` : undefined}
                onChange={(e) => setCode(e.target.value)}
              />
              <button type="submit" className={acc.softButton} disabled={busy}>
                {busy ? "Checking…" : "Use code"}
              </button>
            </form>
          </SettingsRow>
          {message ? (
            <p
              id={`${id}-message`}
              role={message.kind === "error" ? "alert" : "status"}
              className={message.kind === "error" ? acc.codeError : acc.codeDone}
            >
              <RowIcon
                path={message.kind === "error" ? ACCOUNT_ICONS.alert : CHECK}
                className={acc.codeIcon}
              />
              {message.text}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.card} ${styles.stacked}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Have a code?</h2>
      <p>Invite and promo codes add Premium to your account.</p>
      <form className={styles.codeForm} onSubmit={submit}>
        <div className={styles.field}>
          <label htmlFor={`${id}-code`}>Code</label>
          <input
            id={`${id}-code`}
            className={styles.input}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? "Checking…" : "Use code"}
        </button>
      </form>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? styles.error : styles.success}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
