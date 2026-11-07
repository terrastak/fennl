import { useState } from "react";
import { pairKey, type DuplicatePair } from "../../shared/duplicates";
import categoryStyles from "../categories/categories.module.css";
import { useUndoable } from "../categories/useUndoable";
import { PageHeader } from "../pages/PageHeader";
import { DoneBar } from "../ui/DoneBar";
import { Link } from "../router";
import { activeSyncClient, useRecipeList } from "../sync/useSync";
import { problemText, useDuplicateDismissals } from "./duplicateDismissals";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import { MergePanel } from "./MergePanel";
import styles from "./recipes.module.css";

// Find duplicates (phase C14): recipes saved twice, found on this device when asked (nothing runs
// in the background), compared side by side and merged, or marked "not a duplicate" so they
// aren't offered again. Merging never deletes: the extra copy goes to Trash, and Undo puts
// everything back.
//
// On a laptop (U23, owner's choices 2026-11-07): Find duplicates, Look again and "Show the
// dismissed pair again" quiet buttons with small icons; each pair one white box, its buttons
// quiet with icons (Compare and merge becomes Close while open); what happened in the shared done
// bar, Undo at its right. The comparison itself is in MergePanel. Phones keep the page as it was.

/** Icons beside the words on a laptop only. */
const ICONS = {
  refresh:
    "M20 11a8 8 0 0 0-14.7-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.7 4.3l1.3-1.8M20 20v-4.5h-4.5",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM14.8 12a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 0 1 5.6 0",
  up: "m6 15 6-6 6 6",
};

const REASONS = {
  same_page: "From the same page",
  similar: "The same title and mostly the same ingredients",
} as const;

const recipesText = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

