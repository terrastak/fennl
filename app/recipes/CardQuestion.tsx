import { useId } from "react";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import styles from "./recipes.module.css";

/**
 * A question asked right where its button was, before something can't be taken back (Trash's
 * "Delete … for good?", phase C9 and U24; a draft's "Discard your changes?", U27 part 3): a
 * warning sign, the question and what it means, a soft red button with the keyboard focus, then
 * Cancel in plain words. Drawn in a pale red strip at the foot of a card or under a count line.
 */
export function CardQuestion({
  question,
  note,
  action,
  actionIcon,
  busy = false,
  busyText,
  onConfirm,
  onCancel,
}: {
  question: string;
  /** What it means, under the question ("This can’t be undone."). */
  note: string;
  action: string;
  /** An icon before the action's words (a bin for deleting). */
  actionIcon?: string | undefined;
  busy?: boolean;
  /** The action's words while it's under way ("Deleting…"). */
  busyText?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const noteId = useId();
  return (
    <div
      className={styles.confirm}
      role="group"
      aria-label={question}
      aria-describedby={noteId}
      // Escape closes it, as Cancel does.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
    >
      <LaptopIcon path={LAPTOP_ICONS.warning} className={styles.confirmIcon} />
      <p>
        <span className={styles.confirmQuestion}>{question}</span>{" "}
        <span id={noteId} className={styles.confirmNote}>
          {note}
        </span>
      </p>
      <div className={styles.trashButtons}>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={busy}
          autoFocus
          onClick={onConfirm}
        >
          {actionIcon ? <LaptopIcon path={actionIcon} /> : null}
          {busy && busyText ? busyText : action}
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
