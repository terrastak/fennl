import { useEffect, useRef, useState, type FormEvent } from "react";
import { RECIPE_RULES, emptyRecipeContent } from "../../shared/recipe";
import type { SyncChange } from "../../shared/sync";
import { minutesText } from "../recipes/format";
import styles from "../recipes/recipes.module.css";
import { SAMPLE_COUNT, sampleRecipeChanges } from "../recipes/samples";
import { Link } from "../router";
import type { RecipeSummary } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, useRecipeList, useSyncStatus } from "../sync/useSync";
import { greetingFor } from "./greeting";
import { PageHeader } from "./PageHeader";

// The recipe list (phase C5): cards from this browser's copy, sorting, the empty state from
// docs/design/design-direction.md, and sample recipes to try. "Add recipe" asks for a title for
// now; the editor (C6) takes over from there.

async function save(change: SyncChange): Promise<boolean> {
  try {
    await activeSyncClient()?.save(change);
    return true;
  } catch {
    return false;
  }
}

type SortBy = "title" | "newest" | "changed";

const SORTS: { value: SortBy; label: string }[] = [
  { value: "title", label: "Title, A to Z" },
  { value: "newest", label: "Newest first" },
  { value: "changed", label: "Recently changed" },
];

const SORT_KEY = "fennl:recipe-sort";

function savedSort(): SortBy {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return SORTS.some((s) => s.value === saved) ? (saved as SortBy) : "title";
  } catch {
    return "title";
  }
}

function sorted(recipes: RecipeSummary[], by: SortBy): RecipeSummary[] {
  if (by === "title") return recipes;
  const key = by === "newest" ? "createdAt" : "updatedAt";
  return [...recipes].sort((a, b) => b[key].localeCompare(a[key]));
}

function QuickAdd({ disabled, onClose }: { disabled: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

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
    input.current?.focus();
  };

  return (
    <form className={styles.quickAdd} onSubmit={(e) => void submit(e)}>
      <div className={styles.field}>
        <label htmlFor="new-recipe">New recipe</label>
        <input
          ref={input}
          id="new-recipe"
          className={styles.input}
          value={title}
          maxLength={RECIPE_RULES.titleLength}
          placeholder="Its title, for example Green chile stew"
          onChange={(e) => setTitle(e.target.value)}
          disabled={disabled}
        />
      </div>
      <button type="submit" className={styles.primary} disabled={disabled || !title.trim()}>
        Save recipe
      </button>
      <button type="button" className={styles.secondary} onClick={onClose}>
        Done
      </button>
      <p className={styles.hint}>Writing the whole recipe comes next; for now, just its title.</p>
      {failed ? (
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t add it just now. Please try again.
        </p>
      ) : null}
    </form>
  );
}

function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const meta = [
    recipe.categories.join(", "),
    recipe.totalMinutes !== null ? minutesText(recipe.totalMinutes) : "",
  ].filter(Boolean);
  return (
    <li>
      <Link href={`/recipes/${recipe.id}`} className={styles.card}>
        <span className={styles.cover} aria-hidden="true">
          {recipe.title.trim().charAt(0).toUpperCase()}
        </span>
        <span className={styles.cardBody}>
          <span className={styles.cardTitle}>{recipe.title}</span>
          {recipe.addedBy ? <span className={styles.cardBy}>{recipe.addedBy}</span> : null}
          {meta.length > 0 ? <span className={styles.cardMeta}>{meta.join(" · ")}</span> : null}
          {recipe.waiting ? <span className={styles.cardMeta}>Not synced yet</span> : null}
        </span>
      </Link>
    </li>
  );
}

function EmptyState({
  disabled,
  onAdd,
  onSamples,
  addingSamples,
}: {
  disabled: boolean;
  onAdd: () => void;
  onSamples: () => void;
  addingSamples: boolean;
}) {
  return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <div className={styles.ghosts} aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={styles.ghost} />
        ))}
      </div>
      <div className={styles.emptyText}>
        <h2 id="empty-title">Your recipe box is empty, for now</h2>
        <p>Write down a family favorite, or bring in recipes you already have.</p>
        <div className={styles.buttons}>
          <button type="button" className={styles.primary} onClick={onAdd} disabled={disabled}>
            Add recipe
          </button>
          <Link href="/import" className={styles.secondary}>
            Import
          </Link>
        </div>
        <button
          type="button"
          className={styles.textButton}
          onClick={onSamples}
          disabled={disabled || addingSamples}
        >
          {addingSamples
            ? "Adding sample recipes…"
            : `Or add ${SAMPLE_COUNT} sample recipes to try`}
        </button>
      </div>
    </section>
  );
}

export function RecipesPage() {
  const status = useSyncStatus();
  const recipes = useRecipeList();
  const editable = canEdit(status);
  const [adding, setAdding] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>(savedSort);
  const [addingSamples, setAddingSamples] = useState(false);

  const chooseSort = (value: SortBy) => {
    setSortBy(value);
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {
      // Not kept; the choice lasts while the page is open.
    }
  };

  const addSamples = async () => {
    setAddingSamples(true);
    for (const change of sampleRecipeChanges()) {
      if (!(await save(change))) break;
    }
    setAddingSamples(false);
  };

  const list = recipes ?? [];
  return (
    <>
      <PageHeader title="Your recipes" note={greetingFor(new Date())} />
      {list.length > 0 || adding ? (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => setAdding(true)}
            disabled={!editable || adding}
          >
            Add recipe
          </button>
          {list.length > 1 ? (
            <label className={styles.sort}>
              Sort by
              <select
                className={styles.select}
                value={sortBy}
                onChange={(e) => chooseSort(e.target.value as SortBy)}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {adding ? <QuickAdd disabled={!editable} onClose={() => setAdding(false)} /> : null}

      {recipes === null ? null : list.length > 0 ? (
        <section aria-labelledby="list-title">
          <h2 id="list-title" className="visually-hidden">
            {list.length} {list.length === 1 ? "recipe" : "recipes"}
          </h2>
          <ul className={styles.grid}>
            {sorted(list, sortBy).map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </ul>
        </section>
      ) : adding ? null : (
        <EmptyState
          disabled={!editable}
          onAdd={() => setAdding(true)}
          onSamples={() => void addSamples()}
          addingSamples={addingSamples}
        />
      )}
      <p className={`${styles.hint} ${styles.footnote}`}>
        Your recipes are stored in your account. This browser keeps a copy for speed.
      </p>
    </>
  );
}
