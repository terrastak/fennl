import { activeSyncClient, useCategoryTree } from "../sync/useSync";
import { CategoryCombobox } from "./CategoryCombobox";
import styles from "./categories.module.css";
import { fileRecipes, unfileRecipes, type CategoryNode, type PlanContext } from "./tree";
import { UndoBar } from "./UndoBar";
import { useUndoable } from "./useUndoable";

// A recipe's categories in the editor (phase C7): its categories as chips to remove, and a box
// to find or add one. Each change saves straight away.

function planContext(): PlanContext {
  return { me: activeSyncClient()?.userId ?? "", now: Date.now() };
}

export function RecipeCategories({ recipeId, disabled }: { recipeId: string; disabled: boolean }) {
  const tree = useCategoryTree();
  const { done, failed, run, undo } = useUndoable();
  if (!tree) return null;

  const saved = recipeId in tree.recipeOwners;
  const mine = [
    ...new Set(
      tree.links
        .filter((link) => link.recipeId === recipeId)
        .map((link) => tree.byId.get(link.categoryId))
        .filter((node): node is CategoryNode => Boolean(node)),
    ),
  ].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <section className={styles.recipeCategories} aria-labelledby="recipe-categories-title">
      <h2 id="recipe-categories-title" className={styles.sectionTitle}>
        Categories
      </h2>
      {mine.length > 0 ? (
        <ul className={styles.chips} aria-label="This recipe's categories">
          {mine.map((node) => (
            <li key={node.key} className={styles.chip}>
              {node.path}
              <button
                type="button"
                className={styles.chipRemove}
                disabled={disabled}
                onClick={() =>
                  void run(
                    unfileRecipes(tree, [recipeId], node, planContext()),
                    `Taken out of ${node.path}.`,
                  )
                }
              >
                <span aria-hidden="true">×</span>
                <span className="visually-hidden">Take out of {node.path}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <CategoryCombobox
        tree={tree}
        label="Add a category"
        exclude={mine.map((node) => node.key)}
        disabled={disabled || !saved}
        onChoose={(names) =>
          void run(
            fileRecipes(tree, [recipeId], names, planContext()),
            `Added to ${names.join(" › ")}.`,
          )
        }
      />
      {!saved ? <p className={styles.hint}>Give the recipe a title first.</p> : null}
      <UndoBar done={done} failed={failed} onUndo={() => void undo()} disabled={disabled} />
    </section>
  );
}
