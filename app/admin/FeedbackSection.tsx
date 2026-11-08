import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  feedbackStatus,
  replyLink,
  type FeedbackChange,
  type FeedbackFilter,
  type FeedbackInbox,
  type FeedbackItem,
} from "../../shared/feedback";
import { adminRequest } from "./api";
import { AdminIcon } from "./AdminIcon";
import { day, statusText } from "./feedbackText";
import { usePointer } from "../recipes/usePointer";
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

/** A list row's date: "Nov 6", with the year when it isn't this one. */
function shortDay(iso: string): string {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(thisYear ? {} : { year: "numeric" }),
  });
}

function senderName(item: FeedbackItem): string {
  return item.sender?.name || item.sender?.email || "Deleted account";
}

function snippet(item: FeedbackItem): string {
  return item.message.length > 140 ? `${item.message.slice(0, 140)}…` : item.message;
}

/** The feedback inbox (phase B8): newest first, by status, with replies by email. */
/** Up and down the laptop's list of messages with the arrow keys, Home and End. */
function moveInList(event: KeyboardEvent<HTMLUListElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
  rows[next]?.focus();
}

export function FeedbackSection({
  onOpenAccount,
  onCounts,
  initialOpen = null,
}: {
  onOpenAccount: (userId: string) => void;
  onCounts: (counts: FeedbackInbox["counts"]) => void;
  /** A message to open (from an account page's finding), shown among all messages. */
  initialOpen?: string | null;
}) {
  const id = useId();
  const [filter, setFilter] = useState<FeedbackFilter>(initialOpen ? "all" : "new");
  const [inbox, setInbox] = useState<FeedbackInbox | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const markedOpen = useRef(false);

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

  // The message opened from an account page is read now, as opening it here would.
  useEffect(() => {
    if (markedOpen.current || !initialOpen || !inbox) return;
    markedOpen.current = true;
    const item = inbox.items.find((i) => i.id === initialOpen);
    if (!item || item.readAt) return;
    void adminRequest<FeedbackItem>(`/api/admin/feedback/${item.id}/read`, { body: {} }).then(
      (result) => {
        if (result.ok) void replace(result.body as FeedbackItem);
      },
    );
  }, [inbox, initialOpen, replace]);

  const laptop = usePointer();
  const open = async (item: FeedbackItem) => {
    if (openId === item.id) {
      // On a laptop the open message stays beside the list; elsewhere it folds away again.
      if (!laptop) setOpenId(null);
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

  const filters = (
    <div className={laptop ? styles.segSwitch : styles.filters} role="group" aria-label="Show">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={laptop ? styles.segPart : styles.navButton}
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
  );

  if (laptop) {
    const opened = inbox?.items.find((i) => i.id === openId) ?? null;
    const openInList = opened !== null;
    return (
      <section className={`${styles.page} ${styles.mailPage}`} aria-labelledby={`${id}-title`}>
        <header className={styles.pageHead}>
          <h2 id={`${id}-title`} className={styles.pageTitle}>
            Feedback
          </h2>
          <p className={styles.pageLede}>
            Messages sent from the app&rsquo;s feedback form, newest first. Replies go from your own
            email app.
          </p>
        </header>
        {filters}
        {failed ? (
          <p role="alert" className={styles.error}>
            Couldn&rsquo;t load feedback.
          </p>
        ) : inbox === null ? (
          <p role="status" className={styles.boxNote}>
            Loading…
          </p>
        ) : inbox.items.length === 0 ? (
          <p className={styles.boxNote}>
            {filter === "new" ? "Nothing new. You're all caught up." : "No messages here."}
          </p>
        ) : (
          <div className={styles.mailCols}>
            {/* One Tab stop for the list (the open message's row, else the first); the arrow keys,
                Home and End move along it, so Tab goes on to the open message at once. */}
            <span id={`${id}-keys`} className="visually-hidden">
              The up and down arrow keys move between messages.
            </span>
            <ul
              className={`${styles.rows} ${styles.mailList}`}
              aria-label="Messages"
              onKeyDown={moveInList}
            >
              {inbox.items.map((item, i) => {
                const isNew = feedbackStatus(item) === "new";
                const stop = openInList ? openId === item.id : i === 0;
                return (
                  <li key={item.id} className={styles.rowItem}>
                    <button
                      type="button"
                      className={styles.mailRow}
                      tabIndex={stop ? 0 : -1}
                      aria-describedby={`${id}-keys`}
                      aria-current={openId === item.id ? "true" : undefined}
                      aria-controls={openId === item.id ? `${id}-open` : undefined}
                      data-new={isNew ? "" : undefined}
                      onClick={() => void open(item)}
                    >
                      <span className={styles.mailTop}>
                        {isNew ? <span className={styles.dot} aria-hidden="true" /> : null}
                        <span className={styles.mailFrom}>{senderName(item)}</span>
                        {isNew ? (
                          <span className={`${styles.tag} ${styles.tagKnow}`}>New</span>
                        ) : null}
                        <span className={styles.mailDate}>{shortDay(item.createdAt)}</span>
                      </span>
                      <span className={styles.mailSnippet}>{snippet(item)}</span>
                      {isNew ? null : <span className={styles.mailStatus}>{statusText(item)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {opened ? (
              <FeedbackDetail
                key={opened.id}
                item={opened}
                paneId={`${id}-open`}
                onChange={replace}
                onOpenAccount={onOpenAccount}
              />
            ) : (
              <p className={`${styles.boxNote} ${styles.mailEmpty}`}>
                Choose a message to read it here.
              </p>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Feedback</h2>
      {filters}
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
                    {senderName(item)}
                  </span>
                  <span className={styles.badge}>{statusText(item)}</span>
                </span>
                {openId === item.id ? null : (
                  <span className={styles.feedbackSnippet}>{snippet(item)}</span>
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
  paneId,
  onChange,
  onOpenAccount,
}: {
  item: FeedbackItem;
  /** On a laptop: the message is shown beside the list, in a box of its own with this id. */
  paneId?: string;
  onChange: (item: FeedbackItem) => Promise<void>;
  onOpenAccount: (userId: string) => void;
}) {
  const id = useId();
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (body: FeedbackChange, done: string) => {
    if (busy) return;
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
  const replyClick = () => {
    if (!item.repliedAt) {
      void change(
        { replied: true },
        "Your email app should open with a reply. Marked as replied (undo below if you didn't send it).",
      );
    }
  };

  if (paneId) {
    // A laptop (U23): the open message beside the list. Reply by email is the screen's one ink
    // button; everything else is quiet icon and words. Buttons aren't disabled while saving
    // (change() waits instead): a disabled button drops the keyboard focus.
    return (
      <section id={paneId} className={styles.mailPane} aria-labelledby={`${id}-from`}>
        <header className={styles.mailPaneHead}>
          <div className={styles.mailWho}>
            <h3 id={`${id}-from`} className={styles.mailName}>
              {senderName(item)}
            </h3>
            <p className={styles.mailMeta}>
              {sender ? <span className={styles.subPart}>{sender.email}</span> : null}
              {sender ? " · " : null}
              <span className={styles.subPart}>Sent {when(item.createdAt)}</span>
            </p>
          </div>
          {feedbackStatus(item) === "new" ? (
            <span className={`${styles.tag} ${styles.tagKnow}`}>New</span>
          ) : (
            <span className={styles.mailStatus}>{statusText(item)}</span>
          )}
        </header>
        <p className={styles.feedbackMessage}>{item.message}</p>
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
        <div className={`${styles.row} ${styles.mailActions}`}>
          {reply ? (
            <a href={reply} className={styles.ink} onClick={replyClick}>
              <AdminIcon name="mail" />
              Reply by email
            </a>
          ) : null}
          {sender ? (
            <button type="button" className={styles.quiet} onClick={() => void copy()}>
              <AdminIcon name="copy" />
              Copy email address
            </button>
          ) : null}
          {sender ? (
            <button type="button" className={styles.quiet} onClick={() => onOpenAccount(sender.id)}>
              <AdminIcon name="people" />
              Open their account
            </button>
          ) : null}
          {item.repliedAt ? (
            <button
              type="button"
              className={styles.quiet}
              aria-disabled={busy || undefined}
              onClick={() => void change({ replied: false }, "No longer marked as replied.")}
            >
              <AdminIcon name="undo" />
              Undo &ldquo;replied&rdquo;
            </button>
          ) : (
            <button
              type="button"
              className={styles.quiet}
              aria-disabled={busy || undefined}
              onClick={() => void change({ replied: true }, "Marked as replied.")}
            >
              <AdminIcon name="send" />
              Mark as replied
            </button>
          )}
          {item.doneAt ? (
            <button
              type="button"
              className={styles.quiet}
              aria-disabled={busy || undefined}
              onClick={() => void change({ done: false }, "Moved back to the inbox.")}
            >
              <AdminIcon name="undo" />
              Move back to the inbox
            </button>
          ) : (
            <button
              type="button"
              className={styles.quiet}
              aria-disabled={busy || undefined}
              onClick={() => void change({ done: true }, "Marked done.")}
            >
              <AdminIcon name="check" />
              Mark done
            </button>
          )}
        </div>
        <dl className={styles.infoRows}>
          <div>
            <dt>From</dt>
            <dd>{sender ? `${sender.name} (${sender.email})` : "A deleted account"}</dd>
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
        <form
          className={styles.mailNote}
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
            <button type="submit" className={styles.quiet} aria-disabled={busy || undefined}>
              Save note
            </button>
          </div>
        </form>
      </section>
    );
  }

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
          <a href={reply} className={styles.button} onClick={replyClick}>
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
