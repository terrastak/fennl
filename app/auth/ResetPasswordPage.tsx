import { useState, type FormEvent } from "react";
import { queryParam } from "../navigation";
import { Link } from "../router";
import { AuthHeader } from "./AuthLayout";
import { authClient } from "./client";
import { Field, FormError } from "./fields";
import { authErrorMessage, linkErrorMessage } from "./messages";
import styles from "./auth.module.css";

/** Where the link in a password-reset email lands, with ?token=… (or ?error=… if it expired). */
export function ResetPasswordPage() {
  const [token] = useState(() => queryParam("token"));
  const [linkError] = useState(() =>
    token ? null : (linkErrorMessage(queryParam("error")) ?? linkErrorMessage("invalid_token")),
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (linkError) {
    return (
      <>
        <AuthHeader title="That link didn't work">
          <p>{linkError} Reset links work for 1 hour and only once.</p>
        </AuthHeader>
        <Link href="/forgot-password" className={styles.button}>
          Send a new link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthHeader title="Password changed">
          <p>You&rsquo;ve been signed out everywhere. Sign in with your new password.</p>
        </AuthHeader>
        <Link href="/sign-in" className={styles.button}>
          Go to sign in
        </Link>
      </>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.resetPassword({
      newPassword: password,
      token: token ?? "",
    });
    setBusy(false);
    if (failure) setError(authErrorMessage(failure));
    else setDone(true);
  };

  return (
    <>
      <AuthHeader title="Choose a new password" />
      <FormError message={error} />
      <form className={styles.form} onSubmit={submit}>
        <Field
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Type it again"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    </>
  );
}
