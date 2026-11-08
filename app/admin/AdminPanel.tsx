import { useId, useState, type FormEvent, type RefObject } from "react";
import { Logo } from "../shell/Logo";
import { AdminIcon } from "./AdminIcon";
import type { AdminMe } from "./client";
import { GROUPS, SECTIONS, type SectionId } from "./adminSections";
import styles from "./admin.module.css";

// The admin console's left panel on a laptop (U23, owner's choices 2026-11-07): built like the
// app's left panel. The Fennl name with a small "Admin" tag, Find an account (on every screen; "/"
// jumps to it), the sections, and at the bottom Your admin account, Sign out, the admin address
// and when the session ends. Phones, touch screens and windows under 900px keep the top bar and
// the row of buttons (AdminApp.tsx).

function clock(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" }) : "";
}

export function AdminPanel({
  me,
  section,
  accountOpen,
  attentionCount,
  newFeedback,
  findRef,
  onShow,
  onFind,
  onSignOut,
}: {
  me: AdminMe;
  section: SectionId;
  /** An account page is showing (opened from `section`). */
  accountOpen: boolean;
  attentionCount: number | null;
  newFeedback: number | null;
  findRef: RefObject<HTMLInputElement | null>;
  onShow: (section: SectionId) => void;
  onFind: (query: string) => void;
  onSignOut: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const find = (event: FormEvent) => {
    event.preventDefault();
    onFind(query.trim());
  };

  const item = (s: (typeof SECTIONS)[number]) => {
    const current = !accountOpen && section === s.id;
    // An account opened from this section: "true" rather than "page", said as well as shown.
    const within = accountOpen && section === s.id;
    return (
      <li key={s.id}>
        <button
          type="button"
          className={styles.panelLink}
          aria-current={current ? "page" : within ? "true" : undefined}
          data-within={within ? "" : undefined}
          onClick={() => onShow(s.id)}
        >
          <AdminIcon name={s.icon} />
          {s.name}
          {s.id === "attention" && attentionCount ? (
            <>
              <span className="visually-hidden">({attentionCount})</span>
              <span className={styles.panelCount} aria-hidden="true">
                {attentionCount}
              </span>
            </>
          ) : null}
          {s.id === "feedback" && newFeedback ? (
            <>
              <span className="visually-hidden">({newFeedback} new)</span>
              <span className={styles.panelNew} aria-hidden="true">
                {newFeedback} new
              </span>
            </>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <aside className={styles.sidePanel} aria-label="Admin console">
      <div className={styles.panelTop}>
        <p className={styles.panelBrand}>
          <Logo />
          <span className={styles.adminTag}>Admin</span>
        </p>
        <form className={styles.find} role="search" onSubmit={find}>
          <AdminIcon name="search" />
          <input
            ref={findRef}
            id={`${id}-find`}
            className={styles.findField}
            type="search"
            minLength={2}
            required
            placeholder="Find an account"
            aria-label="Find an account by email or name"
            aria-describedby={`${id}-find-key`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
          {query ? (
            <button type="submit" className={styles.findGo} title="Find">
              <AdminIcon name="arrowRight" />
              <span className="visually-hidden">Find</span>
            </button>
          ) : (
            <kbd className={styles.findKey} hidden={focused} aria-hidden="true">
              /
            </kbd>
          )}
          <span id={`${id}-find-key`} className="visually-hidden">
            Press slash to come back here from anywhere in the console.
          </span>
        </form>
      </div>
      <nav aria-label="Admin sections" className={styles.panelNav}>
        {GROUPS.map((g) => (
          <div key={g.id} className={styles.panelGroup}>
            {g.heading ? (
              <p className={styles.panelHeading} aria-hidden="true">
                {g.heading}
              </p>
            ) : null}
            <ul className={styles.panelList} aria-label={g.heading ?? undefined}>
              {SECTIONS.filter((s) => s.group === g.id).map(item)}
            </ul>
          </div>
        ))}
        <ul className={`${styles.panelList} ${styles.panelBottom}`}>
          {SECTIONS.filter((s) => s.group === "bottom").map(item)}
        </ul>
      </nav>
      <div className={styles.panelFoot}>
        <button type="button" className={styles.panelLink} onClick={onSignOut}>
          <AdminIcon name="signOut" />
          Sign out
        </button>
        <p className={styles.panelSession}>
          <span>{window.location.host}</span>
          <span>Session ends {clock(me.expiresAt)}</span>
        </p>
      </div>
    </aside>
  );
}
