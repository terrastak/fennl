import { useState, type FormEvent } from "react";
import { Link } from "../router";
import { AuthHeader } from "./AuthLayout";
import { RESET_PASSWORD_PATH, authClient } from "./client";
import { Field, FormError, FormNotice } from "./fields";
import { authErrorMessage } from "./messages";
import styles from "./auth.module.css";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.requestPasswordReset({
      email,
      redirectTo: RESET_PASSWORD_PATH,
    });
    setBusy(false);
    if (failure) setError(authErrorMessage(failure));
    else setSentTo(email);
  };

  return (
    <>
      <AuthHeader title="Reset your password">
        <p>Enter your account&rsquo;s email and we&rsquo;ll send you a link to choose a new one.</p>
      </AuthHeader>
      <FormError message={error} />
      <FormNotice
        message={
          sentTo
            ? `If there's a Fennl account for ${sentTo}, a reset link is on its way. It works for 1 hour. Check your spam folder if it doesn't arrive.`
            : null
        }
      />
      <form className={styles.form} onSubmit={submit}>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className={styles.footer}>
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </>
  );
}
