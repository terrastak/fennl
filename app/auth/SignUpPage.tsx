import { useState, type FormEvent } from "react";
import { navigate, queryParam } from "../navigation";
import { Link } from "../router";
import { AuthHeader } from "./AuthLayout";
import { AFTER_VERIFY_PATH, authClient } from "./client";
import { Field, FormError } from "./fields";
import { authErrorMessage, linkErrorMessage } from "./messages";
import { rememberPendingEmail } from "./pendingEmail";
import { ProviderButtons } from "./ProviderButtons";
import { checkSignUpCode } from "./signUpCode";
import { useSignInMethods } from "./useSignInMethods";
import styles from "./auth.module.css";

export function SignUpPage() {
  const { signUpCodeRequired } = useSignInMethods();
  const [code, setCode] = useState(() => queryParam("code") ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Google or Apple can send people back here with an error in the address.
  const [error, setError] = useState<string | null>(() => linkErrorMessage(queryParam("error")));

  /** Checks the code with the server first. False (with a message shown) if it can't be used. */
  const codeReady = async (): Promise<boolean> => {
    if (signUpCodeRequired && !code.trim()) {
      setError("Fennl is invite-only for now. Enter your invite code to create an account.");
      return false;
    }
    const problem = await checkSignUpCode(code);
    if (problem) setError(problem);
    return problem === null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    if (!(await codeReady())) {
      setBusy(false);
      return;
    }
    const { error: failure } = await authClient.signUp.email({
      name: name.trim(),
      email,
      password,
      callbackURL: AFTER_VERIFY_PATH,
    });
    setBusy(false);
    if (failure) {
      setError(authErrorMessage(failure));
      return;
    }
    rememberPendingEmail(email);
    navigate("/check-email");
  };

  return (
    <>
      <AuthHeader title="Create your account" note="Welcome to Fennl" />
      <FormError message={error} />
      <form className={styles.form} onSubmit={submit}>
        <Field
          label={signUpCodeRequired ? "Invite code" : "Promo code (optional)"}
          type="text"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required={signUpCodeRequired}
          hint={
            signUpCodeRequired
              ? "Fennl is invite-only for now. Your code is in your invite."
              : undefined
          }
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Field
          label="Your name"
          type="text"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
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
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? "Creating your account…" : "Create account"}
        </button>
      </form>
      <ProviderButtons
        returnTo="/sign-up"
        beforeStart={async () => {
          setError(null);
          return codeReady();
        }}
      />
      <p className={styles.footer}>
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </>
  );
}
