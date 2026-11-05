import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLibrary } from "../recipes/libraryContext";
import { RemoveIcon } from "../recipes/QuickMenu";
import { QuickAddButton, QuickChoicesButton } from "../recipes/QuickSearchMenus";
import { quickFilterOn, toggleQuickFilter } from "../recipes/quickSearchFilters";
import { quickSearchProblem, type QuickSearchEntry } from "../recipes/quickSearches";
import { problemText } from "../recipes/savedSearches";
import { Link } from "../router";
import { CheckIcon, SearchIcon } from "./Library";
import styles from "./Library.module.css";
import { titleIfCut } from "./titleIfCut";
import { swallowNextClick } from "./useCategoryDrag";

// The left panel's quick searches (U18, owner's choices 2026-11-05): one section under All
// recipes, made by the person. A tick line is one filter, on or off, staying on with the
// category, the search words and the other tick lines, with how many recipes it would show; one
// with choices has a ▾ to change them. A search line shows a whole saved search. Pointing at a
// line (or reaching it with Tab) shows a ✕ where its count was, removing it at once (a search
// line's saved search is deleted). Lines are put in order by dragging them with the mouse, or
// with Alt and the up and down arrows. Every change is kept with the account (quickSearches.ts).

/** How far the mouse moves, pressed, before a click becomes a drag. */
const THRESHOLD = 5;

type Part = "main" | "more" | "add";

