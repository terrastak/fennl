import { useState } from "react";
import { pairKey, type DuplicatePair } from "../../shared/duplicates";
import { UndoBar } from "../categories/UndoBar";
import { useUndoable } from "../categories/useUndoable";
import { PageHeader } from "../pages/PageHeader";
import { Link } from "../router";
import { activeSyncClient, useRecipeList } from "../sync/useSync";
import { problemText, useDuplicateDismissals } from "./duplicateDismissals";
import { MergePanel } from "./MergePanel";
import styles from "./recipes.module.css";

// Find duplicates (phase C14): recipes saved twice, found on this device when asked (nothing runs
// in the background), compared side by side and merged, or marked "not a duplicate" so they
// aren't offered again. Merging never deletes: the extra copy goes to Trash, and Undo puts
// everything back.

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
    <>
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
          className={styles.primary}
          disabled={scanning || recipes === null}
          onClick={() => void scan()}
        >
          {scanning ? "Looking…" : found === null ? "Find duplicates" : "Look again"}
        </button>
        {dismissed !== null && dismissed.length > 0 && found !== null && hiddenCount > 0 ? (
          <button type="button" className={styles.textButton} onClick={() => void showAgain()}>
            Show {hiddenCount === 1 ? "the dismissed pair" : `${hiddenCount} dismissed pairs`} again
          </button>
        ) : null}
      </div>

      <UndoBar done={done} failed={failed} onUndo={() => void undo()} />
      <p
        role={message?.problem ? "alert" : "status"}
        className={message?.problem ? styles.error : styles.hint}
      >
        {message?.text ?? ""}{" "}
        {lastDismissed && !message?.problem ? (
          <button type="button" className={styles.textButton} onClick={() => void takeBack()}>
            Undo
          </button>
        ) : null}
      </p>

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
                      <span aria-hidden="true"> and </span>
                      <span className="visually-hidden">and</span>
                      <Link href={`/recipes/${b.id}`}>{b.title || "Untitled"}</Link>
                    </p>
                    <p className={styles.hint}>{REASONS[pair.reason]}</p>
                  </div>
                  <div className={styles.duplicateButtons}>
                    <button
                      type="button"
                      className={styles.secondary}
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : key)}
                    >
                      {isOpen ? "Close" : "Compare and merge"}
                    </button>
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => void notDuplicate(pair)}
                    >
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
    </>
  );
}
