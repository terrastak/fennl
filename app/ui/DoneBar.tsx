import { useEffect, useRef } from "react";
import ui from "./ui.module.css";

// The shared "done" bar (U23, owner's choice 2026-11-07): after a change that can be taken back,
// one grey bar with a green check, the words ("Added to Untested.") and Undo at its right, shown
// where the change happened. On a laptop every screen draws it the same way (ui.module.css).
//
// Phones, touch screens and narrow windows keep each screen's own look, passed in as classes
// (`className` for the bar while it says something, `messageClassName`, `undoClassName`), so a
// screen can move onto this bar without changing how it looks there.
//
// The bar is always in the page when `message` is "" (so screen readers hear the words when they
// appear); render it only while there is something to say if an empty bar would take up room.
// Undo goes away once used: the focus moves to the words, and the caller keeps the bar in the page
// saying "Undone." (pass no `onUndo`), so the next Tab carries on from here rather than from the
// top of the page. A bar that unmounts after Undo drops the focus to the page instead.
//
// `focusKey`: when the button that made the change goes with what it changed (Remove photo), pass a
// new number with each change and the focus moves to the words, so Undo is the next Tab.

export function DoneBar({
  message,
  onUndo,
  undoDisabled = false,
  problem = false,
  className,
  messageClassName,
  undoClassName,
  focusKey = 0,
}: {
  /** What was done ("Added to Untested."), or "" for nothing. */
  message: string;
  /** Takes the change back; without it there is no Undo (after Undo itself, say). */
  onUndo?: (() => void) | null | undefined;
  undoDisabled?: boolean;
  /** The words say something went wrong ("That couldn't be saved…"): no green check. */
  problem?: boolean;
  className?: string | undefined;
  messageClassName?: string | undefined;
  undoClassName?: string | undefined;
  /** A new non-zero number moves the focus to the words (see above). */
  focusKey?: number;
}) {
  const words = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusKey) words.current?.focus();
  }, [focusKey]);
  const shown = message !== "";
  return (
    <div className={[ui.doneBar, shown ? ui.shown : "", shown ? (className ?? "") : ""].join(" ")}>
      <p
        role="status"
        ref={words}
        tabIndex={-1}
        className={`${ui.doneWords} ${messageClassName ?? ""}`}
      >
        {shown && !problem ? (
          <svg className={ui.icon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : null}
        {message}
      </p>
      {shown && onUndo ? (
        <>
          {" "}
          <button
            type="button"
            className={`${ui.undo} ${undoClassName ?? ""}`}
            disabled={undoDisabled}
            onClick={() => {
              words.current?.focus();
              onUndo();
            }}
          >
            <svg className={ui.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
            Undo
          </button>
        </>
      ) : null}
    </div>
  );
}