export function QuickSearches({ savedHere }: { savedHere: string | null }) {
  const library = useLibrary();
  const { quick, query, filters, onList, counts } = library;
  const entries = quick.entries;
  const list = useRef<HTMLUListElement>(null);
  const section = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");
  // Said again, the same words still change the live region, so a second move is heard too.
  const say = (text: string) => setSaid((before) => (before === text ? `${text}\u00a0` : text));
  const [drag, setDrag] = useState<{ key: string; lineY: number } | null>(null);

  // The focus follows a line that moved or changed, or goes on after one removed: the line is
  // drawn again (under a new key, or in a new place), so it's put back once it has been. After a
  // removal (`gone`) it moves only once that line has really gone.
  const focusNext = useRef<{ key: string; part: Part; gone?: string } | null>(null);
  useLayoutEffect(() => {
    const want = focusNext.current;
    const root = section.current;
    if (!want || !root) return;
    if (
      want.gone !== undefined &&
      root.querySelector(`[data-quick-key="${CSS.escape(want.gone)}"]`)
    ) {
      return;
    }
    const target =
      want.part === "add"
        ? root.querySelector<HTMLElement>("[data-quick-add]")
        : root.querySelector<HTMLElement>(
            `[data-quick-key="${CSS.escape(want.key)}"] [data-quick-part="${want.part}"]`,
          );
    if (!target) return;
    focusNext.current = null;
    if (document.activeElement !== target) target.focus();
  });

  const report = (outcome: { ok: true } | { ok: false; error: string }, saved = false) => {
    if (outcome.ok) return;
    setProblem(
      saved
        ? problemText(outcome.error)
        : quickSearchProblem(outcome.error as "offline" | "too_many" | "failed"),
    );
  };

  const remove = (entry: QuickSearchEntry, index: number) => {
    setProblem("");
    const next = entries[index + 1] ?? entries[index - 1];
    const want = next
      ? { key: next.key, part: "main" as const, gone: entry.key }
      : { key: "", part: "add" as const, gone: entry.key };
    focusNext.current = want;
    const done = (outcome: { ok: true } | { ok: false; error: string }) => {
      if (outcome.ok) return;
      // Not removed: the focus stays on the line, or goes back to it if it came back.
      if (focusNext.current === want) focusNext.current = null;
      else if (focusNext.current === null) focusNext.current = { key: entry.key, part: "main" };
    };
    if (entry.search) {
      const name = entry.label;
      void library.saved.remove(entry.search.id).then((outcome) => {
        done(outcome);
        report(outcome, true);
        if (outcome.ok) say(`Deleted the saved search ${name}.`);
      });
    } else {
      void quick.remove(entry.key).then((outcome) => {
        done(outcome);
        report(outcome);
      });
    }
  };

  const move = (entry: QuickSearchEntry, index: number, by: -1 | 1) => {
    const neighbour = entries[index + by];
    if (!neighbour) return;
    setProblem("");
    const before = by < 0 ? neighbour.key : (entries[index + 2]?.key ?? null);
    focusNext.current = { key: entry.key, part: "main" };
    const words = `Moved ${entry.label} ${by < 0 ? "up" : "down"}.`;
    void quick.moveBefore(entry.key, before).then((outcome) => {
      report(outcome);
      if (outcome.ok) say(words);
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent, entry: QuickSearchEntry, index: number) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    move(entry, index, event.key === "ArrowUp" ? -1 : 1);
  };

  // Dragging a line with the mouse: a line between two rows shows where it would go; Escape puts
  // it back.
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, key: string) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let cancelled = false;
    let before: string | null | undefined;

    const rows = () => [
      ...(list.current?.querySelectorAll<HTMLElement>(":scope > [data-quick-key]") ?? []),
    ];
    const place = (y: number) => {
      const all = rows();
      const box = list.current?.getBoundingClientRect();
      if (!box || all.length === 0) return;
      const rects = all.map((row) => row.getBoundingClientRect());
      let index = rects.findIndex((rect) => y < rect.top + rect.height / 2);
      if (index === -1) index = all.length;
      const lineY = (rects[index]?.top ?? rects.at(-1)?.bottom ?? box.top) - box.top;
      const above = all[index - 1]?.dataset.quickKey;
      const at = all[index]?.dataset.quickKey ?? null;
      // Dropped next to where it is already, nothing moves.
      before = at === key || above === key ? undefined : at;
      setDrag({ key, lineY: before === undefined ? -1 : lineY });
    };
    const moved = (e: PointerEvent) => {
      if (cancelled) return;
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
        active = true;
        document.documentElement.dataset.quickDrag = "";
      }
      e.preventDefault();
      place(e.clientY);
    };
    const up = () => {
      cleanup();
      if (!active) return;
      swallowNextClick();
      if (cancelled || before === undefined) return;
      const entry = entries.find((e) => e.key === key);
      setProblem("");
      void quick.moveBefore(key, before).then((outcome) => {
        report(outcome);
        if (outcome.ok && entry) say(`Moved ${entry.label}.`);
      });
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !active || cancelled) return;
      e.preventDefault();
      cancelled = true;
      setDrag(null);
      delete document.documentElement.dataset.quickDrag;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cleanup);
      delete document.documentElement.dataset.quickDrag;
      setDrag(null);
    };
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cleanup);
  };

  return (
    <div ref={section}>
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Quick searches</h2>
        <QuickAddButton className={styles.edit} onProblem={setProblem}>
          <span aria-hidden="true">+</span> Add
        </QuickAddButton>
      </div>
      <p className={styles.quickProblem} role="alert">
        {problem}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
      <ul ref={list} className={`${styles.list} ${styles.quickList}`}>
        {entries.map((entry, index) => {
          const item = entry.item;
          const removeLabel = entry.search
            ? `Delete the saved search ${entry.label}`
            : `Remove ${entry.label} from quick searches`;
          const n = item.type === "filter" ? counts?.quick.get(entry.key) : undefined;
          const on = item.type === "filter" && onList && quickFilterOn(item, filters);
          return (
            <li
              key={entry.key}
              className={`${styles.quickRow} ${drag?.key === entry.key ? styles.quickFrom : ""}`}
              data-quick-key={entry.key}
            >
              {item.type === "filter" ? (
                <button
                  type="button"
                  className={`${styles.quickMain} ${styles.switch}`}
                  aria-pressed={on}
                  data-quick-part="main"
                  onPointerDown={(e) => onPointerDown(e, entry.key)}
                  onKeyDown={(e) => onKeyDown(e, entry, index)}
                  onClick={() => library.show(query, toggleQuickFilter(filters, item))}
                >
                  <span className={styles.icon}>
                    <span className={styles.box}>
                      <CheckIcon />
                    </span>
                  </span>
                  <span className={styles.name} onPointerEnter={(e) => titleIfCut(e, entry.label)}>
                    {entry.label}
                  </span>
                  {n !== undefined ? (
                    <span className="visually-hidden">
                      , {n} {n === 1 ? "recipe" : "recipes"}
                    </span>
                  ) : null}
                </button>
              ) : (
                <Link
                  href={entry.search?.query ? `/?${entry.search.query.replace(/^\?/, "")}` : "/"}
                  className={styles.quickMain}
                  aria-current={savedHere === entry.search?.id ? "page" : undefined}
                  draggable={false}
                  data-quick-part="main"
                  onPointerDown={(e) => onPointerDown(e, entry.key)}
                  onKeyDown={(e) => onKeyDown(e, entry, index)}
                  onClick={() => entry.search && library.setChosenSearch(entry.search.id)}
                >
                  <span className={styles.icon}>
                    <SearchIcon size={15} />
                  </span>
                  <span className={styles.name} onPointerEnter={(e) => titleIfCut(e, entry.label)}>
                    {entry.label}
                  </span>
                </Link>
              )}
              <QuickChoicesButton
                entry={entry}
                className={styles.quickMore}
                onProblem={setProblem}
                onChanged={(key) => (focusNext.current = { key, part: "more" })}
              />
              {n !== undefined ? (
                <span className={`${styles.count} ${styles.quickCount}`} aria-hidden="true">
                  {n}
                </span>
              ) : null}
              <button
                type="button"
                className={styles.quickRemove}
                aria-label={removeLabel}
                title={removeLabel}
                onClick={() => remove(entry, index)}
              >
                <RemoveIcon />
              </button>
            </li>
          );
        })}
        {drag && drag.lineY >= 0 ? (
          <li aria-hidden="true" className={styles.quickLine} style={{ top: drag.lineY }} />
        ) : null}
      </ul>
    </div>
  );
}
