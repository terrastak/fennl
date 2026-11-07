import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { EMAIL_CHANGE_HOURS, type EmailStatus } from "../../shared/email";
import { useSession } from "../auth/client";
import { FormError, FormNotice } from "../auth/fields";
import fieldStyles from "../auth/auth.module.css";
import { NAVIGATE_EVENT } from "../navigation";
import { CHECK, PEN, RowIcon } from "../pages/SettingsRow";
import settings from "../pages/SettingsPage.module.css";
import { usePointer } from "../recipes/usePointer";
import { verifiedText } from "./verified";
import styles from "./account.module.css";

const PROBLEMS: Record<string, string> = {
  invalid_email: "That doesn't look like an email address.",
  same_email: "That's already your email.",
  sign_in_again:
    "For your security, changing your email needs a recent sign-in. Sign out, sign back in, then try again.",
  not_while_impersonating: "Support changes this from the admin console.",
  too_many: "Too many tries. Please wait an hour, then try again.",
};

async function readStatus(): Promise<EmailStatus> {
  const res = await fetch("/api/account/email");
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as EmailStatus;
}

/** Emails to the address stopped arriving (phase U14), as said under it. */
function problemText(problem: EmailStatus["problem"]): string | null {
  if (problem === "complained") {
    return "An email to this address was marked as spam, so Fennl has stopped emailing it.";
  }
  return problem ? "Emails to this address aren’t arriving." : null;
}

/**
 * Scrolls to the section when the address ends in #email (the email notice's "Change your email"
 * links here) and calls `arrive`, which opens the box for a new address. It waits a frame, so it
 * comes after the app frame moves focus to the page's heading on a page change (which would
 * scroll back to the top and take the focus).
 */
function useScrollHere(arrive: () => void) {
  useEffect(() => {
    let frame = 0;
    const here = () => {
      if (window.location.hash !== "#email") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        document.getElementById("email")?.scrollIntoView();
        arrive();
      });
    };
    here();
    window.addEventListener(NAVIGATE_EVENT, here);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(NAVIGATE_EVENT, here);
    };
  }, [arrive]);
}

/**
 * Settings › Email: the account's address, and changing it (phase B7a). "Change email…" opens the
 * new address's box in place, with Cancel beside "Send verification link" (U23). On a laptop the
 * address is a row of a white box with the button on its right.
 */
