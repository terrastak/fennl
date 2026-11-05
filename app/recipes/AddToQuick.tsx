import { quickFilterLabel, type QuickFilter } from "../../shared/quickSearches";
import { useLibrary } from "./libraryContext";
import { TickIcon } from "./QuickMenu";
import { quickSearchProblem } from "./quickSearches";
import styles from "./quickSearches.module.css";

// Filters' button beside a filter that is set (U18, owner's choice 3): adds it to the quick
// searches as a tick line, or says it's already there; pressed again, it takes it out.

export function AddToQuick({
  item,
  small = false,
  onProblem,
}: {
  item: QuickFilter;
  /** Inside an ingredient word's chip. */
  small?: boolean;
  onProblem: (text: string) => void;
}) {
  const { quick } = useLibrary();
  const there = quick.has(item);
  const text = there ? "In quick searches" : "Add to quick searches";
  return (
    <button
      type="button"
      className={small ? `${styles.addButton} ${styles.addSmall}` : styles.addButton}
      aria-pressed={there}
      // What it adds, said too, as the panel has several ("Add to quick searches: Without
      // mushroom"), starting with the words shown.
      aria-label={`${text}: ${quickFilterLabel(item)}`}
      onClick={() => {
        onProblem("");
        void quick.toggle(item).then((outcome) => {
          if (!outcome.ok) onProblem(quickSearchProblem(outcome.error));
        });
      }}
    >
      {there ? <TickIcon size={12} /> : <span aria-hidden="true">+</span>}
      {text}
    </button>
  );
}
