import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AccountDetail } from "../../shared/adminAccounts";
import type { EmailHistoryEntry } from "../../shared/email";
import { suggestEmail } from "../../shared/emailTypos";
import type { LimitKey } from "../../shared/entitlements";
import { planName } from "../pages/plan";
import { ActivityTable, type ActivityRow } from "./ActivitySection";
import { EMAIL_PROBLEM_WORDS, dateValue, endOfDay, type AccountFacts } from "./accountView";
import { TOOL_TITLES, type OpenTool } from "./toolList";
import { adminRequest, errorOf } from "./api";
import { LIMIT_LABELS, LIMIT_ORDER, inputValue, isBytes, parseInput, showLimit } from "./limits";
import styles from "./admin.module.css";

// "Everything you can do" on the account page (phase U15): each tool opens its panel, with values
// filled in when a finding's button opened it. The tools themselves are the ones from B7, B7a and
// C12, plus Extend Premium, Unblock and the sign-up link.

type OnChange = (next: AccountDetail | null) => Promise<void>;

function when(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Never";
}

function longDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" });
}

/** "passkey" beside a tool that asks for it again; said in full to screen readers. */
export function PasskeyMark() {
  return (
    <span className={styles.key}>
      <span aria-hidden="true">passkey</span>
      <span className="visually-hidden">, asks for your passkey again</span>
    </span>
  );
}

/** One open tool: its heading takes the focus when it opens, so the admin lands on it. */
export function ToolPanel({
  id,
  tool,
  detail,
  onChange,
  onClose,
  activity,
}: {
  id: string;
  tool: OpenTool;
  detail: AccountFacts;
  onChange: OnChange;
  onClose: () => void;
  activity: ActivityRow[] | null;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [tool]);
  const title = TOOL_TITLES[tool.id];
  return (
    <section id={id} className={`${styles.card} ${styles.panel}`} aria-labelledby={`${id}-title`}>
      <div className={styles.panelHead}>
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" className={styles.linkButton} onClick={onClose}>
          Close<span className="visually-hidden"> {title}</span>
        </button>
      </div>
      {tool.id === "view_as" ? <ActAs detail={detail} /> : null}
      {tool.id === "premium" ? (
        <ExtendPremium detail={detail} onChange={onChange} tier={tool.prefill.tier} />
      ) : null}
      {tool.id === "limits" ? (
        <Overrides
          detail={detail}
          onChange={onChange}
          initialKey={tool.prefill.limit}
          initialValue={tool.prefill.value}
        />
      ) : null}
      {tool.id === "email" ? <EmailTools detail={detail} onChange={onChange} /> : null}
      {tool.id === "sign_up" ? (
        <SignUpTools detail={detail} onChange={onChange} suggestion={tool.prefill.email} />
      ) : null}
      {tool.id === "password" ? <PasswordHelp detail={detail} onChange={onChange} /> : null}
      {tool.id === "admin_log" ? (
        <>
          <p className={styles.muted}>
            Every admin action on this account, newest first, with the reason given and where it
            came from.
          </p>
          <ActivityTable rows={activity} />
        </>
      ) : null}
    </section>
  );
}