export function EmailSection() {
  const laptop = usePointer();
  // Read again when the session's word on the address changes ("This address is right").
  const sessionProblem = useSession().data?.user.emailProblem ?? null;
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const formId = useId();
  const fieldId = useId();

  const load = useCallback(async () => {
    try {
      setStatus(await readStatus());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    readStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionProblem]);

  // The box's field takes focus as it opens, or as soon as it shows when the address is still
  // loading (arriving from the email notice's link).
  const focusField = useRef(false);
  useEffect(() => {
    if (!open || !focusField.current || !input.current) return;
    focusField.current = false;
    input.current.focus();
  }, [open, status]);

  const openBox = useCallback(() => {
    setNotice(null);
    setError(null);
    focusField.current = true;
    setOpen(true);
    // Already open (the notice's link followed again): just move to the field.
    input.current?.focus();
  }, []);

  useScrollHere(openBox);

  /** Closes the box, forgetting what was typed, and gives focus back to "Change email…". */
  const closeBox = () => {
    setOpen(false);
    setNewEmail("");
    setFormError(null);
    // After the box is gone, so the button is where it was.
    requestAnimationFrame(() => opener.current?.focus());
  };

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/account/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newEmail }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setFormError(PROBLEMS[body?.error ?? ""] ?? "That didn't work. Please try again.");
      input.current?.focus();
      return;
    }
    closeBox();
    await load();
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/email/pending", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res?.ok) setNotice("Change cancelled. Your email stays the same.");
    else setError("Couldn't cancel just now. Please try again.");
    await load();
  };

  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || busy) return;
    event.preventDefault();
    event.stopPropagation();
    closeBox();
  };

  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const changeButton = (
    <button
      ref={opener}
      type="button"
      className={laptop ? settings.rowButton : styles.button}
      aria-expanded={open}
      aria-controls={open ? formId : undefined}
      onClick={() => (open ? closeBox() : openBox())}
    >
      {laptop ? <RowIcon path={PEN} /> : null}
      Change email…
    </button>
  );

  const form = open ? (
    <form
      id={formId}
      className={laptop ? styles.subform : styles.form}
      onSubmit={start}
      onKeyDown={escape}
      aria-label="Change your email"
    >
      <label className={fieldStyles.label} htmlFor={fieldId}>
        New email address
      </label>
      <div className={styles.formLine}>
        <input
          ref={input}
          id={fieldId}
          className={fieldStyles.input}
          type="email"
          autoComplete="email"
          required
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          aria-describedby={formError ? `${errorId} ${hintId}` : hintId}
          aria-invalid={formError ? true : undefined}
        />
        <div className={styles.formButtons}>
          <button
            type="submit"
            className={laptop ? styles.sendButton : styles.button}
            disabled={busy}
          >
            {busy ? "Sending…" : "Send verification link"}
          </button>
          <button
            type="button"
            className={laptop ? styles.cancelButton : styles.button}
            disabled={busy}
            onClick={closeBox}
          >
            Cancel
          </button>
        </div>
      </div>
      <p id={hintId} className={fieldStyles.hint}>
        We&rsquo;ll send a link to the new address. Your email changes when you open it.
      </p>
      {formError ? (
        <p id={errorId} role="alert" className={fieldStyles.error}>
          {formError}
        </p>
      ) : null}
    </form>
  ) : null;

  const verified = status ? verifiedText(status.emailVerified, status.emailVerifiedAt) : "";
  const problem = status ? problemText(status.problem) : null;

  const pending = status?.pending ? (
    <div className={laptop ? styles.pendingRow : styles.pending}>
      <p role="status">
        We sent a link to <strong>{status.pending.email}</strong>. Open it within{" "}
        {EMAIL_CHANGE_HOURS} hours to make it your email. Until then, your account keeps{" "}
        {status.email}.
      </p>
      <button
        type="button"
        className={laptop ? settings.rowButton : styles.button}
        disabled={busy}
        onClick={() => void cancel()}
      >
        Cancel this change
      </button>
    </div>
  ) : null;

  return (
    <section
      aria-labelledby="email-title"
      className={laptop ? settings.section : styles.section}
      id="email"
    >
      <h2 id="email-title">Email</h2>
      {failed ? (
        <p role="alert" className={styles.help}>
          Couldn&rsquo;t load your email just now.
        </p>
      ) : status === null ? (
        <p role="status" className={styles.help}>
          Loading…
        </p>
      ) : laptop ? (
        <div className={settings.box}>
          <div className={settings.row}>
            <div className={settings.rowText}>
              <p className={styles.address}>{status.email}</p>
              <p className={styles.verified}>
                {status.emailVerified ? (
                  <RowIcon path={CHECK} className={styles.verifiedIcon} />
                ) : null}
                {verified}
              </p>
              {problem ? <p className={styles.problem}>{problem}</p> : null}
              <FormNotice message={notice} />
              <FormError message={error} />
            </div>
            <div className={settings.rowControl}>{changeButton}</div>
          </div>
          {pending}
          {form}
        </div>
      ) : (
        <>
          <p className={styles.current}>
            <span className={styles.address}>{status.email}</span>
            <br />
            <span className={styles.muted}>{verified}</span>
            {problem ? (
              <>
                <br />
                <span className={styles.problem}>{problem}</span>
              </>
            ) : null}
          </p>
          <FormNotice message={notice} />
          <FormError message={error} />
          {pending}
          <p className={styles.opener}>{changeButton}</p>
          {form}
        </>
      )}
    </section>
  );
}
