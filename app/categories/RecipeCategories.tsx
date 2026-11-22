import { activeSyncClient, useCategorySuggestions, useCategoryTree } from "../sync/useSync";
import { CategoryCombobox } from "./CategoryCombobox";
import { CategoryFlyout } from "./CategoryFlyout";
import styles from "./categories.module.css";
import { CATEGORY_SEPARATOR } from "../../shared/recipe";
import { fileRecipes, pathKey, unfileRecipes, type CategoryNode, type PlanContext } from "./tree";
import { UndoBar } from "./UndoBar";
import { DoneBar } from "../ui/DoneBar";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import { useUndoable } from "./useUndoable";

// A recipe's categories in the editor (phase C7): its categories as chips to remove, and a box
// to find or add one. Each change saves straight away, except in the recipe editor since U27
// part 3, where they go into the draft (`draft`): ticks, chips and suggestions change its paths,
// a new name only adds a path (the category is made at Done), and the bar's Undo takes them back.

/** The recipe editor's draft categories (U27 part 3). */
export interface DraftCategories {
  /** The recipe's categories in the draft, as paths of names. */
  paths: string[][];
  onChange: (paths: string[][]) => void;
}

/** A path's chip: its names, or the category's own when it exists ("Fish & Seafood"). */
interface Chip {
  key: string;
  path: string;
  names: string[];
  node: CategoryNode | null;
}

function planContext(): PlanContext {
  return { me: activeSyncClient()?.userId ?? "", now: Date.now() };
}

export function RecipeCategories({
  recipeId,
  disabled,
  inEditor = false,
  compact = false,
  draft,
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
  /** In the recipe editor since U27 part 3: changes go into the draft, not straight away. */
  draft?: DraftCategories;
}) {
  const tree = useCategoryTree();
  const { done, failed, run, undo } = useUndoable();
  const suggested = useCategorySuggestions(recipeId);
  if (!tree) return null;

  const saved = Boolean(draft) || recipeId in tree.recipeOwners;
  const chips: Chip[] = draft
    ? [...new Map(draft.paths.map((names) => [pathKey(names), names])).entries()].map(
        ([key, names]) => {
          const node = tree.byKey.get(key) ?? null;
          return { key, path: node?.path ?? names.join(CATEGORY_SEPARATOR), names, node };
        },
      )
    : [
        ...new Set(
          tree.links
            .filter((link) => link.recipeId === recipeId)
            .map((link) => tree.byId.get(link.categoryId))
            .filter((node): node is CategoryNode => Boolean(node)),
        ),
      ].map((node) => ({ key: node.key, path: node.path, names: node.names, node }));
  chips.sort((a, b) => a.path.localeCompare(b.path));

  /** Into a category (by its names), or out of one (by its key): the draft's or straight away. */
  const add = (names: string[], path: string) => {
    if (draft) {
      if (!draft.paths.some((p) => pathKey(p) === pathKey(names))) {
        draft.onChange([...draft.paths, names]);
      }
      return;
    }
    void run(fileRecipes(tree, [recipeId], names, planContext()), `Added to ${path}.`);
  };
  const remove = (chip: Chip) => {
    if (draft) {
      draft.onChange(draft.paths.filter((p) => pathKey(p) !== chip.key));
      return;
    }
    if (chip.node) {
      void run(
        unfileRecipes(tree, [recipeId], chip.node, planContext()),
        `Taken out of ${chip.path}.`,
      );
    }
  };

  // Suggestions are the person's own categories (phase C13c); one gone since is skipped.
  const taken = new Set(chips.map((chip) => chip.key));
  const suggestions: CategoryNode[] = [];
  for (const path of suggested) {
    const node = tree.byKey.get(path.toLocaleLowerCase());
    if (node && !taken.has(node.key)) suggestions.push(node);
  }

  const chipList =
    chips.length > 0 ? (
      <ul className={styles.chips} aria-label="This recipe's categories">
        {chips.map((chip) => (
          <li key={chip.key} className={styles.chip}>
            {chip.path}
            <button
              type="button"
              className={styles.chipRemove}
              disabled={disabled}
              onClick={() => remove(chip)}
            >
              <span aria-hidden="true" className={styles.times}>
                ×
              </span>
              {inEditor ? <LaptopIcon path={LAPTOP_ICONS.x} /> : null}
              <span className="visually-hidden">Take out of {chip.path}</span>
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
                onTick={(node, on) => {
                  if (on) add(node.names, node.path);
                  else remove({ key: node.key, path: node.path, names: node.names, node });
                }}
                onCreate={(names) => add(names, names.join(CATEGORY_SEPARATOR))}
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
                    onClick={() => add(node.names, node.path)}
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
            exclude={chips.map((chip) => chip.key)}
            disabled={disabled || !saved}
            onChoose={(names) => add(names, names.join(CATEGORY_SEPARATOR))}
          />
        )}
        {!saved ? <p className={styles.hint}>Give the recipe a title first.</p> : null}
        {draft ? null : inEditor ? (
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
