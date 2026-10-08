import { useState } from "react";
import recipeStyles from "../recipes/recipes.module.css";
import { activeSyncClient } from "../sync/useSync";
import { CategoryCombobox } from "./CategoryCombobox";
import styles from "./categories.module.css";
import {
  fileRecipes,
  pathKey,
  unfileRecipes,
  type CategoryTree,
  type Plan,
  type PlanContext,
} from "./tree";

// Filing many recipes at once (phase C7): with recipes selected in the list, add them to a
// category or take them out of one. Each shows what it will do, with a count, before it does it;
// the list page's undo bar can take it back.

const recipesText = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

function planContext(): PlanContext {
  return { me: activeSyncClient()?.userId ?? "", now: Date.now() };
}

type Step = { kind: "add"; names: string[] | null } | { kind: "remove"; key: string } | null;

export function BulkFile({
  tree,
  selected,
  editable,
  run,
}: {
  tree: CategoryTree;
  /** The recipes chosen (only those shown). */
  selected: string[];
  editable: boolean;
  run: (plan: Plan, message: string) => Promise<boolean>;
}) {
  const [step, setStep] = useState<Step>(null);
  const chosen = new Set(selected);
  // Categories the chosen recipes are filed under, with how many of them each has.
  const filedUnder = tree.nodes
    .map((node) => ({ node, n: [...node.recipeIds].filter((id) => chosen.has(id)).length }))
    .filter(({ n }) => n > 0);
  const cancel = () => setStep(null);

  if (step?.kind === "add" && step.names) {
    const names = step.names;
    const path = names.join(" › ");
    const target = tree.byKey.get(pathKey(names));
    const already = selected.filter((id) => target?.recipeIds.has(id)).length;
    const adding = selected.length - already;
    const confirm = async () => {
      const plan = fileRecipes(tree, selected, names, planContext());
      if (await run(plan, `Added ${recipesText(plan.added.length)} to ${path}.`)) cancel();
    };
    return (
      <div className={styles.bulkStep} role="group" aria-label={`Add to ${path}`}>
        <p>
          {adding > 0
            ? `Add ${recipesText(adding)} to ${path}${target ? "" : " (a new category)"}?`
            : `All of them are already in ${path}.`}
          {adding > 0 && already > 0 ? ` ${already} already there will stay as they are.` : ""}
        </p>
        <div className={styles.bulkButtons}>
          {adding > 0 ? (
            <button
              type="button"
              className={recipeStyles.primary}
              disabled={!editable}
              autoFocus
              onClick={() => void confirm()}
            >
              Add {recipesText(adding)}
            </button>
          ) : null}
          <button
            type="button"
            className={recipeStyles.secondary}
            autoFocus={adding === 0}
            onClick={cancel}
          >
            {adding > 0 ? "Cancel" : "Back"}
          </button>
        </div>
      </div>
    );
  }

  if (step?.kind === "add") {
    return (
      <div className={styles.bulkStep}>
        <CategoryCombobox
          tree={tree}
          label={`Add ${recipesText(selected.length)} to`}
          disabled={!editable}
          onChoose={(names) => setStep({ kind: "add", names })}
        />
        <div className={styles.bulkButtons}>
          <button type="button" className={recipeStyles.secondary} onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step?.kind === "remove") {
    const found = filedUnder.find(({ node }) => node.key === step.key) ?? filedUnder[0];
    if (!found) return null;
    const { node, n } = found;
    const confirm = async () => {
      const plan = unfileRecipes(tree, selected, node, planContext());
      if (await run(plan, `Took ${recipesText(plan.removed.length)} out of ${node.path}.`)) {
        cancel();
      }
    };
    return (
      <div className={styles.bulkStep}>
        <label className={recipeStyles.sort}>
          Take the selected recipes out of
          <select
            className={recipeStyles.select}
            value={node.key}
            autoFocus
            onChange={(e) => setStep({ kind: "remove", key: e.target.value })}
          >
            {filedUnder.map(({ node: option, n: count }) => (
              <option key={option.key} value={option.key}>
                {option.path} ({count})
              </option>
            ))}
          </select>
        </label>
        <p aria-live="polite">
          {n === selected.length
            ? `This takes ${n === 1 ? "it" : `all ${n}`} out of ${node.path}.`
            : `This takes ${n} of the ${selected.length} selected out of ${node.path}.`}{" "}
          The recipes themselves stay.
        </p>
        <div className={styles.bulkButtons}>
          <button
            type="button"
            className={recipeStyles.primary}
            disabled={!editable}
            onClick={() => void confirm()}
          >
            Take {recipesText(n)} out
          </button>
          <button type="button" className={recipeStyles.secondary} onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.bulkButtons}>
      <button
        type="button"
        className={recipeStyles.secondary}
        disabled={!editable || selected.length === 0}
        onClick={() => setStep({ kind: "add", names: null })}
      >
        Add to a category
      </button>
      <button
        type="button"
        className={recipeStyles.secondary}
        disabled={!editable || filedUnder.length === 0}
        onClick={() => setStep({ kind: "remove", key: filedUnder[0]?.node.key ?? "" })}
      >
        Take out of a category
      </button>
    </div>
  );
}
