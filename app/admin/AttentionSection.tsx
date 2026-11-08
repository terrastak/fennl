import { Fragment, useEffect, useId, useState, type FormEvent } from "react";
import { LevelTag } from "./AccountOverview";
import {
  shortDay,
  sinceWords,
  timeZoneQuery,
  type AttentionOverview as Attention,
  type ComingUpItem,
} from "./accountView";
import { adminRequest } from "./api";
import { AdminIcon } from "./AdminIcon";
import { usePointer } from "../recipes/usePointer";
import styles from "./admin.module.css";

/**
 * Where the console opens (phase U15): every account with something that needs the admin, newest
 * first, what's coming up, and this week's emails. Worked out when it opens; nothing is emailed
 * about it.
 */
export function AttentionSection({
  onFind,
  onOpen,
  onCount,
}: {
  onFind: (query: string) => void;
  onOpen: (userId: string) => void;
  /** How many accounts need you, for the left panel on a laptop. */
  onCount?: ((count: number) => void) | undefined;
}) {
  const id = useId();
  const laptop = usePointer();
  const [query, setQuery] = useState("");
  const [attention, setAttention] = useState<Attention | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<Attention>(`/api/admin/attention${timeZoneQuery()}`).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const body = result.body as Attention;
        setAttention(body);
        onCount?.(body.items.length);
      } else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [onCount]);

  const find = (event: FormEvent) => {
    event.preventDefault();
    onFind(query.trim());
  };

  const now = new Date();
  const emails = attention?.emailsThisWeek;
  if (laptop) {
    return <LaptopAttention attention={attention} failed={failed} onOpen={onOpen} now={now} />;
  }
  return (
    <>
      <section className={styles.card} aria-labelledby={`${id}-find`}>
        <h2 id={`${id}-find`}>Find an account</h2>
        <form className={styles.row} onSubmit={find} role="search">
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
      </section>

      <section className={styles.card} aria-labelledby={`${id}-attention`}>
        <h2 id={`${id}-attention`}>Needs attention</h2>
        <p className={styles.lede}>
          People with something Fennl thinks you&rsquo;d want to look at. An item leaves the list
          when it&rsquo;s fixed, or when you mark it handled.
        </p>
        {failed ? (
          <p role="alert" className={styles.error}>
            Couldn&rsquo;t work out what needs attention. Try again in a moment.
          </p>
        ) : !attention ? (
          <p role="status">Looking through the accounts…</p>
        ) : attention.items.length === 0 ? (
          <p className={styles.muted}>Nothing needs you right now.</p>
        ) : (
          <ul className={styles.attnList} aria-label="Accounts that need you">
            {attention.items.map((item) => {
              const who = item.name || item.email;
              return (
                <li key={item.userId} className={styles.attnItem}>
                  <span className={styles.who}>{who}</span>
                  <div className={styles.what}>
                    <p>
                      <LevelTag level="needs_you" />
                      {item.finding.title}
                    </p>
                    {item.more.length > 0 ? (
                      <p className={styles.more}>Also: {item.more.join(" · ")}</p>
                    ) : null}
                  </div>
                  <span className={styles.when}>{sinceWords(item.since, now)}</span>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => onOpen(item.userId)}
                  >
                    Open<span className="visually-hidden"> {who}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className={styles.two}>
        <section className={styles.card} aria-labelledby={`${id}-soon`}>
          <h2 id={`${id}-soon`}>Coming up</h2>
          {!attention ? null : attention.comingUp.length === 0 ? (
            <p className={styles.muted}>Nothing in the next few weeks.</p>
          ) : (
            <ul className={styles.attnList}>
              {attention.comingUp.map((item, i) => (
                <ComingUp
                  key={`${item.kind}-${item.at}-${i}`}
                  item={item}
                  now={now}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          )}
        </section>

        <section className={styles.card} aria-labelledby={`${id}-mail`}>
          <h2 id={`${id}-mail`}>Emails this week</h2>
          {emails ? (
            <ul className={styles.stats}>
              <li>
                <span>Sent</span>
                <span className={styles.num}>{emails.sent}</span>
              </li>
              <li>
                <span>Delivered</span>
                <span className={styles.num}>{emails.delivered}</span>
              </li>
              <li>
                <span>Bounced</span>
                <span className={styles.num}>{emails.bounced}</span>
              </li>
              <li>
                <span>Marked as spam</span>
                <span className={styles.num}>{emails.spam}</span>
              </li>
            </ul>
          ) : null}
        </section>
      </div>
    </>
  );
}

/** One thing coming up: open the person, or see the people it's about. */
function ComingUp({
  item,
  now,
  onOpen,
}: {
  item: ComingUpItem;
  now: Date;
  onOpen: (userId: string) => void;
}) {
  const id = useId();
  const [showPeople, setShowPeople] = useState(false);
  const [only] = item.people.length === 1 ? item.people : [];
  return (
    <li className={styles.attnItem}>
      <div className={styles.what}>
        <p>
          <span className={`${styles.tag} ${styles.tagKnow}`}>
            {shortDay(new Date(item.at), now)}
          </span>
          {item.title}
        </p>
        {item.body ? <p className={styles.more}>{item.body}</p> : null}
        {showPeople ? (
          <ul id={`${id}-people`} className={styles.results} aria-label={`Who: ${item.title}`}>
            {item.people.map((person) => (
              <li key={person.userId}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onOpen(person.userId)}
                >
                  {person.name || person.email}
                </button>{" "}
                <span className={styles.muted}>{person.email}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {only ? (
        <button type="button" className={styles.secondary} onClick={() => onOpen(only.userId)}>
          Open<span className="visually-hidden"> {only.name || only.email}</span>
        </button>
      ) : item.people.length > 1 ? (
        <button
          type="button"
          className={styles.secondary}
          aria-expanded={showPeople}
          aria-controls={`${id}-people`}
          onClick={() => setShowPeople(!showPeople)}
        >
          {showPeople ? "Hide them" : "See them"}
        </button>
      ) : null}
    </li>
  );
}

/** On a laptop, a long address in a finding's words breaks before its "@", never mid-word. */
function breakBeforeAt(text: string) {
  const parts = text.split("@");
  if (parts.length < 2) return text;
  return parts.map((part, i) =>
    i === 0 ? (
      part
    ) : (
      <Fragment key={i}>
        <wbr />@{part}
      </Fragment>
    ),
  );
}

/**
 * Needs attention on a laptop (U23, owner's choices 2026-11-07): the title and its line, then two
 * columns. On the left the accounts that need you, each row its name and email, what needs you
 * (with "Also: …"), how long ago and Open (the whole row opens it), with no "Needs you" tag on
 * each row since every row needs you (choice 3); under them this week's emails as four numbers in
 * a row. On the right Coming up. Find an account is in the left panel (AdminPanel.tsx).
 */
function LaptopAttention({
  attention,
  failed,
  onOpen,
  now,
}: {
  attention: Attention | null;
  failed: boolean;
  onOpen: (userId: string) => void;
  now: Date;
}) {
  const id = useId();
  const emails = attention?.emailsThisWeek;
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h2 id={`${id}-attention`} className={styles.pageTitle}>
          Needs attention
        </h2>
        <p className={styles.pageLede}>
          People with something Fennl thinks you&rsquo;d want to look at. An item leaves the list
          when it&rsquo;s fixed, or when you mark it handled.
        </p>
      </header>
      <div className={styles.attnCols}>
        <div className={styles.attnMain}>
          <section aria-labelledby={`${id}-attention`}>
            {failed ? (
              <p role="alert" className={styles.error}>
                Couldn&rsquo;t work out what needs attention. Try again in a moment.
              </p>
            ) : !attention ? (
              <p role="status" className={styles.boxNote}>
                Looking through the accounts…
              </p>
            ) : attention.items.length === 0 ? (
              <p className={styles.boxNote}>Nothing needs you right now.</p>
            ) : (
              <ul className={styles.rows} aria-label="Accounts that need you">
                {attention.items.map((item) => {
                  const who = item.name || item.email;
                  return (
                    <li key={item.userId} className={`${styles.rowItem} ${styles.attnRow}`}>
                      <span className={styles.attnWho}>
                        <span className={styles.attnName}>{who}</span>
                        {item.name ? (
                          <span className={styles.attnEmail} title={item.email}>
                            {item.email}
                          </span>
                        ) : null}
                      </span>
                      <span className={styles.attnWhat}>
                        <span className={styles.attnTitle}>
                          {breakBeforeAt(item.finding.title)}
                        </span>
                        {item.more.length > 0 ? (
                          <span className={styles.attnMore}>Also: {item.more.join(" · ")}</span>
                        ) : null}
                      </span>
                      <span className={styles.attnWhen}>{sinceWords(item.since, now)}</span>
                      <button
                        type="button"
                        className={`${styles.quiet} ${styles.rowOpen}`}
                        onClick={() => onOpen(item.userId)}
                      >
                        Open<span className="visually-hidden"> {who}</span>
                        <AdminIcon name="chevronRight" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={styles.sub2} aria-labelledby={`${id}-mail`}>
            <h2 id={`${id}-mail`} className={styles.blockTitle}>
              Emails this week
            </h2>
            {emails ? (
              <ul className={styles.statRow}>
                {(
                  [
                    ["Sent", emails.sent],
                    ["Delivered", emails.delivered],
                    ["Bounced", emails.bounced],
                    ["Marked as spam", emails.spam],
                  ] as const
                ).map(([label, value]) => (
                  <li key={label}>
                    <span className={styles.statNum}>{value}</span>
                    <span className={styles.statLabel}>{label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <section className={styles.attnSide} aria-labelledby={`${id}-soon`}>
          <h2 id={`${id}-soon`} className={styles.blockTitle}>
            Coming up
          </h2>
          {!attention ? null : attention.comingUp.length === 0 ? (
            <p className={styles.boxNote}>Nothing in the next few weeks.</p>
          ) : (
            <ul className={styles.rows}>
              {attention.comingUp.map((item, i) => (
                <LaptopComingUp
                  key={`${item.kind}-${item.at}-${i}`}
                  item={item}
                  now={now}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** One thing coming up on a laptop: its date, what's happening, and Open or See them. */
function LaptopComingUp({
  item,
  now,
  onOpen,
}: {
  item: ComingUpItem;
  now: Date;
  onOpen: (userId: string) => void;
}) {
  const id = useId();
  const [showPeople, setShowPeople] = useState(false);
  const [only] = item.people.length === 1 ? item.people : [];
  return (
    <li className={`${styles.rowItem} ${styles.soonRow}`}>
      <span className={styles.soonDate}>{shortDay(new Date(item.at), now)}</span>
      <span className={styles.soonWhat}>
        <span className={styles.attnTitle}>{breakBeforeAt(item.title)}</span>
        {item.body ? <span className={styles.attnMore}>{item.body}</span> : null}
      </span>
      {only ? (
        <button
          type="button"
          className={`${styles.quiet} ${styles.soonButton}`}
          onClick={() => onOpen(only.userId)}
        >
          Open<span className="visually-hidden"> {only.name || only.email}</span>
        </button>
      ) : item.people.length > 1 ? (
        <button
          type="button"
          className={`${styles.quiet} ${styles.soonButton}`}
          aria-expanded={showPeople}
          aria-controls={`${id}-people`}
          onClick={() => setShowPeople(!showPeople)}
        >
          {showPeople ? "Hide them" : "See them"}
          <AdminIcon name="chevron" className={showPeople ? styles.turned : undefined} />
        </button>
      ) : null}
      {showPeople ? (
        <ul id={`${id}-people`} className={styles.soonPeople} aria-label={`Who: ${item.title}`}>
          {item.people.map((person) => (
            <li key={person.userId}>
              <button
                type="button"
                className={styles.nameButton}
                onClick={() => onOpen(person.userId)}
              >
                {person.name || person.email}
              </button>{" "}
              <span className={styles.attnEmail}>{person.email}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
