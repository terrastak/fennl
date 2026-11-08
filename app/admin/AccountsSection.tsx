import { Fragment, useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Finding, FindingAction } from "../../shared/accountFindings";
import type { AccountDetail, AccountMatch } from "../../shared/adminAccounts";
import { verifiedText } from "../account/verified";
import { Facts, WhatHappened, WhatsGoingOn } from "./AccountOverview";
import { PasskeyMark, ToolPanel } from "./AccountTools";
import type { ActivityRow } from "./ActivitySection";
import {
  entryTimeInline,
  shortDay,
  firstName,
  planWords,
  type AccountFacts,
  type AccountOverview,
  type HistoryFilter,
  timeZoneQuery,
} from "./accountView";
import { adminRequest } from "./api";
import { AdminIcon } from "./AdminIcon";
import type { AdminIconName } from "./adminIcons";
import { usePointer } from "../recipes/usePointer";
import { toolList, waitingSignUp, type OpenTool, type ToolId } from "./toolList";
import styles from "./admin.module.css";

function when(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Never";
}

// ---------------------------------------------------------------------------------------------

/** Finding an account. `query` starts a search straight away (from Needs attention). */
export function AccountsSection({
  query: startQuery = "",
  onOpen,
}: {
  query?: string;
  onOpen: (id: string, query: string) => void;
}) {
  const id = useId();
  const laptop = usePointer();
  const [query, setQuery] = useState(startQuery);
  const [matches, setMatches] = useState<AccountMatch[] | null>(null);

  const find = async (q: string) => {
    const result = await adminRequest<AccountMatch[]>(
      `/api/admin/accounts?q=${encodeURIComponent(q)}`,
    );
    return result.ok ? (result.body as AccountMatch[]) : [];
  };

  // A search asked for from Needs attention, or the last one (back from an account).
  useEffect(() => {
    const q = startQuery.trim();
    if (q.length < 2) return;
    let cancelled = false;
    void adminRequest<AccountMatch[]>(`/api/admin/accounts?q=${encodeURIComponent(q)}`).then(
      (result) => {
        if (!cancelled) setMatches(result.ok ? (result.body as AccountMatch[]) : []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [startQuery]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    setMatches(await find(query.trim()));
  };

  if (laptop) {
    return <LaptopAccounts query={startQuery.trim()} matches={matches} onOpen={onOpen} />;
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
          Find
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
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onOpen(m.id, query.trim())}
              >
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

/**
 * Accounts on a laptop (U23): the search is Find an account in the left panel, so this is its
 * results, one row each in a white box (as the codes table): the name, underlined only when
 * pointed at, then the email, whether it's verified and when they joined.
 */
function LaptopAccounts({
  query,
  matches,
  onOpen,
}: {
  query: string;
  matches: AccountMatch[] | null;
  onOpen: (id: string, query: string) => void;
}) {
  const id = useId();
  return (
    <section className={styles.page} aria-labelledby={`${id}-title`}>
      <header className={styles.pageHead}>
        <h2 id={`${id}-title`} className={styles.pageTitle}>
          Accounts
        </h2>
        <p className={styles.pageLede}>
          {query.length >= 2 ? (
            <>Accounts whose email or name has &ldquo;{query}&rdquo; in it.</>
          ) : (
            <>
              Find an account with the box at the top of the left panel, by email or name. Press /
              to go there from anywhere.
            </>
          )}
        </p>
      </header>
      {query.length < 2 ? null : matches === null ? (
        <p role="status" className={styles.boxNote}>
          Looking…
        </p>
      ) : matches.length === 0 ? (
        <p className={styles.boxNote} role="status">
          No accounts match.
        </p>
      ) : (
        <ul className={styles.rows} aria-label="Matching accounts">
          {matches.map((m) => (
            <li key={m.id} className={`${styles.rowItem} ${styles.matchRow}`}>
              <button
                type="button"
                className={`${styles.nameButton} ${styles.rowName}`}
                onClick={() => onOpen(m.id, query)}
              >
                {m.name || "(no name)"}
              </button>
              <span className={styles.matchEmail}>{m.email}</span>
              <span className={styles.matchMeta}>
                {verifiedText(m.emailVerified, m.emailVerifiedAt)} · joined {when(m.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

/** The small icon beside each tool on a laptop. */
const TOOL_ICONS: Record<ToolId, AdminIconName> = {
  view_as: "eye",
  premium: "star",
  limits: "sliders",
  email: "mail",
  sign_up: "mail",
  password: "lock",
  admin_log: "history",
};

/** The tool a finding's button opens, with its values filled in. */
function toolFor(detail: AccountDetail, action: FindingAction): OpenTool | null {
  switch (action.kind) {
    case "extend_premium":
      return { id: "premium", prefill: { tier: action.tier } };
    case "raise_limit":
      return { id: "limits", prefill: { limit: action.limit, value: action.value } };
    case "change_email":
      return waitingSignUp(detail)
        ? { id: "sign_up", prefill: {} }
        : { id: "email", prefill: { focus: "change" } };
    case "unblock":
      return { id: "email", prefill: { focus: "unblock" } };
    case "fix_sign_up_address":
      return { id: "sign_up", prefill: action.email ? { email: action.email } : {} };
    case "send_sign_up_link":
      return { id: "sign_up", prefill: {} };
    case "password_reset":
      return { id: "password", prefill: {} };
    case "view_as":
      return { id: "view_as", prefill: {} };
    default:
      // open_feedback goes to the inbox instead.
      return null;
  }
}

/**
 * One account (phase U15): what's going on and what happened, beside the key facts and every
 * tool. Opening it is recorded in the admin log; the overview isn't, so reloading it after a
 * change doesn't log another view.
 */
export function AccountPage({
  id,
  backLabel,
  onBack,
  onOpenFeedback,
  onFindingsChanged,
}: {
  id: string;
  backLabel: string;
  onBack: () => void;
  onOpenFeedback: (feedbackId: string | null) => void;
  /** A change here may change Needs attention's count in the left panel (a laptop). */
  onFindingsChanged?: (() => void) | undefined;
}) {
  const panelId = useId();
  const [detail, setDetail] = useState<AccountFacts | null>(null);
  const [failed, setFailed] = useState(false);
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [tool, setTool] = useState<OpenTool | null>(null);
  const [opened, setOpened] = useState(0);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  // On a laptop one ink button (U23): the most urgent finding's first fix, unless a box is open
  // (a tool, or Mark handled's note), whose own button is then the one.
  const laptop = usePointer();
  const [formsOpen, setFormsOpen] = useState(0);
  const onFormOpen = useCallback((delta: number) => setFormsOpen((n) => n + delta), []);
  const title = useRef<HTMLHeadingElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const base = `/api/admin/accounts/${encodeURIComponent(id)}`;

  const loadOverview = useCallback(async () => {
    const result = await adminRequest<AccountOverview>(`${base}/overview${timeZoneQuery()}`);
    if (result.ok) {
      setOverview(result.body as AccountOverview);
      setOverviewFailed(false);
    } else setOverviewFailed(true);
  }, [base]);

  const loadActivity = useCallback(async () => {
    const result = await adminRequest<ActivityRow[]>(
      `/api/admin/audit?account=${encodeURIComponent(id)}`,
    );
    setActivity(result.ok ? (result.body as ActivityRow[]) : []);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<AccountFacts>(base).then((result) => {
      if (cancelled) return;
      if (result.ok) setDetail(result.body as AccountFacts);
      else setFailed(true);
    });
    void adminRequest<AccountOverview>(`${base}/overview${timeZoneQuery()}`).then((result) => {
      if (cancelled) return;
      if (result.ok) setOverview(result.body as AccountOverview);
      else setOverviewFailed(true);
    });
    void adminRequest<ActivityRow[]>(`/api/admin/audit?account=${encodeURIComponent(id)}`).then(
      (result) => {
        if (!cancelled) setActivity(result.ok ? (result.body as ActivityRow[]) : []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, base]);

  // The name takes the focus when the page opens.
  const loaded = detail !== null;
  useEffect(() => {
    if (loaded) title.current?.focus();
  }, [loaded]);

  /** After a tool changed something: the new facts, then what Fennl finds now. */
  const changed = async (next: AccountDetail | null) => {
    if (next) setDetail(next as AccountFacts);
    await Promise.all([loadOverview(), loadActivity()]);
    onFindingsChanged?.();
  };

  /** After Mark handled or putting it back. */
  const reloadOverview = useCallback(async () => {
    await loadOverview();
    onFindingsChanged?.();
  }, [loadOverview, onFindingsChanged]);

  const open = (next: OpenTool) => {
    setTool(next);
    setOpened((n) => n + 1);
  };

  const onAction = (_finding: Finding, action: FindingAction) => {
    if (action.kind === "open_feedback") {
      onOpenFeedback(action.feedbackId);
      return;
    }
    if (!detail) return;
    const next = toolFor(detail, action);
    if (next) open(next);
  };

  const seeEmails = () => {
    setFilter("email");
    historyHeading.current?.focus();
  };

  const back = laptop ? (
    <div className={styles.back}>
      <button type="button" className={`${styles.quiet} ${styles.backButton}`} onClick={onBack}>
        <AdminIcon name="arrowLeft" />
        {backLabel}
      </button>
    </div>
  ) : (
    <div className={styles.back}>
      <button type="button" className={styles.linkButton} onClick={onBack}>
        <span aria-hidden="true">‹ </span>
        {backLabel}
      </button>
    </div>
  );

  if (failed) {
    return (
      <>
        {back}
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t load that account. It may have been removed (an unverified sign-up is
          removed after 24 hours).
        </p>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        {back}
        <p role="status">Loading…</p>
      </>
    );
  }

  const name = detail.name || detail.email;
  const first = firstName(detail.name) || "them";
  const tools = toolList(detail);
  const lastDevice = [...detail.devices].sort((a, b) =>
    b.lastSeenAt.localeCompare(a.lastSeenAt),
  )[0];
  const now = new Date();
  const sub = [
    detail.email,
    waitingSignUp(detail) ? "Not verified yet" : planWords(detail),
    `Signed up ${shortDay(new Date(detail.createdAt), now)}`,
    detail.lastSeenAt
      ? `Last seen ${entryTimeInline(detail.lastSeenAt, now)}${lastDevice ? `${laptop ? " · " : ", on "}${lastDevice.label}` : ""}`
      : "Never signed in",
  ];
  // On a laptop each part stays whole when the line wraps.
  const subLine = laptop
    ? sub
        .flatMap((part) => part.split(" · "))
        .map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? "\u00a0· " : null}
            <span className={styles.subPart}>{part}</span>
          </Fragment>
        ))
    : sub.join(" · ");

  return (
    <>
      {back}
      <div className={styles.head}>
        <div>
          <h1 ref={title} tabIndex={-1}>
            {name}
          </h1>
          <p className={styles.sub}>{subLine}</p>
        </div>
        {detail.role !== "admin" ? (
          <button
            type="button"
            className={laptop ? styles.soft : styles.button}
            aria-expanded={tool?.id === "view_as"}
            aria-controls={tool?.id === "view_as" ? panelId : undefined}
            onClick={() => open({ id: "view_as", prefill: {} })}
          >
            View as {first}
            <PasskeyMark />
          </button>
        ) : null}
      </div>

      <div className={styles.cols}>
        <div className={styles.mainCol}>
          {tool ? (
            <ToolPanel
              key={opened}
              id={panelId}
              tool={tool}
              detail={detail}
              onChange={changed}
              onClose={() => setTool(null)}
              activity={activity}
            />
          ) : null}
          <WhatsGoingOn
            accountId={detail.id}
            overview={overview}
            failed={overviewFailed}
            onAction={onAction}
            onSeeEmails={seeEmails}
            onReload={reloadOverview}
            allowInk={laptop && tool === null && formsOpen === 0}
            noteInk={tool === null && formsOpen <= 1}
            onFormOpen={onFormOpen}
          />
          <WhatHappened
            overview={overview}
            filter={filter}
            onFilter={setFilter}
            headingRef={historyHeading}
          />
        </div>

        <aside className={styles.side} aria-label="Facts and tools">
          <Facts detail={detail} onOpenFeedback={() => onOpenFeedback(null)} />
          <section className={styles.card} aria-labelledby={`${panelId}-tools`}>
            <h2 id={`${panelId}-tools`}>Everything you can do</h2>
            <div className={styles.tools}>
              {tools.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.secondary}
                  aria-expanded={tool?.id === t.id}
                  aria-controls={tool?.id === t.id ? panelId : undefined}
                  onClick={() => open({ id: t.id as ToolId, prefill: t.prefill ?? {} })}
                >
                  <AdminIcon name={TOOL_ICONS[t.id]} />
                  {t.label}
                  {t.passkey ? <PasskeyMark /> : null}
                </button>
              ))}
              {waitingSignUp(detail) ? (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => open({ id: "sign_up", prefill: {} })}
                >
                  <AdminIcon name="send" />
                  Send the sign-up link again
                </button>
              ) : null}
            </div>
            <p className={styles.hint}>
              Everything you do here is recorded in the admin log, with your reason.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