export function DuplicatesPage() {
  const recipes = useRecipeList();
  const { pairs: dismissed, dismiss, undismiss, clear } = useDuplicateDismissals();
  const [found, setFound] = useState<DuplicatePair[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const [lastDismissed, setLastDismissed] = useState<DuplicatePair | null>(null);
  const { done, failed, run, undo } = useUndoable();

  const byId = new Map((recipes ?? []).map((recipe) => [recipe.id, recipe]));
  const skipped = new Set(dismissed ?? []);
  // Pairs still to look at: both recipes are still here, and the person hasn't said no.
  const pairs = (found ?? []).filter(
    (pair) => byId.has(pair.a) && byId.has(pair.b) && !skipped.has(pairKey(pair.a, pair.b)),
  );
  const hiddenCount = (found ?? []).filter(
    (pair) => byId.has(pair.a) && byId.has(pair.b) && skipped.has(pairKey(pair.a, pair.b)),
  ).length;

  const scan = async () => {
    setScanning(true);
    setMessage(null);
    setOpen(null);
    try {
      setFound((await activeSyncClient()?.findDuplicatePairs()) ?? []);
    } catch {
      setMessage({
        text: "Couldn't look through your recipes just now. Please try again.",
        problem: true,
      });
    } finally {
      setScanning(false);
    }
  };

  const notDuplicate = async (pair: DuplicatePair) => {
    const outcome = await dismiss(pair.a, pair.b);
    if (outcome.ok) {
      setLastDismissed(pair);
      setOpen(null);
      setMessage({
        text: "Marked as not duplicates. They won't be offered again.",
        problem: false,
      });
    } else {
      setMessage({ text: problemText(outcome.error), problem: true });
    }
  };

  const takeBack = async () => {
    if (!lastDismissed) return;
    const outcome = await undismiss(lastDismissed.a, lastDismissed.b);
    setLastDismissed(null);
    setMessage(
      outcome.ok
        ? { text: "Put back in the list.", problem: false }
        : { text: problemText(outcome.error), problem: true },
    );
  };

  const showAgain = async () => {
    const outcome = await clear();
    setLastDismissed(null);
    setMessage(
      outcome.ok
        ? { text: "Showing the pairs you dismissed again.", problem: false }
        : { text: problemText(outcome.error), problem: true },
    );
  };

  return (
    <div className={styles.duplicatesPage}>
      <Link href="/" className={styles.back}>
        ← All recipes
      </Link>
      <PageHeader title="Find duplicates">
        <p>
          Looks through your recipes for ones saved twice. Nothing changes until you choose to merge
          two, and the extra copy goes to Trash, so you can always put it back.
        </p>
      </PageHeader>

      <div className={styles.duplicateTop}>
        <button
          type="button"
          className={`${styles.primary} ${found === null ? styles.findButton : styles.againButton}`}
          disabled={scanning || recipes === null}
          onClick={() => void scan()}
        >
          <LaptopIcon path={found === null ? LAPTOP_ICONS.search : ICONS.refresh} />
          {scanning ? "Looking…" : found === null ? "Find duplicates" : "Look again"}
        </button>
        {dismissed !== null && dismissed.length > 0 && found !== null && hiddenCount > 0 ? (
          <button
            type="button"
            className={`${styles.textButton} ${styles.showAgain}`}
            onClick={() => void showAgain()}
          >
            <LaptopIcon path={ICONS.eye} />
            Show {hiddenCount === 1 ? "the dismissed pair" : `${hiddenCount} dismissed pairs`} again
          </button>
        ) : null}
      </div>

      <DoneBar
        message={
          failed ? "That couldn’t be saved just now. Please try again." : (done?.message ?? "")
        }
        problem={failed}
        onUndo={done && done.undo.length > 0 && !failed ? () => void undo() : null}
        className={categoryStyles.undoBar}
        undoClassName={categoryStyles.undoButton}
      />
      {message?.problem ? (
        <p role="alert" className={styles.error}>
          {message.text}{" "}
        </p>
      ) : (
        <DoneBar
          message={message?.text ?? ""}
          onUndo={lastDismissed ? () => void takeBack() : null}
          className={`${styles.hint} ${styles.duplicateNote}`}
          messageClassName={styles.inlineWords}
          undoClassName={styles.textButton}
        />
      )}

      {found === null ? null : pairs.length === 0 ? (
        <p>
          {found.length === 0
            ? `No duplicates found among your ${recipesText(recipes?.length ?? 0)}.`
            : "No more duplicates to look at."}
        </p>
      ) : (
        <section aria-labelledby="duplicates-count">
          <h2 id="duplicates-count" className={styles.duplicateCount}>
            {pairs.length === 1 ? "1 possible duplicate" : `${pairs.length} possible duplicates`}
          </h2>
          <ul className={styles.duplicateList}>
            {pairs.map((pair) => {
              const key = pairKey(pair.a, pair.b);
              const a = byId.get(pair.a);
              const b = byId.get(pair.b);
              if (!a || !b) return null;
              const isOpen = open === key;
              return (
                <li key={key} className={styles.duplicatePair}>
                  <div className={styles.duplicateHead}>
                    <p className={styles.duplicateTitles}>
                      <Link href={`/recipes/${a.id}`}>{a.title || "Untitled"}</Link>
                      <span aria-hidden="true" className={styles.duplicateAnd}>
                        {" and "}
                      </span>
                      <span className="visually-hidden">and</span>
                      <Link href={`/recipes/${b.id}`}>{b.title || "Untitled"}</Link>
                    </p>
                    <p className={styles.hint}>{REASONS[pair.reason]}</p>
                  </div>
                  <div className={styles.duplicateButtons}>
                    <button
                      type="button"
                      className={`${styles.secondary} ${styles.pairButton}`}
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : key)}
                    >
                      <LaptopIcon path={isOpen ? ICONS.up : LAPTOP_ICONS.copy} />
                      {isOpen ? "Close" : "Compare and merge"}
                    </button>
                    <button
                      type="button"
                      className={`${styles.textButton} ${styles.pairButton}`}
                      onClick={() => void notDuplicate(pair)}
                    >
                      <LaptopIcon path={LAPTOP_ICONS.x} />
                      Not a duplicate
                    </button>
                  </div>
                  {isOpen ? (
                    <MergePanel
                      firstId={pair.a}
                      secondId={pair.b}
                      run={run}
                      onCancel={() => setOpen(null)}
                      onMerged={() => {
                        setOpen(null);
                        setLastDismissed(null);
                        setMessage(null);
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
