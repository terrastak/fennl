import { useCallback, useEffect, useId, useState } from "react";
import {
  feedbackStatus,
  replyLink,
  type FeedbackChange,
  type FeedbackFilter,
  type FeedbackInbox,
  type FeedbackItem,
} from "../../shared/feedback";
import { adminRequest } from "./api";
import { day, statusText } from "./feedbackText";
import styles from "./admin.module.css";

const FILTERS: { id: FeedbackFilter; name: string }[] = [
  { id: "new", name: "New" },
  { id: "read", name: "Read" },
  { id: "replied", name: "Replied" },
  { id: "done", name: "Done" },
  { id: "all", name: "All" },
];

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The feedback inbox (phase B8): newest first, by status, with replies by email. */
export function FeedbackSection({
  onOpenAccount,
  onCounts,
}: {
  onOpenAccount: (userId: string) => void;
  onCounts: (counts: FeedbackInbox["counts"]) => void;
}) {
  const id = useId();
  const [filter, setFilter] = useState<FeedbackFilter>("new");
  const [inbox, setInbox] = useState<FeedbackInbox | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<FeedbackInbox>(`/api/admin/feedback?status=${filter}`).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      const next = result.body as FeedbackInbox;
      setInbox(next);
      onCounts(next.counts);
    });
    return () => {
      cancelled = true;
    };
  }, [filter, onCounts]);

  /** Shows a changed message in place (it stays in this list until the filter changes). */
  const replace = useCallback(
    async (item: FeedbackItem) => {
      setInbox((current) =>
        current
          ? { ...current, items: current.items.map((i) => (i.id === item.id ? item : i)) }
          : current,
      );
      // Only the counts: the list itself stays as it is.
      const result = await adminRequest<FeedbackInbox>(`/api/admin/feedback?status=${filter}`);
      if (!result.ok) return;
      const { counts } = result.body as FeedbackInbox;
      setInbox((current) => (current ? { ...current, counts } : current));
      onCounts(counts);
    },
    [filter, onCounts],
  );

  const open = async (item: FeedbackItem) => {
    if (openId === item.id) {
      setOpenId(null);
      return;
    }
    setOpenId(item.id);
    if (!item.readAt) {
      const result = await adminRequest<FeedbackItem>(`/api/admin/feedback/${item.id}/read`, {
        body: {},
      });
      if (result.ok) await replace(result.body as FeedbackItem);
    }
  };

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Feedback</h2>
      <div className={styles.filters} role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={styles.navButton}
            aria-pressed={filter === f.id}
            onClick={() => {
              setOpenId(null);
              setFilter(f.id);
            }}
          >
            {f.name}
            {inbox ? ` (${inbox.counts[f.id]})` : ""}
          </button>
        ))}
      </div>
      {failed ? (
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t load feedback.
        </p>
      ) : inbox === null ? (
        <p role="status">Loading…</p>
      ) : inbox.items.length === 0 ? (
        <p className={styles.muted}>
          {filter === "new" ? "Nothing new. You're all caught up." : "No messages here."}
        </p>
      ) : (
        <ul className={styles.feedbackList} aria-label="Messages">
          {inbox.items.map((item) => (
            <li
              key={item.id}
              className={`${styles.feedbackItem} ${feedbackStatus(item) === "new" ? styles.unread : ""}`}
            >
              <button
                type="button"
                className={styles.feedbackSummary}
                aria-expanded={openId === item.id}
                onClick={() => void open(item)}
              >
                <span className={styles.feedbackHead}>
                  <span className={styles.feedbackFrom}>
                    {feedbackStatus(item) === "new" ? (
                      <span className={styles.dot} aria-hidden="true" />
                    ) : null}
                    {item.sender?.name || item.sender?.email || "Deleted account"}
                  </span>
                  <span className={styles.badge}>{statusText(item)}</span>
                </span>
                {openId === item.id ? null : (
                  <span className={styles.feedbackSnippet}>
                    {item.message.length > 140 ? `${item.message.slice(0, 140)}…` : item.message}
                  </span>
                )}
                <span className={styles.hint}>Sent {when(item.createdAt)}</span>
              </button>
              {openId === item.id ? (
                <FeedbackDetail item={item} onChange={replace} onOpenAccount={onOpenAccount} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedbackDetail({
  item,
  onChange,
  onOpenAccount,
}: {
  item: FeedbackItem;
  onChange: (item: FeedbackItem) => Promise<void>;
  onOpenAccount: (userId: string) => void;
}) {
  const id = useId();
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (body: FeedbackChange, done: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await adminRequest<FeedbackItem>(`/api/admin/feedback/${item.id}`, {
      method: "PATCH",
      body,
    });
    setBusy(false);
    if (!result.ok) {
      setError("That didn't save. Try again.");
      return;
    }
    setMessage(done);
    await onChange(result.body as FeedbackItem);
  };

  const copy = async () => {
    if (!item.sender) return;
    try {
      await navigator.clipboard.writeText(item.sender.email);
      setMessage(`Copied ${item.sender.email}.`);
    } catch {
      setError("Couldn't copy. Select the address and copy it instead.");
    }
  };

  const reply = replyLink(item, day(item.createdAt));
  const sender = item.sender;
  return (
    <div className={styles.feedbackDetail}>
      <p className={styles.feedbackMessage}>{item.message}</p>
      <dl className={styles.details}>
        <div>
          <dt>From</dt>
          <dd>
            {item.sender ? `${item.sender.name} (${item.sender.email})` : "A deleted account"}
          </dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd>{when(item.createdAt)}</dd>
        </div>
        <div>
          <dt>Page</dt>
          <dd>{item.page ?? "Not known"}</dd>
        </div>
        <div>
          <dt>Browser</dt>
          <dd>{item.device}</dd>
        </div>
        <div>
          <dt>App version</dt>
          <dd>{item.appVersion ?? "Not known"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusText(item)}</dd>
        </div>
      </dl>
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
      <div className={styles.row}>
        {reply ? (
          <a
            href={reply}
            className={styles.button}
            onClick={() => {
              if (!item.repliedAt) {
                void change(
                  { replied: true },
                  "Your email app should open with a reply. Marked as replied (undo below if you didn't send it).",
                );
              }
            }}
          >
            Reply by email
          </a>
        ) : null}
        {item.sender ? (
          <button type="button" className={styles.secondary} onClick={() => void copy()}>
            Copy email address
          </button>
        ) : null}
        {sender ? (
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => onOpenAccount(sender.id)}
          >
            Open their account
          </button>
        ) : null}
      </div>
      <div className={styles.row}>
        {item.repliedAt ? (
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void change({ replied: false }, "No longer marked as replied.")}
          >
            Undo &ldquo;replied&rdquo;
          </button>
        ) : (
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void change({ replied: true }, "Marked as replied.")}
          >
            Mark as replied
          </button>
        )}
        {item.doneAt ? (
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void change({ done: false }, "Moved back to the inbox.")}
          >
            Move back to the inbox
          </button>
        ) : (
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void change({ done: true }, "Marked done.")}
          >
            Mark done
          </button>
        )}
      </div>
      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault();
          void change({ note }, "Note saved.");
        }}
      >
        <div className={styles.field}>
          <label htmlFor={`${id}-note`}>Private note (only admins see it)</label>
          <textarea
            id={`${id}-note`}
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button type="submit" className={styles.secondary} disabled={busy}>
            Save note
          </button>
        </div>
      </form>
    </div>
  );
}
