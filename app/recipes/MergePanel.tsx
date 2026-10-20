import { useState } from "react";
import { recipeBytes } from "../../shared/recipe";
import type { Plan } from "../categories/tree";
import type { RecipeDetail } from "../sync/dbProtocol";
import { activeSyncClient, useCategoryTree, useRecipe, useSyncStatus } from "../sync/useSync";
import { canEdit } from "../sync/status";
import {
  defaultChoices,
  differingRows,
  MERGE_ROWS,
  mergedContent,
  planMerge,
  rowLines,
  suggestKeeper,
  type MergeRow,
  type Side,
} from "./merge";
import styles from "./recipes.module.css";

// Comparing two copies of a recipe and merging them (phase C14; the plan is app/recipes/merge.ts).
// One is kept, with whatever the person picks from the other; the other goes to Trash. It starts
// with sensible picks, so merging needs no choosing unless the person wants to, and it says
// exactly what will happen before anything does.

const LONG = 12;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A recipe in a few words, to tell two copies apart. */
function summary(detail: RecipeDetail): string {
  const { recipe } = detail;
  const parts = [
    count(recipe.ingredients.filter((l) => !l.heading && l.text.trim()).length, "ingredient"),
    count(recipe.directions.filter((l) => !l.heading && l.text.trim()).length, "step"),
  ];
  if (detail.photos.length > 0) parts.push(count(detail.photos.length, "photo"));
  if (detail.made.length > 0) parts.push(`made ${count(detail.made.length, "time")}`);
  return parts.join(" · ");
}

function Lines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return <span className={styles.hint}>Nothing written</span>;
  const shown = lines.slice(0, LONG);
  return (
    <span className={styles.mergeLines}>
      {shown.map((line, i) => (
        <span key={i}>{line}</span>
      ))}
      {lines.length > LONG ? (
        <span className={styles.hint}>…and {count(lines.length - LONG, "more line")}</span>
      ) : null}
    </span>
  );
}

export function MergePanel({
  firstId,
  secondId,
  onMerged,
  onCancel,
  run,
}: {
  firstId: string;
  secondId: string;
  /** Called after the merge is saved. */
  onMerged: () => void;
  onCancel: () => void;
  /** Saves a plan and remembers how to undo it (useUndoable). */
  run: (plan: Plan, message: string) => Promise<boolean>;
}) {
  const first = useRecipe(firstId);
  const second = useRecipe(secondId);
  const tree = useCategoryTree();
  const status = useSyncStatus();
  const [keeperId, setKeeperId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Partial<Record<MergeRow, Side>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (first === undefined || second === undefined || !tree) {
    return <p className={styles.hint}>Looking at both recipes…</p>;
  }
  if (first === null || second === null) {
    return (
      <p className={styles.hint}>One of these recipes is gone, so there is nothing to merge.</p>
    );
  }

  const suggested = suggestKeeper(first.recipe, second.recipe)[0].id;
  const keepId = keeperId ?? suggested;
  const keeper = keepId === first.recipe.id ? first : second;
  const other = keeper === first ? second : first;
  const me = activeSyncClient()?.userId ?? "";
  const choices = {
    ...defaultChoices(keeper.recipe, other.recipe),
    ...picked,
  } as Record<MergeRow, Side>;
  const different = differingRows(keeper.recipe, other.recipe);
  const same = MERGE_ROWS.filter((row) => !different.includes(row.id));

  const planFor = (now: number) =>
    planMerge({ keeper, other, choices, me, now, tree, photos: status.photos });
  const plan = planFor(0);
  const limit = status.usage?.maxRecipeBytes ?? null;
  const tooLong =
    limit !== null && recipeBytes(mergedContent(keeper.recipe, other.recipe, choices)) > limit;

  const chooseKeeper = (id: string) => {
    setKeeperId(id);
    setPicked({});
  };

  const merge = async (now: number) => {
    setBusy(true);
    setFailed(false);
    const ok = await run(
      planFor(now),
      `Merged “${other.recipe.title || "Untitled"}” into “${keeper.recipe.title || "Untitled"}”.`,
    );
    setBusy(false);
    if (ok) onMerged();
    else setFailed(true);
  };

  return (
    <section className={styles.merge} aria-label="Compare and merge">
      <fieldset className={styles.mergeKeep}>
        <legend>Keep this recipe</legend>
        {[first, second].map((detail) => (
          <label key={detail.recipe.id} className={styles.mergeSide}>
            <input
              type="radio"
              name={`keep-${firstId}-${secondId}`}
              checked={keepId === detail.recipe.id}
              onChange={() => chooseKeeper(detail.recipe.id)}
            />
            <span>
              <strong>{detail.recipe.title || "Untitled"}</strong>
              <span className={styles.hint}>{summary(detail)}</span>
            </span>
          </label>
        ))}
        <p className={styles.hint}>
          The other one goes to Trash, where you can put it back for 30 days.
        </p>
      </fieldset>

      {different.length === 0 ? (
        <p>These two say the same thing in every part. Merging just removes the extra copy.</p>
      ) : (
        <>
          <p>Where they differ, choose which to use:</p>
          {different.map((id) => {
            const row = MERGE_ROWS.find((r) => r.id === id);
            if (!row) return null;
            return (
              <fieldset key={id} className={styles.mergeRow}>
                <legend>{row.label}</legend>
                <div className={styles.mergeSides}>
                  {(
                    [
                      ["keeper", "Kept recipe", keeper],
                      ["other", "Other recipe", other],
                    ] as const
                  ).map(([side, name, detail]) => (
                    <label
                      key={side}
                      className={`${styles.mergeSide} ${choices[id] === side ? styles.mergeSideOn : ""}`}
                    >
                      <input
                        type="radio"
                        name={`row-${id}-${firstId}-${secondId}`}
                        checked={choices[id] === side}
                        onChange={() => setPicked({ ...picked, [id]: side })}
                      />
                      <span>
                        <span className={styles.hint}>
                          Use the {name.toLowerCase()}&rsquo;s {row.label.toLowerCase()}
                        </span>
                        <Lines lines={rowLines(detail.recipe, id)} />
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </>
      )}
      {same.length > 0 && different.length > 0 ? (
        <p className={styles.hint}>
          The same in both: {same.map((row) => row.label.toLowerCase()).join(", ")}.
        </p>
      ) : null}

      <div className={styles.mergeSummary}>
        <h3>What will happen</h3>
        <ul>
          {plan.willDo.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {plan.cannot.length > 0 ? (
          <>
            <h3>What can&rsquo;t be carried across</h3>
            <ul>
              {plan.cannot.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}
        {tooLong ? (
          <p className={styles.error} role="alert">
            Together the chosen parts are too long for one recipe. Use fewer of the other
            recipe&rsquo;s parts.
          </p>
        ) : null}
        {failed ? (
          <p className={styles.error} role="alert">
            That couldn&rsquo;t be saved just now. Nothing was removed. Please try again.
          </p>
        ) : null}
      </div>

      <div className={styles.mergeButtons}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || tooLong || !canEdit(status)}
          onClick={() => void merge(Date.now())}
        >
          {busy ? "Merging…" : "Merge"}
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}
