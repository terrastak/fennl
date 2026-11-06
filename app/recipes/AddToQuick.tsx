import { quickFilterLabel, type QuickFilter } from "../../shared/quickSearches";
import { useLibrary } from "./libraryContext";
import { TickIcon } from "./QuickMenu";
import { quickSearchProblem } from "./quickSearches";
import styles from "./quickSearches.module.css";

// Filters' button beside a filter that is set (U18, owner's choice 3): adds it to the quick
// searches as a tick line, or says it's already there; pressed again, it takes it out. In the
// computer's filter bar (U22) it is a menu's last row, with a bookmark, or a bookmark alone
// beside an ingredient word.

export function AddToQuick({
  item,
  small = false,
  look = small ? "small" : "chip",
  onProblem,
}: {
  item: QuickFilter;
  /** Inside an ingredient word's chip. */
  small?: boolean;
  /** "menu": a filter bar menu's row; "icon": the bookmark alone, its words in its title. */
  look?: "chip" | "small" | "menu" | "icon";
  onProblem: (text: string) => void;
}) {
  const { quick } = useLibrary();
  const there = quick.has(item);
  const text = there ? "In quick searches" : "Add to quick searches";
  const className = {
    chip: styles.addButton,
    small: `${styles.addButton} ${styles.addSmall}`,
    menu: styles.addRow,
    icon: styles.addIcon,
  }[look];
  const bar = look === "menu" || look === "icon";
  return (
    <button
      type="button"
      className={className}
      aria-pressed={there}
      // What it adds, said too, as the panel has several ("Add to quick searches: Without
      // mushroom"), starting with the words shown.
      aria-label={`${text}: ${quickFilterLabel(item)}`}
      title={look === "icon" ? `${text}: ${quickFilterLabel(item)}` : undefined}
      onClick={() => {
        onProblem("");
        void quick.toggle(item).then((outcome) => {
          if (!outcome.ok) onProblem(quickSearchProblem(outcome.error));
        });
      }}
    >
      {there ? (
        <TickIcon size={bar ? 14 : 12} />
      ) : bar ? (
        <BookmarkPlusIcon />
      ) : (
        <span aria-hidden="true">+</span>
      )}
      {look === "icon" ? null : text}
    </button>
  );
}

/** A bookmark with a plus: adding to the quick searches (U22 mockup). */
function BookmarkPlusIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" />
      <path d="M12 7.5v5M9.5 10h5" />
    </svg>
  );
}
