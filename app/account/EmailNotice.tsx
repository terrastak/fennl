import { useState } from "react";
import { isActing, type ActingSession } from "../acting/acting";
import { useSession } from "../auth/client";
import { Link } from "../router";
import styles from "../sync/sync.module.css";

/** Why the account's emails aren't arriving, as the session says (phase U14). */
type EmailProblem = "bounced" | "complained" | "suppressed";

const FAILURES: Record<string, string> = {
  too_many: "You can do this once a day. Try again tomorrow, or change your email.",
  not_while_impersonating: "Support changes this from the admin console.",
};

function asProblem(value: unknown): EmailProblem | null {
  return value === "bounced" || value === "complained" || value === "suppressed" ? value : null;
}

function focusPageHeading() {
  const main = document.getElementById("main");
  const heading = main?.querySelector<HTMLElement>("h1");
  heading?.focus();
  if (document.activeElement !== heading) main?.focus();
}

/**
 * The notice above every page when emails to the account's address stopped arriving (phase
 * U14): they bounced, or one was marked as spam. It stays until the address changes (Settings ›
 * Email) or the person says it's right, which has Fennl try it again.
 */
export function EmailNotice() {
  const { data, refetch } = useSession();
  const session = data as
    (ActingSession & { user: { email: string; emailProblem?: string | null } }) | null;
  const problem = asProblem(session?.user.emailProblem);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!session || !problem) return null;
  const acting = isActing(session);
  const email = session.user.email;

  const addressIsRight = async () => {
    setBusy(true);
    setFailure(null);
    const res = await fetch("/api/account/email/address-is-right", { method: "POST" }).catch(
      () => null,
    );
    if (res?.ok) {
      await refetch();
      setBusy(false);
      // The notice (and the button pressed) goes, so keyboard and screen reader users carry on
      // from the page's heading rather than the top of the document.
      focusPageHeading();
      return;
    }
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    setFailure(FAILURES[body?.error ?? ""] ?? "That didn’t work. Please try again.");
  };

  return (
    <div className={styles.notices}>
      <div role="alert" className={styles.notice}>
        {problem === "complained" ? (
          <p>
            An email from Fennl to <strong>{email}</strong> was marked as spam, so Fennl has stopped
            emailing you, password reset links included.
          </p>
        ) : (
          <p>
            Emails to <strong>{email}</strong> aren&rsquo;t reaching you, so you&rsquo;d miss things
            like password reset links.
          </p>
        )}
        <Link href="/settings#email">Change your email</Link>
        <button type="button" disabled={busy || acting} onClick={() => void addressIsRight()}>
          {problem === "complained" ? "Start emails again" : "This address is right"}
        </button>
        {failure ? <p className={styles.noticeFailure}>{failure}</p> : null}
      </div>
    </div>
  );
}
