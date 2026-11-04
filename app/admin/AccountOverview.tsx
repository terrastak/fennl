import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import type { Finding, FindingAction } from "../../shared/accountFindings";
import { usageLevel } from "../../shared/limits";
import { verifiedText } from "../account/verified";
import { formatBytes } from "../pages/plan";
import { PasskeyMark } from "./AccountTools";
import {
  CATEGORY_WORDS,
  EMAIL_PROBLEM_WORDS,
  HISTORY_FILTERS,
  PERIODS,
  aboutEmails,
  asksForPasskey,
  entryTime,
  entryTimeInline,
  householdWords,
  inOrder,
  periodNote,
  planWords,
  shortDay,
  summaryLine,
  historyShown,
  type AccountFacts,
  type AccountOverview,
  type HistoryFilter,
  timeZoneQuery,
} from "./accountView";
import { adminRequest, errorOf } from "./api";
import styles from "./admin.module.css";

// The account page's main column (phase U15): what Fennl found, and everything that happened.

/** The tag's icon: an exclamation for "Needs you", an i for "Worth knowing". */
function TagIcon({ act }: { act: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d={act ? "M12 8v5M12 17h.01" : "M12 11v6M12 7h.01"} />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function LevelTag({ level }: { level: Finding["level"] }) {
  const act = level === "needs_you";
  return (
    <span className={`${styles.tag} ${act ? styles.tagAct : styles.tagKnow}`}>
      <TagIcon act={act} />
      {act ? "Needs you" : "Worth knowing"}
    </span>
  );
}

export function WhatsGoingOn({
  accountId,
  overview,
  failed,
  onAction,
  onSeeEmails,
  onReload,
}: {
  accountId: string;
  overview: AccountOverview | null;
  failed: boolean;
  onAction: (finding: Finding, action: FindingAction) => void;
  onSeeEmails: () => void;
  onReload: () => Promise<void>;
}) {
  const id = useId();
  const [showFine, setShowFine] = useState(false);
  // A message about a finding that outlives its card (a finding fixed meanwhile leaves the list).
  const [notice, setNotice] = useState<string | null>(null);
  const fine = overview?.fine ?? [];
  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>What&rsquo;s going on</h2>
      {failed ? (
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t work out what&rsquo;s going on. The facts and tools still work.
        </p>
      ) : !overview ? (
        <p role="status">Looking through the account…</p>
      ) : (
        <>
          <p className={styles.lede}>{summaryLine(overview.findings, fine.length)}</p>
          <div role="status">{notice ? <p className={styles.notice}>{notice}</p> : null}</div>
          {inOrder(overview.findings).map((finding) => (
            <FindingCard
              key={finding.key}
              accountId={accountId}
              finding={finding}
              onAction={onAction}
              onSeeEmails={onSeeEmails}
              onReload={onReload}
              onNotice={setNotice}
            />
          ))}
          {fine.length > 0 ? (
            <>
              <button
                type="button"
                className={`${styles.linkButton} ${styles.toggle}`}
                aria-expanded={showFine}
                aria-controls={`${id}-fine`}
                onClick={() => setShowFine(!showFine)}
              >
                {showFine ? "Hide" : "Show"} the{" "}
                {fine.length === 1 ? "check" : `${fine.length} checks`} that{" "}
                {fine.length === 1 ? "is" : "are"} fine
              </button>
              <ul id={`${id}-fine`} className={styles.fineList} hidden={!showFine}>
                {fine.map((line) => (
                  <li key={line}>
                    <span className={`${styles.tag} ${styles.tagFine}`}>Fine</span>
                    {line}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function FindingCard({
  accountId,
  finding,
  onAction,
  onSeeEmails,
  onReload,
  onNotice,
}: {
  accountId: string;
  finding: Finding;
  onAction: (finding: Finding, action: FindingAction) => void;
  onSeeEmails: () => void;
  onReload: () => Promise<void>;
  onNotice: (text: string | null) => void;
}) {
  const id = useId();
  const act = finding.level === "needs_you";
  return (
    <article
      className={`${styles.finding} ${act ? styles.act : ""}`}
      aria-labelledby={`${id}-title`}
    >
      <div className={styles.fTop}>
        <LevelTag level={finding.level} />
        {finding.sinceText ? <span className={styles.since}>{finding.sinceText}</span> : null}
      </div>
      <h3 id={`${id}-title`}>{finding.title}</h3>
      <p>{finding.body}</p>
      {finding.why ? <p className={styles.why}>{finding.why}</p> : null}
      {finding.actions.length > 0 || aboutEmails(finding) ? (
        <div className={styles.actions}>
          {finding.actions.map((action, i) => (
            <button
              key={`${action.kind}-${i}`}
              type="button"
              className={i === 0 && act ? styles.button : styles.secondary}
              onClick={() => onAction(finding, action)}
            >
              {action.label}
              {asksForPasskey(action.kind) ? <PasskeyMark /> : null}
            </button>
          ))}
          {aboutEmails(finding) ? (
            <button type="button" className={styles.secondary} onClick={onSeeEmails}>
              See the emails
            </button>
          ) : null}
        </div>
      ) : null}
      {act ? (
        <Handled accountId={accountId} finding={finding} onReload={onReload} onNotice={onNotice} />
      ) : null}
    </article>
  );
}

/** "Mark handled…" with an optional note, or who handled it and when (kept in the admin log). */
function Handled({
  accountId,
  finding,
  onReload,
  onNotice,
}: {
  accountId: string;
  finding: Finding;
  onReload: () => Promise<void>;
  onNotice: (text: string | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where focus goes once the form or button it was on is gone: "Put it back…" after marking,
  // "Mark handled…" after putting it back or cancelling.
  const [focusNext, setFocusNext] = useState<"put_back" | "mark" | null>(null);
  const putBackRef = useRef<HTMLButtonElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const target =
      focusNext === "put_back" ? putBackRef.current : focusNext === "mark" ? markRef.current : null;
    if (!target) return;
    target.focus();
    setFocusNext(null);
    // Again once the reload has put the button there (finding.handled changes).
  }, [focusNext, finding.handled, open]);
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/findings/${finding.key}/handled${timeZoneQuery()}`;

  const mark = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    onNotice(null);
    const result = await adminRequest<unknown>(path, { body: { note: note.trim() || null } });
    setBusy(false);
    if (!result.ok) {
      if (errorOf(result) === "already_fixed") {
        // The reload takes the finding (and this card) away, so the message is shown above.
        onNotice(`“${finding.title}” is fixed already, so there’s nothing to mark.`);
        await onReload();
      } else setError("That didn’t save. Try again.");
      return;
    }
    setOpen(false);
    setNote("");
    setFocusNext("put_back");
    await onReload();
  };

  const undo = async () => {
    setBusy(true);
    setError(null);
    onNotice(null);
    const result = await adminRequest<unknown>(path, { method: "DELETE" });
    setBusy(false);
    if (result.ok) {
      setFocusNext("mark");
      await onReload();
    } else setError("That didn’t work. Try again.");
  };

  const errorLine = error ? (
    <p role="alert" className={styles.error}>
      {error}
    </p>
  ) : null;

  if (finding.handled) {
    const { at, by, note: said } = finding.handled;
    return (
      <div className={styles.handled}>
        {errorLine}
        <p id={`${id}-handled`}>
          Handled by {by} on {new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" })}
          {said ? `: “${said}”` : ""}. It stays out of Needs attention until something new happens.
        </p>
        <button
          ref={putBackRef}
          type="button"
          className={styles.linkButton}
          aria-describedby={`${id}-handled`}
          disabled={busy}
          onClick={() => void undo()}
        >
          Put it back in Needs attention
        </button>
      </div>
    );
  }
  return (
    <div className={styles.handled}>
      {errorLine}
      {open ? (
        <form className={styles.stack} onSubmit={(e) => void mark(e)}>
          <div className={styles.field}>
            <label htmlFor={`${id}-note`}>Note (optional, kept in the admin log)</label>
            <input
              id={`${id}-note`}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className={styles.row}>
            <button type="submit" className={styles.button} disabled={busy}>
              Mark handled
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setOpen(false);
                setFocusNext("mark");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={markRef}
          type="button"
          className={styles.linkButton}
          aria-label={`Mark handled: ${finding.title}`}
          onClick={() => setOpen(true)}
        >
          Mark handled…
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function WhatHappened({
  overview,
  filter,
  onFilter,
  headingRef,
}: {
  overview: AccountOverview | null;
  filter: HistoryFilter;
  onFilter: (next: HistoryFilter) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const id = useId();
  const [days, setDays] = useState<number | null>(30);
  const now = new Date();
  const { shown, hidden } = overview
    ? historyShown(overview.history, filter, days, now.getTime())
    : { shown: [], hidden: 0 };
  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className={styles.quietFocus}>
        What happened
      </h2>
      <p className={styles.lede}>Everything on this account, newest first, in plain words.</p>
      <div className={styles.filters} role="group" aria-label="Show">
        {HISTORY_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={styles.navButton}
            aria-pressed={filter === f.id}
            onClick={() => onFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className={styles.period} role="group" aria-labelledby={`${id}-period`}>
        <span id={`${id}-period`} className={styles.periodLabel}>
          Period
        </span>
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={styles.seg}
            aria-pressed={days === p.days}
            onClick={() => setDays(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {!overview ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          {shown.length > 0 ? (
            <ul className={styles.tl} aria-label="Events, newest first">
              {shown.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className={styles.tlRow}>
                  <span className={styles.tlWhen}>{entryTime(entry.at, now)}</span>
                  <div>
                    <p className={styles.tlText}>
                      <span className={styles.tlKind}>
                        {CATEGORY_WORDS[entry.category]}
                        <span className="visually-hidden">:</span>
                      </span>
                      {entry.text}
                      {entry.problem ? <span className={styles.prob}>Problem</span> : null}
                    </p>
                    {entry.detail ? <p className={styles.tlDetail}>{entry.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <p className={styles.hint} role="status">
            {periodNote(days, shown.length, hidden)}
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

/** A usage bar with its words; over the limit says so in words too. */
function Meter({
  label,
  used,
  max,
  text,
}: {
  label: string;
  used: number;
  max: number;
  text: string;
}) {
  const level = usageLevel(used, max);
  const share = max > 0 ? Math.min(1, used / max) : 1;
  const over = level === "over" || level === "full";
  return (
    <dd>
      {over ? <span className={styles.warnText}>{text}</span> : text}
      {level === "over" ? ` · over by ${(used - max).toLocaleString()}` : ""}
      {level === "full" ? " · at the limit" : ""}
      <div
        className={styles.meter}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(used, max)}
        aria-valuetext={text}
      >
        <div
          className={`${styles.meterFill} ${over ? styles.over : ""}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </dd>
  );
}

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

/** The "Account" card: the key facts, with usage as bars. */
export function Facts({
  detail,
  onOpenFeedback,
}: {
  detail: AccountFacts;
  onOpenFeedback: () => void;
}) {
  const id = useId();
  const problem = detail.emailProblem;
  const usage = detail.usage;
  const maxRecipes = detail.plan?.max_recipes ?? null;
  const maxText = detail.plan?.max_text_bytes ?? null;
  const photos = detail.photos;
  const graceEnds = photos?.members
    .map((m) => m.deleteAfter)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0];
  const now = new Date();
  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Account</h2>
      <dl className={styles.facts}>
        <div>
          <dt>Email</dt>
          <dd>
            {detail.email} · {verifiedText(detail.emailVerified, detail.emailVerifiedAt)}
            {problem ? (
              <>
                {" · "}
                <span className={styles.warnText}>{EMAIL_PROBLEM_WORDS[problem]}</span>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>{planWords(detail)}</dd>
        </div>
        <div>
          <dt>Household</dt>
          <dd>{detail.household ? householdWords(detail.household.members) : "None yet"}</dd>
        </div>
        <div>
          <dt>Signed up</dt>
          <dd>{when(detail.createdAt)}</dd>
        </div>
        <div>
          <dt>Signs in with</dt>
          <dd>
            {detail.signInMethods.map((m) => METHOD_NAMES[m] ?? m).join(", ") || "Nothing yet"}
          </dd>
        </div>
        {detail.mustChangePassword ? (
          <div>
            <dt>Password</dt>
            <dd>Temporary: must be changed at next sign-in</dd>
          </div>
        ) : null}
        {detail.role === "admin" ? (
          <div>
            <dt>Role</dt>
            <dd>Admin account</dd>
          </div>
        ) : null}
        <div>
          <dt>Devices</dt>
          <dd>
            {detail.devices.length === 0
              ? "None yet"
              : detail.devices
                  .map((d) => `${d.label} · last used ${entryTimeInline(d.lastSeenAt, now)}`)
                  .join("; ")}
          </dd>
        </div>
        <div>
          <dt>Recipes</dt>
          {!usage ? (
            <dd>None yet</dd>
          ) : maxRecipes === null ? (
            <dd>{usage.recipes.toLocaleString()} (no limit)</dd>
          ) : (
            <Meter
              label="Recipes"
              used={usage.recipes}
              max={maxRecipes}
              text={`${usage.recipes.toLocaleString()} of ${maxRecipes.toLocaleString()}`}
            />
          )}
        </div>
        {usage ? (
          <div>
            <dt>Recipe text</dt>
            {maxText === null ? (
              <dd>{formatBytes(usage.textBytes)} (no limit)</dd>
            ) : (
              <Meter
                label="Recipe text"
                used={usage.textBytes}
                max={maxText}
                text={`${formatBytes(usage.textBytes)} of ${formatBytes(maxText)}`}
              />
            )}
          </div>
        ) : null}
        {photos ? (
          <div>
            <dt>Photos</dt>
            <dd>
              {photos.count === 0
                ? "None"
                : `${photos.count.toLocaleString()} · ${formatBytes(photos.bytes)}`}
              {graceEnds ? (
                <>
                  {" · "}
                  <span className={styles.warnText}>
                    kept until {shortDay(new Date(graceEnds), now)}
                  </span>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
        {detail.household ? (
          <div>
            <dt>Feedback</dt>
            <dd>
              {detail.unreadFeedback === 0 ? "Nothing unread" : `${detail.unreadFeedback} unread`}
              {" · "}
              <button type="button" className={styles.linkButton} onClick={onOpenFeedback}>
                Open the inbox
              </button>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
