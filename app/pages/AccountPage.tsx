import { PageHeader } from "./PageHeader";
import styles from "./pages.module.css";

export function AccountPage() {
  return (
    <>
      <PageHeader title="Account" />
      <section className={styles.card} aria-labelledby="account-title">
        <span className={styles.soon}>Coming soon</span>
        <h2 id="account-title">Sign in</h2>
        <p>
          Accounts are on the way. Your recipes will be stored in your account, and this browser
          will keep a copy for speed.
        </p>
      </section>
    </>
  );
}
