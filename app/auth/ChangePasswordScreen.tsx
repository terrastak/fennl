import { useState, type FormEvent } from "react";
import { AuthHeader } from "./AuthLayout";
import { authClient } from "./client";
import { Field, FormError } from "./fields";
import { authErrorMessage } from "./messages";
import { navigate } from "../navigation";
import styles from "./auth.module.css";

/**
 * Shown instead of the app after Fennl support set a temporary password (phase B7): the person
 * chooses their own before anything else. The server refuses household requests until then.
 */
export function ChangePasswordScreen({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: password }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onChanged();
      return;
    }
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
    setError(
      code === "INVALID_PASSWORD"
        ? "The temporary password isn't right. Check it and try again."
        : code === "SAME_PASSWORD"
          ? "Choose a new password, different from the temporary one."
          : authErrorMessage({ code }),
    );
  };

  const signOut = async () => {
    setBusy(true);
    await authClient.signOut();
    navigate("/sign-in", { replace: true });
  };

  return (
    <>
      <AuthHeader title="Choose a new password">
        <p>
          You signed in with a temporary password from Fennl support. Choose your own to carry on.
        </p>
      </AuthHeader>
      <FormError message={error} />
      <form className={styles.form} onSubmit={submit}>
        <Field
          label="Temporary password"
          type="password"
          name="current-password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
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
          label="New password again"
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
        <button type="button" className={styles.secondaryButton} onClick={signOut} disabled={busy}>
          Sign out
        </button>
      </form>
    </>
  );
}
