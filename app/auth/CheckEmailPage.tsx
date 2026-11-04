import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeEmail } from "../../shared/email";
import { suggestEmail } from "../../shared/emailTypos";
import { Link } from "../router";
import { AuthHeader } from "./AuthLayout";
import { AFTER_VERIFY_PATH, authClient } from "./client";
import { Field, FormError } from "./fields";
import { authErrorMessage } from "./messages";
import { pendingEmail, rememberPendingEmail } from "./pendingEmail";
import { changeSignUpAddress, useSignUpLinkState, type AddressProblem } from "./signUpStatus";
import styles from "./auth.module.css";

const ADDRESS_PROBLEMS: Record<AddressProblem, string> = {
  invalid_email: "That doesn’t look like an email address.",
  too_many: "Too many tries. Please wait an hour, then try again.",
  failed: "That didn’t work. Please try again.",
};

export function CheckEmailPage() {
  const [email, setEmail] = useState(pendingEmail);
  // Asking starts again each time the address is fixed.
  const [round, setRound] = useState(0);
  const linkState = useSignUpLinkState(round);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // After a fix the form the person was using goes; focus moves to the notice saying where the
  // new link went, so keyboard and screen reader users don't start again from the top.
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);
  useEffect(() => {
    if (!focusNotice.current || !noticeRef.current) return;
    focusNotice.current = false;
    noticeRef.current.focus();
  });

  const resend = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    const { error: failure } = await authClient.sendVerificationEmail({
      email,
      callbackURL: AFTER_VERIFY_PATH,
    });
    setBusy(false);
    if (failure) setError(authErrorMessage(failure));
    else setNotice(`We sent another link to ${email}.`);
  };

  const fixAddress = async (typed: string): Promise<boolean> => {
    const next = normalizeEmail(typed);
    setNotice(null);
    setError(null);
    if (!next) {
      setError(ADDRESS_PROBLEMS.invalid_email);
      return false;
    }
    setBusy(true);
    const problem = await changeSignUpAddress(next);
    setBusy(false);
    if (problem) {
      setError(ADDRESS_PROBLEMS[problem]);
      return false;
    }
    rememberPendingEmail(next);
    focusNotice.current = true;
    setEmail(next);
    setRound((n) => n + 1);
    setNotice(`We sent a new link to ${next}.`);
    return true;
  };

  if (linkState === "not_arriving") {
    return (
      <>
        <AuthHeader title="Check your email" />
        <NotArriving
          key={`${round}:${email}`}
          email={email}
          busy={busy}
          error={error}
          onFix={fixAddress}
        />
        <p className={styles.footer}>
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHeader title="Check your email">
        <p>
          {email ? (
            <>
              We sent a link to <strong>{email}</strong>.
            </>
          ) : (
            "We sent you a link."
          )}{" "}
          Open it to verify your address and finish setting up your account.
        </p>
      </AuthHeader>
      {linkState === "delayed" ? (
        <p role="status" className={styles.notice}>
          The link is taking longer than usual to arrive. It should still come; check your spam or
          junk folder too.
        </p>
      ) : (
        <p className={styles.body}>
          It can take a minute to arrive. If you don&rsquo;t see it, check your spam or junk folder.
        </p>
      )}
      {linkState === "not_sent" ? (
        <p role="alert" className={styles.error}>
          We couldn&rsquo;t send the link just now. Try Resend email in a few minutes.
        </p>
      ) : null}
      <FormError message={error} />
      {notice ? (
        <p ref={noticeRef} role="status" tabIndex={-1} className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <div className={styles.stack}>
        {email ? (
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={resend}>
            {busy ? "Sending…" : "Resend email"}
          </button>
        ) : null}
      </div>
      <p className={styles.footer}>
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </>
  );
}

interface NotArrivingProps {
  email: string;
  busy: boolean;
  error: string | null;
  onFix: (address: string) => Promise<boolean>;
}

/**
 * The sign-up link bounced (phase U14): says so, offers the likely address when the domain looks
 * like a typo of a common one, and lets the person type the right one. The account (name,
 * password, invite code) stays as it is; only its address changes.
 */
function NotArriving({ email, busy, error, onFix }: NotArrivingProps) {
  const [typed, setTyped] = useState(email);
  const suggestion = email ? suggestEmail(email) : null;
  // This replaces the page the person was on (the Resend email button may have had focus):
  // when focus was lost with it, start them at what went wrong.
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.id === "main") alertRef.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onFix(typed);
  };

  return (
    <>
      <p ref={alertRef} role="alert" tabIndex={-1} className={styles.error}>
        We couldn&rsquo;t deliver the link to{" "}
        {email ? <strong>{email}</strong> : "the address you gave"}. Check the address.
      </p>
      <FormError message={error} />
      {suggestion ? (
        <div className={styles.suggestion}>
          <p>
            Did you mean <strong>{suggestion}</strong>?
          </p>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => void onFix(suggestion)}
          >
            Use {suggestion}
          </button>
        </div>
      ) : null}
      <form className={styles.form} onSubmit={submit} aria-label="Correct your email address">
        <Field
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={typed}
          aria-invalid={error === ADDRESS_PROBLEMS.invalid_email ? true : undefined}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button
          type="submit"
          className={suggestion ? styles.secondaryButton : styles.button}
          disabled={busy}
        >
          {busy ? "Sending…" : "Send the link there"}
        </button>
      </form>
    </>
  );
}
