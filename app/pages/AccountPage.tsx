import { useEffect, useId, useState, type FormEvent } from "react";
import type { Entitlements } from "../../shared/entitlements";
import { authClient, useSession } from "../auth/client";
import { codeErrorMessage } from "../auth/signUpCode";
import { navigate } from "../navigation";
import { PageHeader } from "./PageHeader";
import { planDetails, planName, planStatus } from "./plan";
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

  if (!session) return null;

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
        <p>
          Your recipes are stored in your account. This browser keeps a temporary copy for speed.
        </p>
        <button type="button" className={styles.button} onClick={signOut} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </section>
      {plan ? <PlanSection plan={plan} /> : null}
      <CodeSection onUsed={setPlan} />
    </>
  );
}

function PlanSection({ plan }: { plan: Entitlements }) {
  const status = planStatus(plan);
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
function CodeSection({ onUsed }: { onUsed: (plan: Entitlements) => void }) {
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
