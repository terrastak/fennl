import { useEffect, useId, useState, type FormEvent } from "react";
import { LevelTag } from "./AccountOverview";
import {
  shortDay,
  sinceWords,
  timeZoneQuery,
  type AttentionOverview as Attention,
  type ComingUpItem,
} from "./accountView";
import { adminRequest } from "./api";
import styles from "./admin.module.css";

/**
 * Where the console opens (phase U15): every account with something that needs the admin, newest
 * first, what's coming up, and this week's emails. Worked out when it opens; nothing is emailed
 * about it.
 */
export function AttentionSection({
  onFind,
  onOpen,
}: {
  onFind: (query: string) => void;
  onOpen: (userId: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [attention, setAttention] = useState<Attention | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<Attention>(`/api/admin/attention${timeZoneQuery()}`).then((result) => {
      if (cancelled) return;
      if (result.ok) setAttention(result.body as Attention);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const find = (event: FormEvent) => {
    event.preventDefault();
    onFind(query.trim());
  };

  const now = new Date();
  const emails = attention?.emailsThisWeek;
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
