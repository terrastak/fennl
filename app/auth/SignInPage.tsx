import { useState, type FormEvent } from "react";
import { navigate, queryParam } from "../navigation";
import { Link } from "../router";
import { AuthHeader } from "./AuthLayout";
import { authClient } from "./client";
import { Field, FormError } from "./fields";
import { authErrorMessage, linkErrorMessage } from "./messages";
import { rememberPendingEmail } from "./pendingEmail";
import { ProviderButtons } from "./ProviderButtons";
import styles from "./auth.module.css";

export function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Google, Apple or an old email link can send people back here with an error in the address.
  const [error, setError] = useState<string | null>(() => linkErrorMessage(queryParam("error")));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // No callbackURL: with one, Better Auth's client would jump there after signing in. A fresh
    // confirmation link (sent below for unconfirmed accounts) then leads to the recipes page.
    const { error: failure } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (!failure) {
      navigate("/", { replace: true });
    } else if (failure.code === "EMAIL_NOT_VERIFIED") {
      // Better Auth has just emailed a fresh confirmation link.
      rememberPendingEmail(email);
      navigate("/check-email");
    } else {
      setError(authErrorMessage(failure));
    }
  };

  return (
    <>
      <AuthHeader title="Sign in" note="Welcome back" />
      <FormError message={error} />
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
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aside={
            <Link href="/forgot-password" className={styles.smallLink}>
              Forgot password?
            </Link>
          }
        />
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <ProviderButtons />
      <p className={styles.footer}>
        New to Fennl? <Link href="/sign-up">Create an account</Link>
      </p>
    </>
  );
}