function Message({ message, error }: { message: ReactNode | null; error: string | null }) {
  return (
    <>
      {message ? (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Reads a changed account from an answer: the account itself, or `{ detail }`. */
function detailFrom(body: unknown): AccountDetail | null {
  if (!body || typeof body !== "object") return null;
  if ("id" in body && "email" in body) return body as AccountDetail;
  const inner = (body as { detail?: unknown }).detail;
  return inner && typeof inner === "object" && "id" in inner ? (inner as AccountDetail) : null;
}

async function reloadDetail(id: string): Promise<AccountDetail | null> {
  const result = await adminRequest<AccountDetail>(`/api/admin/accounts/${encodeURIComponent(id)}`);
  return result.ok ? (result.body as AccountDetail) : null;
}

// ---------------------------------------------------------------------------------------------

const ACT_ERRORS: Record<string, string> = {
  reason_required: "Say why, in a few words: it’s kept in the admin log.",
  target_is_admin: "Admin accounts can’t be viewed as.",
  passkey_reconfirm: "Your passkey is needed again. Try once more.",
};

/** "View as this user" (phase C12): a reason, the passkey again, then the app as them. */
function ActAs({ detail }: { detail: AccountDetail }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await adminRequest<unknown>(
      `/api/admin/accounts/${encodeURIComponent(detail.id)}/impersonate`,
      { body: { reason } },
    );
    if (result.ok) {
      // The app, as them (on this admin address, in its own browser storage).
      window.location.assign("/");
      return;
    }
    setBusy(false);
    setError(ACT_ERRORS[errorOf(result) ?? ""] ?? "That didn’t work. Try again.");
  };

  return (
    <>
      <p className={styles.muted}>
        Use Fennl exactly as they see it, to help them or look into a problem. They aren&rsquo;t
        told, and it never shows in their devices or sessions. It ends after 30 minutes. Every
        change you make is recorded under your name, with your reason, in the admin log.
        You&rsquo;ll be asked for your passkey.
      </p>
      <Message message={null} error={error} />
      {detail.role === "admin" ? (
        <p className={styles.muted}>Admin accounts can&rsquo;t be viewed as.</p>
      ) : (
        <form onSubmit={(e) => void start(e)}>
          <div className={styles.field}>
            <label htmlFor={`${id}-reason`}>Reason (kept in the admin log)</label>
            <textarea
              id={`${id}-reason`}
              rows={2}
              minLength={5}
              maxLength={500}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className={styles.row}>
            <button
              type="submit"
              className={styles.button}
              disabled={busy || reason.trim().length < 5}
            >
              {busy ? "Opening…" : "View as this user"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

const PREMIUM_ERRORS: Record<string, string> = {
  reason_required: "Say why, in a few words: it’s kept in the admin log.",
  invalid_until: "Choose a day in the future, at most 2 years ahead.",
  invalid_tier: "Choose Individual or Household.",
  no_household: "This account has no household yet, so there’s nothing to give Premium to.",
  target_is_admin: "Admin accounts can’t be given Premium here.",
  passkey_reconfirm: "Your passkey is needed again. Try once more.",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The plan to suggest: what the newest code gave them, else Individual. */
function suggestedTier(detail: AccountFacts): "individual" | "household" {
  const newest = [...detail.grants].sort((a, b) => b.usedAt.localeCompare(a.usedAt))[0];
  return newest?.tier === "household" ? "household" : "individual";
}

/** "Extend Premium…" (U15): Premium until a day, without a code. The passkey again, and a reason. */
function ExtendPremium({
  detail,
  onChange,
  tier: startTier,
}: {
  detail: AccountFacts;
  onChange: OnChange;
  tier?: "individual" | "household" | undefined;
}) {
  const id = useId();
  const [now] = useState(() => Date.now());
  const [tier, setTier] = useState<"individual" | "household">(startTier ?? suggestedTier(detail));
  const [until, setUntil] = useState(() => {
    const ends = detail.plan?.ends_at ? Date.parse(detail.plan.ends_at) : 0;
    return dateValue(new Date(Math.max(ends, now) + 30 * DAY_MS));
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    const ends = endOfDay(until);
    const result = await adminRequest<AccountDetail>(
      `/api/admin/accounts/${encodeURIComponent(detail.id)}/premium`,
      { body: { tier, until: ends, reason } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(PREMIUM_ERRORS[errorOf(result) ?? ""] ?? "That didn’t save. Try again.");
      return;
    }
    setReason("");
    setMessage(
      `Premium ${tier === "household" ? "Household" : "Individual"} until ${longDay(ends)}. It’s in the admin log.`,
    );
    await onChange(detailFrom(result.body) ?? (await reloadDetail(detail.id)));
  };

  const live = detail.adminGrants.filter((g) => !g.revokedAt && Date.parse(g.endsAt) > now);
  const earliest = dateValue(new Date(now + DAY_MS));
  const latest = dateValue(new Date(now + 730 * DAY_MS));
  return (
    <>
      <p className={styles.muted}>
        Gives the household Premium until the day you choose, without a code. If a code already
        gives them Premium for longer, that still counts. Asks for your passkey again, and your
        reason goes in the admin log.
      </p>
      <p>
        Now: {detail.plan ? planName(detail.plan) : "No household yet"}
        {detail.plan?.ends_at ? `, until ${longDay(detail.plan.ends_at)}` : ""}.
        {live.length > 0
          ? ` Given by an admin: ${live
              .map(
                (g) =>
                  `${g.tier === "household" ? "Household" : "Individual"} until ${longDay(g.endsAt)}${g.by ? ` (by ${g.by})` : ""}`,
              )
              .join("; ")}.`
          : ""}
      </p>
      <Message message={message} error={error} />
      <form className={styles.stack} onSubmit={(e) => void save(e)}>
        <fieldset className={styles.choices}>
          <legend>Plan</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name={`${id}-tier`}
              checked={tier === "individual"}
              onChange={() => setTier("individual")}
            />
            Individual
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name={`${id}-tier`}
              checked={tier === "household"}
              onChange={() => setTier("household")}
            />
            Household
          </label>
        </fieldset>
        <div className={styles.field}>
          <label htmlFor={`${id}-until`}>Premium until</label>
          <input
            id={`${id}-until`}
            type="date"
            required
            min={earliest}
            max={latest}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-reason`}>Reason (kept in the admin log)</label>
          <textarea
            id={`${id}-reason`}
            rows={2}
            minLength={5}
            maxLength={500}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button
            type="submit"
            className={styles.button}
            disabled={busy || reason.trim().length < 5 || !until}
          >
            Extend Premium
            <PasskeyMark />
          </button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function Overrides({
  detail,
  onChange,
  initialKey,
  initialValue,
}: {
  detail: AccountDetail;
  onChange: OnChange;
  initialKey?: LimitKey | undefined;
  initialValue?: number | null | undefined;
}) {
  const id = useId();
  const [key, setKey] = useState<LimitKey>(initialKey ?? "max_recipes");
  const [value, setValue] = useState(
    initialKey && initialValue !== undefined ? inputValue(initialKey, initialValue) : "",
  );
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseInput(key, value);
    if (parsed === undefined) {
      setError("Enter a number, or leave it blank for no limit.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await adminRequest<AccountDetail>(
      `/api/admin/accounts/${encodeURIComponent(detail.id)}/overrides/${key}`,
      {
        method: "PUT",
        body: { value: parsed, expiresAt: expires ? endOfDay(expires) : null, note },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setError(
        errorOf(result) === "invalid_expiry"
          ? "The end date must be in the future."
          : "That didn’t save. Try again.",
      );
      return;
    }
    setValue("");
    setExpires("");
    setNote("");
    await onChange(result.body as AccountDetail);
  };

  const remove = async (overrideKey: LimitKey) => {
    setBusy(true);
    const result = await adminRequest<AccountDetail>(
      `/api/admin/accounts/${encodeURIComponent(detail.id)}/overrides/${overrideKey}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (result.ok) await onChange(result.body as AccountDetail);
    else setError("That didn’t remove. Try again.");
  };

  const effective = detail.plan;
  return (
    <>
      <p className={styles.muted}>
        An exception here beats the plan&rsquo;s limit until it ends. Changes ask for your passkey
        again.
      </p>
      <Message message={null} error={error} />
      {detail.overrides.length === 0 ? (
        <p className={styles.muted}>No exceptions.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">Exceptions to the plan&rsquo;s limits</caption>
            <thead>
              <tr>
                <th scope="col">Limit</th>
                <th scope="col">Value</th>
                <th scope="col">Ends</th>
                <th scope="col">Note</th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.overrides.map((o) => (
                <tr key={o.key}>
                  <td>{LIMIT_LABELS[o.key]}</td>
                  <td>{showLimit(o.key, o.value)}</td>
                  <td>{o.expiresAt ? when(o.expiresAt) : "No end"}</td>
                  <td>{o.note ?? ""}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.linkButton}
                      disabled={busy}
                      onClick={() => void remove(o.key)}
                    >
                      Remove<span className="visually-hidden"> {LIMIT_LABELS[o.key]}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className={styles.stack} onSubmit={save} aria-label="Add or change an exception">
        <div className={styles.field}>
          <label htmlFor={`${id}-key`}>Limit</label>
          <select id={`${id}-key`} value={key} onChange={(e) => setKey(e.target.value as LimitKey)}>
            {LIMIT_ORDER.map((k) => (
              <option key={k} value={k}>
                {LIMIT_LABELS[k]}
                {effective ? ` (now ${showLimit(k, effective[k])})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-value`}>New value{isBytes(key) ? " in MB" : ""}</label>
          <input
            id={`${id}-value`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={`${id}-value-hint`}
          />
          <p id={`${id}-value-hint`} className={styles.hint}>
            Leave blank for no limit.
          </p>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-expires`}>Ends (optional)</label>
          <input
            id={`${id}-expires`}
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-note`}>Note (optional)</label>
          <input
            id={`${id}-note`}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button type="submit" className={styles.button} disabled={busy}>
            Save exception
            <PasskeyMark />
          </button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function PasswordHelp({ detail, onChange }: { detail: AccountDetail; onChange: OnChange }) {
  const [signOut, setSignOut] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temporary, setTemporary] = useState<string | null>(null);

  const run = async (path: string, success: (body: unknown) => void) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    setTemporary(null);
    const result = await adminRequest<unknown>(
      `/api/admin/accounts/${encodeURIComponent(detail.id)}/${path}`,
      { body: { signOutEverywhere: signOut } },
    );
    setBusy(false);
    if (result.ok) {
      success(result.body);
      await onChange(await reloadDetail(detail.id));
    } else {
      setError(
        errorOf(result) === "target_is_admin"
          ? "Admin accounts can’t be given a temporary password."
          : "That didn’t work. Try again.",
      );
    }
  };

  return (
    <>
      <p className={styles.muted}>
        Send a reset email first. A temporary password is the fallback when email isn&rsquo;t
        reaching them: you give it to them directly, and they choose their own when they sign in.
      </p>
      <Message message={message} error={error} />
      {temporary ? (
        <div role="status" className={styles.notice}>
          <p>
            Temporary password (shown only this once):{" "}
            <strong className={styles.code}>{temporary}</strong>
          </p>
          <p className={styles.hint}>
            Give it to them directly, not by email. They&rsquo;ll choose a new password when they
            sign in, and they&rsquo;ve been sent an email saying support reset it.
          </p>
        </div>
      ) : null}
      <label className={styles.choice}>
        <input type="checkbox" checked={signOut} onChange={(e) => setSignOut(e.target.checked)} />
        Also sign them out everywhere
      </label>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={() =>
            void run("password-reset", () => setMessage(`Reset email sent to ${detail.email}.`))
          }
        >
          Send a reset email
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy || detail.role === "admin"}
          onClick={() =>
            void run("temporary-password", (body) =>
              setTemporary((body as { password: string }).password),
            )
          }
        >
          Set a temporary password
          <PasskeyMark />
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() =>
            void run("sign-out-everywhere", (body) =>
              setMessage(
                `Signed out of ${(body as { sessionsEnded: number }).sessionsEnded} session(s).`,
              ),
            )
          }
        >
          Sign out everywhere now
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

const EMAIL_ERRORS: Record<string, string> = {
  invalid_email: "That doesn’t look like an email address.",
  same_email: "That’s already their email.",
  email_in_use: "Another account already uses that address.",
  target_is_admin: "Admin accounts’ email can’t be changed here.",
  not_previous: "That address isn’t one this account used before.",
  passkey_reconfirm: "Your passkey is needed again. Try once more.",
};

function historyStatus(entry: EmailHistoryEntry): string {
  if (entry.kind === "restore") return "Put back by support";
  if (entry.completedAt) return `Verified ${when(entry.completedAt)}`;
  if (entry.cancelledAt) return "Cancelled or replaced";
  if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) return "Expired, not verified";
  return `Waiting until ${when(entry.expiresAt)}`;
}

const UNBLOCK_RESULTS: Record<string, (email: string) => string> & {
  removed: (email: string) => string;
} = {
  removed: (email) => `Unblocked. The email service will try the next email to ${email} again.`,
  not_blocked: (email) =>
    `The email service wasn’t blocking ${email}. The notice is cleared, so the next email is tried again.`,
  not_configured: () =>
    "The notice is cleared, but this copy of Fennl can’t reach the email service’s blocked list (it isn’t set up here).",
  failed: () =>
    "The notice is cleared, but the email service didn’t answer. Try again tomorrow if emails still don’t arrive.",
};

/** Changing the account's email, putting back an earlier one (B7a), and Unblock (U15). */
function EmailTools({ detail, onChange }: { detail: AccountFacts; onChange: OnChange }) {
  const id = useId();
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/admin/accounts/${encodeURIComponent(detail.id)}`;

  const run = async (
    path: string,
    init: { method?: string; body?: unknown },
    success: (body: unknown) => string,
    detailOf: (body: unknown) => AccountDetail | null = detailFrom,
  ) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const result = await adminRequest<unknown>(`${base}${path}`, init);
    setBusy(false);
    if (!result.ok) {
      setError(EMAIL_ERRORS[errorOf(result) ?? ""] ?? "That didn’t work. Try again.");
      return;
    }
    setMessage(success(result.body));
    await onChange(detailOf(result.body) ?? (await reloadDetail(detail.id)));
  };

  const change = async (event: FormEvent) => {
    event.preventDefault();
    const address = newEmail.trim();
    await run("/email", { body: { newEmail: address } }, () => {
      setNewEmail("");
      return `Sent a verification link to ${address}. The email changes when they open it.`;
    });
  };

  const restore = (email: string) =>
    run(
      "/email/restore",
      { body: { email } },
      (body) =>
        `Put back ${email}. Signed out of ${(body as { sessionsEnded: number }).sessionsEnded} session(s), and sent a password reset email there.`,
      (body) => (body as { detail: AccountDetail }).detail,
    );

  const unblock = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const result = await adminRequest<{ result: string; detail?: unknown }>(
      `${base}/email/unblock`,
      { body: {} },
    );
    setBusy(false);
    if (!result.ok) {
      setError(
        result.status === 429
          ? "Unblock works once a day for each account. Try again tomorrow."
          : errorOf(result) === "email_changed"
            ? "The address changed meanwhile. Look at the account again."
            : "That didn’t work. Try again.",
      );
      return;
    }
    const answer = result.body as { result: string; detail?: unknown };
    setMessage((UNBLOCK_RESULTS[answer.result] ?? UNBLOCK_RESULTS.removed)(detail.email));
    await onChange(detailFrom(answer) ?? (await reloadDetail(detail.id)));
  };

  const isAdmin = detail.role === "admin";
  const problem = detail.emailProblem;
  return (
    <>
      <p className={styles.muted}>
        A change sends a link to the new address and takes effect when they open it. Putting back an
        earlier address works at once, signs them out everywhere, and sends a password reset email
        there. Both ask for your passkey again.
      </p>
      <Message message={message} error={error} />

      <h3>Is email arriving?</h3>
      {problem ? (
        <>
          <p>
            Emails to <strong>{detail.email}</strong> are{" "}
            <span className={styles.warnText}>{EMAIL_PROBLEM_WORDS[problem]}</span>. Unblock when
            the address works again (for example, they fixed their mailbox): Fennl stops showing
            them the notice, and the email service takes the address off its blocked list, so the
            next email is tried. Once a day; it&rsquo;s recorded in the admin log.
          </p>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={() => void unblock()}
            >
              Unblock {detail.email}
            </button>
          </div>
        </>
      ) : (
        <p className={styles.muted}>Nothing is stopping emails to {detail.email}.</p>
      )}

      {detail.pendingEmailChange ? (
        <div className={styles.row}>
          <p>
            Waiting for <strong>{detail.pendingEmailChange.email}</strong> to be verified, until{" "}
            {when(detail.pendingEmailChange.expiresAt)}
            {detail.pendingEmailChange.bySupport ? " (started by support)" : ""}.
          </p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() =>
              void run("/email-change", { method: "DELETE" }, () => "Cancelled the change.")
            }
          >
            Cancel the change
          </button>
        </div>
      ) : null}

      <h3>Change the address</h3>
      {isAdmin ? (
        <p className={styles.muted}>Admin accounts&rsquo; email can&rsquo;t be changed here.</p>
      ) : (
        <form className={styles.row} onSubmit={change} aria-label="Change their email">
          <div className={styles.field}>
            <label htmlFor={`${id}-email`}>New email address</label>
            <input
              id={`${id}-email`}
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <button type="submit" className={styles.button} disabled={busy}>
            Send verification link
            <PasskeyMark />
          </button>
        </form>
      )}

      {!isAdmin && detail.previousEmails.length > 0 ? (
        <>
          <h3>Earlier addresses</h3>
          <ul className={styles.results}>
            {detail.previousEmails.map((email) => (
              <li key={email}>
                {email}{" "}
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={busy}
                  onClick={() => void restore(email)}
                >
                  Put back<span className="visually-hidden"> {email}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>History</h3>
      {detail.emailHistory.length === 0 ? (
        <p className={styles.muted}>The email has never been changed.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">Changes to this account&rsquo;s email</caption>
            <thead>
              <tr>
                <th scope="col">Requested</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">By</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.emailHistory.map((h) => (
                <tr key={`${h.requestedAt}-${h.newEmail}`}>
                  <td>{when(h.requestedAt)}</td>
                  <td>{h.oldEmail}</td>
                  <td>{h.newEmail}</td>
                  <td>{h.adminEmail ?? "Them"}</td>
                  <td>{historyStatus(h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

const SIGN_UP_ERRORS: Record<string, string> & { too_many: string } = {
  invalid_email: "That doesn’t look like an email address.",
  same_email: "That’s already the address it was sent to. Send the link again instead.",
  email_in_use: "Another account already uses that address, so nothing was changed or sent.",
  already_verified: "This account is verified now, so it has no sign-up link.",
  not_waiting: "Only an email-and-password sign-up that isn’t verified yet has a sign-up link.",
  target_is_admin: "Admin accounts can’t be changed here.",
  too_many: "That’s been tried a lot just now. Wait a while and try again.",
  passkey_reconfirm: "Your passkey is needed again. Try once more.",
};

/**
 * An unverified sign-up's link (U15): fix a mistyped address in place and send the link there,
 * or send it again. The link opens the app, never the console.
 */
function SignUpTools({
  detail,
  onChange,
  suggestion,
}: {
  detail: AccountFacts;
  onChange: OnChange;
  suggestion?: string | undefined;
}) {
  const id = useId();
  const [email, setEmail] = useState(suggestion ?? suggestEmail(detail.email) ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/admin/accounts/${encodeURIComponent(detail.id)}`;

  const send = async (path: string, body: unknown, success: string) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const result = await adminRequest<unknown>(`${base}${path}`, { body });
    setBusy(false);
    if (!result.ok) {
      setError(
        SIGN_UP_ERRORS[errorOf(result) ?? ""] ??
          (result.status === 429 ? SIGN_UP_ERRORS.too_many : "That didn’t work. Try again."),
      );
      return;
    }
    setMessage(success);
    await onChange(detailFrom(result.body) ?? (await reloadDetail(detail.id)));
  };

  const fix = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    await send(
      "/sign-up-address",
      { email: address },
      `Changed the address to ${address} and sent the sign-up link there.`,
    );
  };

  const typo = suggestEmail(detail.email);
  return (
    <>
      <p className={styles.muted}>
        {detail.email} isn&rsquo;t verified yet. If the address was mistyped, change it here: the
        account keeps everything and the link goes to the new address. Changing it asks for your
        passkey again; both are recorded in the admin log.
      </p>
      {typo ? (
        <p>
          It looks like a typo for <strong>{typo}</strong>.
        </p>
      ) : null}
      <Message message={message} error={error} />
      <form
        className={styles.row}
        onSubmit={(e) => void fix(e)}
        aria-label="Fix the sign-up address"
      >
        <div className={styles.field}>
          <label htmlFor={`${id}-email`}>Correct address</label>
          <input
            id={`${id}-email`}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button type="submit" className={styles.button} disabled={busy}>
          Change it and send the link
          <PasskeyMark />
        </button>
      </form>
      <h3>The address is right</h3>
      <p className={styles.muted}>Send the sign-up link to {detail.email} again.</p>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() =>
            void send("/sign-up-link", {}, `Sent the sign-up link to ${detail.email} again.`)
          }
        >
          Send the sign-up link again
        </button>
      </div>
    </>
  );
}
