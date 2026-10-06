import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EMAIL_CHANGE_HOURS, type EmailStatus } from "../../shared/email";
import { Field, FormError, FormNotice } from "../auth/fields";
import { verifiedText } from "./verified";
import styles from "./account.module.css";

const PROBLEMS: Record<string, string> = {
  invalid_email: "That doesn't look like an email address.",
  same_email: "That's already your email.",
  sign_in_again:
    "For your security, changing your email needs a recent sign-in. Sign out, sign back in, then try again.",
  not_while_impersonating: "Support changes this from the admin console.",
  too_many: "Too many tries. Please wait an hour, then try again.",
};

async function readStatus(): Promise<EmailStatus> {
  const res = await fetch("/api/account/email");
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as EmailStatus;
}

/** Settings › Email: the account's address, and changing it (phase B7a). */
export function EmailSection() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await readStatus());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    readStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/account/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newEmail }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(PROBLEMS[body?.error ?? ""] ?? "That didn't work. Please try again.");
      return;
    }
    setNewEmail("");
    await load();
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/email/pending", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res?.ok) setNotice("Change cancelled. Your email stays the same.");
    else setError("Couldn't cancel just now. Please try again.");
    await load();
  };

  return (
    <section aria-labelledby="email-title" className={styles.section}>
      <h2 id="email-title">Email</h2>
      {failed ? (
        <p role="alert" className={styles.help}>
          Couldn&rsquo;t load your email just now.
        </p>
      ) : status === null ? (
        <p role="status" className={styles.help}>
          Loading…
        </p>
      ) : (
        <>
          <p className={styles.current}>
            <span className={styles.address}>{status.email}</span>
            <br />
            <span className={styles.muted}>
              {verifiedText(status.emailVerified, status.emailVerifiedAt)}
            </span>
          </p>
          <FormNotice message={notice} />
          <FormError message={error} />
          {status.pending ? (
            <div className={styles.pending}>
              <p role="status">
                We sent a link to <strong>{status.pending.email}</strong>. Open it within{" "}
                {EMAIL_CHANGE_HOURS} hours to make it your email. Until then, your account keeps{" "}
                {status.email}.
              </p>
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void cancel()}
              >
                Cancel this change
              </button>
            </div>
          ) : null}
          <form className={styles.form} onSubmit={start} aria-label="Change your email">
            <Field
              label="New email address"
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              hint="We'll send a link to the new address. Your email changes when you open it."
            />
            <button type="submit" className={styles.button} disabled={busy}>
              {busy ? "Sending…" : "Send verification link"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
