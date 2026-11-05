import { useRef } from "react";
import styles from "./categories.module.css";
import type { Done } from "./useUndoable";

// The last category change, which can be taken back ("Added 3 recipes to Desserts. Undo").

export function UndoBar({
  done,
  failed,
  onUndo,
  disabled = false,
}: {
  done: Done | null;
  failed: boolean;
  onUndo: () => void;
  disabled?: boolean;
}) {
  const message = useRef<HTMLParagraphElement>(null);
  return (
    // Always there, so screen readers hear the message when it appears.
    <div className={done || failed ? styles.undoBar : undefined}>
      {/* Undo goes away once used: the focus moves to the message ("Undone."), which stays, so
          the next Tab carries on from here rather than from the top of the page. */}
      <p role="status" ref={message} tabIndex={-1}>
        {failed ? "That couldn’t be saved just now. Please try again." : (done?.message ?? "")}
      </p>
      {done && done.undo.length > 0 && !failed ? (
        <button
          type="button"
          className={styles.undoButton}
          onClick={() => {
            message.current?.focus();
            onUndo();
          }}
          disabled={disabled}
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}
