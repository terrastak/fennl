import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import type { AccountDetail, AccountMatch } from "../../shared/adminAccounts";
import type { EmailHistoryEntry } from "../../shared/email";
import type { LimitKey } from "../../shared/entitlements";
import { verifiedText } from "../account/verified";
import { planName, planStatus } from "../pages/plan";
import { ActivityTable, type ActivityRow } from "./ActivitySection";
import { adminRequest, errorOf } from "./api";
import { LIMIT_LABELS, LIMIT_ORDER, isBytes, parseInput, showLimit } from "./limits";
import styles from "./admin.module.css";

const METHOD_NAMES: Record<string, string> = {
  credential: "Email and password",
  google: "Google",
  apple: "Apple",
};

function when(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Never";
}

/** A date field's value ("2027-03-31") as the end of that day where the admin is. */
function endOfDay(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).toISOString();
}

// ---------------------------------------------------------------------------------------------

/** Search, and one account's page. `open` starts on that account (from the feedback inbox). */
export function AccountsSection({ open = null }: { open?: string | null }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AccountMatch[] | null>(null);
  const [selected, setSelected] = useState<string | null>(open);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const result = await adminRequest<AccountMatch[]>(
      `/api/admin/accounts?q=${encodeURIComponent(query)}`,
    );
    setMatches(result.ok ? (result.body as AccountMatch[]) : []);
  };

  if (selected) {
    return <AccountPage id={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Find an account</h2>
      <form className={styles.row} onSubmit={search} role="search">
        <div className={styles.field}>
          <label htmlFor={`${id}-q`}>Email or name</label>
          <input
            id={`${id}-q`}
            type="search"
            minLength={2}
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className={styles.button}>
          Search
        </button>
      </form>
      {matches === null ? null : matches.length === 0 ? (
        <p className={styles.muted} role="status">
          No accounts match.
        </p>
      ) : (
        <ul className={styles.results} aria-label="Matching accounts">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className={styles.linkButton} onClick={() => setSelected(m.id)}>
                {m.name || "(no name)"}
              </button>{" "}
              <span className={styles.muted}>
                {m.email} · {verifiedText(m.emailVerified, m.emailVerifiedAt)} · joined{" "}
                {when(m.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function AccountPage({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);

  const loadActivity = useCallback(async () => {
    const result = await adminRequest<ActivityRow[]>(
      `/api/admin/audit?account=${encodeURIComponent(id)}`,
    );
    setActivity(result.ok ? (result.body as ActivityRow[]) : []);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<AccountDetail>(`/api/admin/accounts/${encodeURIComponent(id)}`).then(
      async (result) => {
        if (cancelled) return;
        if (result.ok) setDetail(result.body as AccountDetail);
        else setFailed(true);
        const log = await adminRequest<ActivityRow[]>(
          `/api/admin/audit?account=${encodeURIComponent(id)}`,
        );
        if (!cancelled) setActivity(log.ok ? (log.body as ActivityRow[]) : []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const changed = async (next: AccountDetail | null) => {
    if (next) setDetail(next);
    await loadActivity();
  };

  return (
    <>
      <div className={styles.row}>
        <button type="button" className={styles.secondary} onClick={onBack}>
          Back to search
        </button>
      </div>
      {failed ? (
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t load that account.
        </p>
      ) : !detail ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          <section className={styles.card} aria-labelledby="account-title">
            <h2 id="account-title">{detail.name || detail.email}</h2>
            <dl className={styles.details}>
              <div>
                <dt>Email</dt>
                <dd>
                  {detail.email} ({verifiedText(detail.emailVerified, detail.emailVerifiedAt)})
                </dd>
              </div>
              <div>
                <dt>Signed up</dt>
                <dd>{when(detail.createdAt)}</dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>{when(detail.lastSeenAt)}</dd>
              </div>
              <div>
                <dt>Signs in with</dt>
                <dd>
                  {detail.signInMethods.map((m) => METHOD_NAMES[m] ?? m).join(", ") ||
                    "Nothing yet"}
                </dd>
              </div>
              {detail.role ? (
                <div>
                  <dt>Role</dt>
                  <dd>{detail.role}</dd>
                </div>
              ) : null}
              {detail.mustChangePassword ? (
                <div>
                  <dt>Password</dt>
                  <dd>Temporary: must be changed at next sign-in</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className={styles.card} aria-labelledby="plan-title">
            <h2 id="plan-title">Plan and household</h2>
            <dl className={styles.details}>
              <div>
                <dt>Plan</dt>
                <dd>
                  {detail.plan ? planName(detail.plan) : "No household yet"}
                  {detail.plan && planStatus(detail.plan) ? ` · ${planStatus(detail.plan)}` : ""}
                </dd>
              </div>
              <div>
                <dt>Household</dt>
                <dd>
                  {detail.household
                    ? `${detail.household.name}: ${detail.household.members
                        .map((m) => `${m.name} (${m.email})`)
                        .join(", ")}`
                    : "None"}
                </dd>
              </div>
              <div>
                <dt>Codes used</dt>
                <dd>
                  {detail.grants.length === 0
                    ? "None"
                    : detail.grants
                        .map(
                          (g) =>
                            `${g.code} (${g.label}): ${g.tier}, ${
                              g.ended
                                ? "ended early"
                                : g.endsAt
                                  ? `until ${when(g.endsAt)}`
                                  : "no end date"
                            }`,
                        )
                        .join("; ")}
                </dd>
              </div>
              <div>
                <dt>Devices</dt>
                <dd>
                  {detail.devices.length === 0
                    ? "None in use"
                    : detail.devices
                        .map((d) => `${d.label} (last used ${when(d.lastSeenAt)})`)
                        .join("; ")}
                </dd>
              </div>
              <div>
                <dt>Recipes and storage</dt>
                <dd>
                  {detail.usage
                    ? `${detail.usage.recipes} recipes`
                    : "Counted once the recipe box exists"}
                </dd>
              </div>
            </dl>
          </section>

          <Overrides detail={detail} onChange={changed} />
          <EmailTools detail={detail} onChange={changed} />
          <PasswordHelp detail={detail} onChange={changed} />

          <section className={styles.card} aria-labelledby="account-activity-title">
            <h2 id="account-activity-title">Admin activity for this account</h2>
            <ActivityTable rows={activity} />
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function Overrides({
  detail,
  onChange,
}: {
  detail: AccountDetail;
  onChange: (next: AccountDetail | null) => Promise<void>;
}) {
  const id = useId();
  const [key, setKey] = useState<LimitKey>("max_recipes");
  const [value, setValue] = useState("");
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
          : "That didn't save. Try again.",
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
    else setError("That didn't remove. Try again.");
  };

  const effective = detail.plan;
  return (
    <section className={styles.card} aria-labelledby="overrides-title">
      <h2 id="overrides-title">Limits for this account</h2>
      <p className={styles.muted}>
        An exception here beats the plan&rsquo;s limit until it ends. Changes ask for your passkey
        again.
      </p>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
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
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function PasswordHelp({
  detail,
  onChange,
}: {
  detail: AccountDetail;
  onChange: (next: AccountDetail | null) => Promise<void>;
}) {
  const [signOut, setSignOut] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temporary, setTemporary] = useState<string | null>(null);

  const reload = async () => {
    const result = await adminRequest<AccountDetail>(
      `/api/admin/accounts/${encodeURIComponent(detail.id)}`,
    );
    await onChange(result.ok ? (result.body as AccountDetail) : null);
  };

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
      await reload();
    } else {
      setError(
        errorOf(result) === "target_is_admin"
          ? "Admin accounts can't be given a temporary password."
          : "That didn't work. Try again.",
      );
    }
  };

  return (
    <section className={styles.card} aria-labelledby="password-title">
      <h2 id="password-title">Password help</h2>
      <p className={styles.muted}>
        Send a reset email first. A temporary password is the fallback when email isn&rsquo;t
        reaching them: you give it to them directly, and they choose their own when they sign in.
      </p>
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
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

const EMAIL_ERRORS: Record<string, string> = {
  invalid_email: "That doesn't look like an email address.",
  same_email: "That's already their email.",
  email_in_use: "Another account already uses that address.",
  target_is_admin: "Admin accounts' email can't be changed here.",
  not_previous: "That address isn't one this account used before.",
};

function historyStatus(entry: EmailHistoryEntry): string {
  if (entry.kind === "restore") return "Put back by support";
  if (entry.completedAt) return `Verified ${when(entry.completedAt)}`;
  if (entry.cancelledAt) return "Cancelled or replaced";
  if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) return "Expired, not verified";
  return `Waiting until ${when(entry.expiresAt)}`;
}

/** Changing the account's email, and putting back an earlier one (phase B7a). */
function EmailTools({
  detail,
  onChange,
}: {
  detail: AccountDetail;
  onChange: (next: AccountDetail | null) => Promise<void>;
}) {
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
    detailOf: (body: unknown) => AccountDetail = (body) => body as AccountDetail,
  ) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const result = await adminRequest<unknown>(`${base}${path}`, init);
    setBusy(false);
    if (!result.ok) {
      setError(EMAIL_ERRORS[errorOf(result) ?? ""] ?? "That didn't work. Try again.");
      return;
    }
    setMessage(success(result.body));
    await onChange(detailOf(result.body));
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

  const isAdmin = detail.role === "admin";
  return (
    <section className={styles.card} aria-labelledby="email-tools-title">
      <h2 id="email-tools-title">Email address</h2>
      <p className={styles.muted}>
        A change sends a link to the new address and takes effect when they open it. Putting back an
        earlier address works at once, signs them out everywhere, and sends a password reset email
        there. Both ask for your passkey again.
      </p>
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
    </section>
  );
}
