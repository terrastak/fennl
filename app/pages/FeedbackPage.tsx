import { useId, useState, type FormEvent } from "react";
import { MAX_FEEDBACK_LENGTH } from "../../shared/feedback";
import { useSession } from "../auth/client";
import { queryParam } from "../navigation";
import { PageHeader } from "./PageHeader";
import styles from "./pages.module.css";

const PROBLEMS: Record<string, string> = {
  invalid_message: "Please write a message first.",
  too_many: "You've sent a lot of messages in the last hour. Please try again a bit later.",
};

/** Send feedback (phase B8). The page they came from, the app version and the browser go too. */
export function FeedbackPage() {
  const id = useId();
  const { data: session } = useSession();
  const [from] = useState(() => queryParam("from"));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, page: from, appVersion: __APP_VERSION__ }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(PROBLEMS[body?.error ?? ""] ?? "That didn't send. Please try again.");
      return;
    }
    setMessage("");
    setSent(true);
  };

  return (
    <>
      <PageHeader title="Send feedback" note="we read every one">
        <p>
          Tell us what&rsquo;s not working, what&rsquo;s confusing, or what you&rsquo;d love to see.
        </p>
      </PageHeader>
      <section className={styles.card} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Your message</h2>
        {sent ? (
          <>
            <p role="status" className={styles.success}>
              Thank you! Your message reached the Fennl team.
              {session ? ` If we have a question, we'll email you at ${session.user.email}.` : ""}
            </p>
            <button type="button" className={styles.button} onClick={() => setSent(false)}>
              Send another
            </button>
          </>
        ) : (
          <form onSubmit={send} className={styles.stackForm}>
            <div className={styles.field}>
              <label htmlFor={`${id}-message`}>What would you like to tell us?</label>
              <textarea
                id={`${id}-message`}
                className={styles.textarea}
                required
                rows={6}
                maxLength={MAX_FEEDBACK_LENGTH}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-describedby={`${id}-hint`}
              />
              <p id={`${id}-hint`} className={styles.hint}>
                We also see which page you came from, the app version and your browser, to help us
                look into it.
              </p>
            </div>
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
            <button type="submit" className={styles.button} disabled={busy}>
              {busy ? "Sending…" : "Send feedback"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
