import { useEffect, useState } from "react";
import { authClient, useSession } from "../auth/client";
import { navigate } from "../navigation";
import { PageHeader } from "./PageHeader";
import styles from "./pages.module.css";

const PROVIDER_NAMES: Record<string, string> = {
  credential: "Email and password",
  google: "Google",
  apple: "Apple",
};

export function AccountPage() {
  const { data: session } = useSession();
  const [methods, setMethods] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void authClient.listAccounts().then(({ data }) => {
      if (!cancelled && data)
        setMethods(data.map((a) => PROVIDER_NAMES[a.providerId] ?? a.providerId));
    });
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
    </>
  );
}
