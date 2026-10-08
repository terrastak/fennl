import { useState, type FormEvent } from "react";
import { RECIPE_RULES, emptyRecipeContent } from "../../shared/recipe";
import type { SyncChange } from "../../shared/sync";
import type { RecipeSummary } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, useRecipeList, useSyncStatus } from "../sync/useSync";
import { greetingFor } from "./greeting";
import { PageHeader } from "./PageHeader";
import styles from "./pages.module.css";

// The recipe list. For now (phase C4) it's a simple list for trying out syncing: add a recipe
// by its title, rename it, move it to Trash. Recipe pages and the editor come in C5 and C6.

async function save(change: SyncChange): Promise<boolean> {
  try {
    await activeSyncClient()?.save(change);
    return true;
  } catch {
    return false;
  }
}

function AddRecipe({ disabled }: { disabled: boolean }) {
  const [title, setTitle] = useState("");
  const [failed, setFailed] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    const saved = await save({
      kind: "recipe",
      id: crypto.randomUUID(),
      create: { createdAt: new Date().toISOString(), import: null },
      fields: { ...emptyRecipeContent(), title: name },
      changedAt: Date.now(),
    });
    setFailed(!saved);
    if (saved) setTitle("");
  };

  return (
    <form className={styles.codeForm} onSubmit={(e) => void submit(e)}>
      <div className={styles.field}>
        <label htmlFor="new-recipe">New recipe</label>
        <input
          id="new-recipe"
          className={styles.input}
          value={title}
          maxLength={RECIPE_RULES.titleLength}
          placeholder="Its title, for example Green chile stew"
          onChange={(e) => setTitle(e.target.value)}
          disabled={disabled}
        />
      </div>
      <button type="submit" className={styles.button} disabled={disabled || !title.trim()}>
        Add recipe
      </button>
      {failed ? (
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t add it just now. Please try again.
        </p>
      ) : null}
    </form>
  );
}

function RecipeRow({ recipe, disabled }: { recipe: RecipeSummary; disabled: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(recipe.title);
  const inputId = `rename-${recipe.id}`;

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    if (name !== recipe.title) {
      await save({ kind: "recipe", id: recipe.id, fields: { title: name }, changedAt: Date.now() });
    }
    setRenaming(false);
  };

  const trash = () =>
    void save({ kind: "recipe", id: recipe.id, fields: {}, deleted: true, changedAt: Date.now() });

  if (renaming) {
    return (
      <li className={styles.recipeRow}>
        <form className={styles.codeForm} onSubmit={(e) => void rename(e)}>
          <div className={styles.field}>
            <label htmlFor={inputId}>New title for {recipe.title}</label>
            <input
              id={inputId}
              className={styles.input}
              value={title}
              maxLength={RECIPE_RULES.titleLength}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
            />
          </div>
          <button type="submit" className={styles.button} disabled={disabled || !title.trim()}>
            Save
          </button>
          <button type="button" className={styles.button} onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className={styles.recipeRow}>
      <span className={styles.recipeTitle}>
        {recipe.title}
        {recipe.waiting ? <span className={styles.hint}> · not synced yet</span> : null}
      </span>
      <span className={styles.recipeActions}>
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          aria-label={`Rename ${recipe.title}`}
          onClick={() => {
            setTitle(recipe.title);
            setRenaming(true);
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          aria-label={`Move ${recipe.title} to Trash`}
          onClick={trash}
        >
          Move to Trash
        </button>
      </span>
    </li>
  );
}

export function RecipesPage() {
  const status = useSyncStatus();
  const recipes = useRecipeList();
  const editable = canEdit(status);

  return (
    <>
      <PageHeader title="Your recipes" note={greetingFor(new Date())} />
      {/* One card either way, with the form in the same place, so typing isn't lost when the
          list arrives from the local copy. */}
      <section className={styles.card} aria-labelledby="list-title">
        {recipes && recipes.length > 0 ? (
          <>
            <h2 id="list-title">
              {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}
            </h2>
            <ul className={styles.recipeList}>
              {recipes.map((recipe) => (
                <RecipeRow key={recipe.id} recipe={recipe} disabled={!editable} />
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2 id="list-title">Your recipe box is empty, for now</h2>
            <p>
              Soon you&rsquo;ll be able to write full recipes here, bring them in from websites,
              photograph family recipe cards and cookbook pages, and move over your Paprika library.
              For now you can add recipes by their title, to try things out.
            </p>
          </>
        )}
        <div className={styles.stacked}>
          <AddRecipe disabled={!editable} />
        </div>
      </section>
      <p className={`${styles.hint} ${styles.stacked}`}>
        Your recipes are stored in your account. This browser keeps a copy for speed.
      </p>
    </>
  );
}
