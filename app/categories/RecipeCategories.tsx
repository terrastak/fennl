import { activeSyncClient, useCategorySuggestions, useCategoryTree } from "../sync/useSync";
import { CategoryCombobox } from "./CategoryCombobox";
import { CategoryFlyout } from "./CategoryFlyout";
import styles from "./categories.module.css";
import { fileRecipes, unfileRecipes, type CategoryNode, type PlanContext } from "./tree";
import { UndoBar } from "./UndoBar";
import { DoneBar } from "../ui/DoneBar";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import { useUndoable } from "./useUndoable";

// A recipe's categories in the editor (phase C7): its categories as chips to remove, and a box
// to find or add one. Each change saves straight away.

function planContext(): PlanContext {
  return { me: activeSyncClient()?.userId ?? "", now: Date.now() };
}

export function RecipeCategories({
  recipeId,
  disabled,
  inEditor = false,
  compact = false,
}: {
  recipeId: string;
  disabled: boolean;
  /**
   * In the recipe editor, which on a laptop (U23) draws them as a white box under the heading,
   * the suggestions as soft chips with a + beside the box, and "Added to …" in the shared done
   * bar. Phones look as before either way.
   */
  inEditor?: boolean;
  /**
   * The recipe editor on a laptop since U27: no white frame, in the editor's wide column beside
   * where it's from; "+ Add a category" after the chips opens the flyout (CategoryFlyout.tsx) in
   * place of the box to type in, and the suggestions stay under the chips.
   */
  compact?: boolean;
}) {
  const tree = useCategoryTree();
  const { done, failed, run, undo } = useUndoable();
  const suggested = useCategorySuggestions(recipeId);
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

  // Suggestions are the person's own categories (phase C13c); one gone since is skipped.
  const taken = new Set(mine.map((node) => node.key));
  const suggestions: CategoryNode[] = [];
  for (const path of suggested) {
    const node = tree.byKey.get(path.toLocaleLowerCase());
    if (node && !taken.has(node.key)) suggestions.push(node);
  }

  const chipList =
    mine.length > 0 ? (
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
              <span aria-hidden="true" className={styles.times}>
                ×
              </span>
              {inEditor ? <LaptopIcon path={LAPTOP_ICONS.x} /> : null}
              <span className="visually-hidden">Take out of {node.path}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <section
      className={`${styles.recipeCategories} ${inEditor ? styles.inEditor : ""} ${
        compact ? styles.compact : ""
      }`}
      aria-labelledby="recipe-categories-title"
    >
      <h2 id="recipe-categories-title" className={styles.sectionTitle}>
        Categories
      </h2>
      <div className={styles.editorBox}>
        {compact ? (
          <div className={styles.chipRow}>
            {chipList}
            {saved ? (
              <CategoryFlyout
                tree={tree}
                ticked={taken}
                suggestions={suggestions}
                disabled={disabled}
                onTick={(node, on) =>
                  void (on
                    ? run(
                        fileRecipes(tree, [recipeId], node.names, planContext()),
                        `Added to ${node.path}.`,
                      )
                    : run(
                        unfileRecipes(tree, [recipeId], node, planContext()),
                        `Taken out of ${node.path}.`,
                      ))
                }
                onCreate={(names) =>
                  void run(
                    fileRecipes(tree, [recipeId], names, planContext()),
                    `Added to ${names.join(" › ")}.`,
                  )
                }
              />
            ) : null}
          </div>
        ) : (
          chipList
        )}
        {saved && !disabled && suggestions.length > 0 ? (
          <div className={styles.suggestions}>
            <p id="suggested-title" className={styles.hint}>
              {compact
                ? "Suggested from similar recipes:"
                : "Suggested, from recipes with similar ingredients:"}
            </p>
            <ul className={styles.chips} aria-labelledby="suggested-title">
              {suggestions.map((node) => (
                <li key={node.key}>
                  <button
                    type="button"
                    className={styles.suggestion}
                    onClick={() =>
                      void run(
                        fileRecipes(tree, [recipeId], node.names, planContext()),
                        `Added to ${node.path}.`,
                      )
                    }
                  >
                    <span aria-hidden="true" className={styles.plusWord}>
                      +{" "}
                    </span>
                    {inEditor ? <LaptopIcon path={LAPTOP_ICONS.plus} /> : null}
                    {node.path}
                    <span className="visually-hidden">: add this category</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {compact ? null : (
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
        )}
        {!saved ? <p className={styles.hint}>Give the recipe a title first.</p> : null}
        {inEditor ? (
          <DoneBar
            message={
              failed ? "That couldn’t be saved just now. Please try again." : (done?.message ?? "")
            }
            problem={failed}
            onUndo={done && done.undo.length > 0 && !failed ? () => void undo() : null}
            undoDisabled={disabled}
            className={styles.undoBar}
            undoClassName={styles.undoButton}
          />
        ) : (
          <UndoBar done={done} failed={failed} onUndo={() => void undo()} disabled={disabled} />
        )}
      </div>
    </section>
  );
}
