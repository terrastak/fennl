import { useState } from "react";
import { Link } from "../router";
import { AuthHeader } from "./AuthLayout";
import { AFTER_VERIFY_PATH, authClient } from "./client";
import { FormError, FormNotice } from "./fields";
import { authErrorMessage } from "./messages";
import { pendingEmail } from "./pendingEmail";
import styles from "./auth.module.css";

export function CheckEmailPage() {
  const [email] = useState(pendingEmail);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          Open it to confirm your address and finish setting up your account.
        </p>
      </AuthHeader>
      <p className={styles.body}>
        It can take a minute to arrive. If you don&rsquo;t see it, check your spam or junk folder.
      </p>
      <FormError message={error} />
      <FormNotice message={notice} />
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
