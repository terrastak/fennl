import { useState } from "react";
import type { SyncChange } from "../../shared/sync";
import { BulkFile } from "../categories/BulkFile";
import { underPath } from "../categories/tree";
import { UndoBar } from "../categories/UndoBar";
import { useUndoable } from "../categories/useUndoable";
import { navigate, queryParam } from "../navigation";
import { minutesText } from "../recipes/format";
import styles from "../recipes/recipes.module.css";
import { SAMPLE_COUNT, sampleRecipeChanges } from "../recipes/samples";
import { Link } from "../router";
import type { RecipeSummary } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, useCategoryTree, useRecipeList, useSyncStatus } from "../sync/useSync";
import { greetingFor } from "./greeting";
import { PageHeader } from "./PageHeader";

// The recipe list (phase C5): cards from this browser's copy, sorting, the empty state from
// docs/design/design-direction.md, and sample recipes to try. "Add recipe" opens the editor
// (phase C6) on a new recipe. Phase C7 adds the category filter (kept in the address as
// ?category=) and Select, for filing many recipes at once.

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

function RecipeCard({
  recipe,
  selecting,
  selected,
  onSelect,
}: {
  recipe: RecipeSummary;
  selecting: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const meta = [
    recipe.categories.join(", "),
    recipe.totalMinutes !== null ? minutesText(recipe.totalMinutes) : "",
  ].filter(Boolean);
  const titleId = `card-title-${recipe.id}`;
  const body = (
    <>
      <span className={styles.cover} aria-hidden="true">
        {recipe.title.trim().charAt(0).toUpperCase()}
      </span>
      <span className={styles.cardBody}>
        <span id={titleId} className={styles.cardTitle}>
          {recipe.title}
        </span>
        {recipe.addedBy ? <span className={styles.cardBy}>{recipe.addedBy}</span> : null}
        {meta.length > 0 ? <span className={styles.cardMeta}>{meta.join(" · ")}</span> : null}
        {recipe.waiting ? <span className={styles.cardMeta}>Not synced yet</span> : null}
      </span>
    </>
  );
  // Choosing recipes to file (phase C7): the card becomes a checkbox.
  if (selecting) {
    return (
      <li>
        <label className={`${styles.card} ${selected ? styles.cardSelected : ""}`}>
          <input
            type="checkbox"
            className={styles.cardCheck}
            checked={selected}
            aria-labelledby={titleId}
            onChange={(e) => onSelect(e.target.checked)}
          />
          {body}
        </label>
      </li>
    );
  }
  return (
    <li>
      <Link href={`/recipes/${recipe.id}`} className={styles.card}>
        {body}
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

/** The category filter: everything, a category (and what's inside it), or nothing filed. */
const UNFILED = "__unfiled";

function filterFromAddress(): string {
  const category = queryParam("category");
  return category ? category.toLocaleLowerCase() : "";
}

function matches(recipe: RecipeSummary, filter: string): boolean {
  if (!filter) return true;
  if (filter === UNFILED) return recipe.categories.length === 0;
  return recipe.categories.some((path) => underPath(path, filter));
}

export function RecipesPage() {
  const status = useSyncStatus();
  const recipes = useRecipeList();
  const tree = useCategoryTree();
  const editable = canEdit(status);
  const add = () => navigate(`/recipes/${crypto.randomUUID()}/edit?new`);
  const [sortBy, setSortBy] = useState<SortBy>(savedSort);
  const [filter, setFilter] = useState(filterFromAddress);
  const [addingSamples, setAddingSamples] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const { done, failed, run, undo } = useUndoable();

  const chooseSort = (value: SortBy) => {
    setSortBy(value);
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {
      // Not kept; the choice lasts while the page is open.
    }
  };

  const chooseFilter = (value: string) => {
    setFilter(value);
    // In the address too, so it can be shared, bookmarked, and kept on reload.
    const path = tree?.byKey.get(value)?.path;
    const url = path ? `/?category=${encodeURIComponent(path)}` : "/";
    window.history.replaceState(null, "", url);
  };

  const addSamples = async () => {
    setAddingSamples(true);
    for (const change of sampleRecipeChanges()) {
      if (!(await save(change))) break;
    }
    setAddingSamples(false);
  };

  const list = recipes ?? [];
  const shown = sorted(
    list.filter((recipe) => matches(recipe, filter)),
    sortBy,
  );
  const chosen = shown.filter((recipe) => selected.has(recipe.id)).map((recipe) => recipe.id);
  const select = (id: string, on: boolean) =>
    setSelected((before) => {
      const next = new Set(before);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const filterName =
    filter === UNFILED ? "not in a category" : (tree?.byKey.get(filter)?.path ?? filter);
  const hasCategories = (tree?.nodes.length ?? 0) > 0;

  return (
    <>
      <PageHeader title="Your recipes" note={greetingFor(new Date())} />
      {list.length > 0 ? (
        <div className={styles.toolbar}>
          <div className={styles.toolbarStart}>
            <button type="button" className={styles.primary} onClick={add} disabled={!editable}>
              Add recipe
            </button>
            <button
              type="button"
              className={styles.secondary}
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            >
              {selecting ? "Done selecting" : "Select"}
            </button>
          </div>
          <div className={styles.toolbarEnd}>
            {hasCategories || filter ? (
              <label className={styles.sort}>
                Category
                <select
                  className={styles.select}
                  value={filter}
                  onChange={(e) => chooseFilter(e.target.value)}
                >
                  <option value="">All recipes</option>
                  {tree?.nodes.map((node) => (
                    <option key={node.key} value={node.key}>
                      {node.path} ({node.count})
                    </option>
                  ))}
                  {filter && filter !== UNFILED && !tree?.byKey.has(filter) ? (
                    <option value={filter}>{filterName}</option>
                  ) : null}
                  <option value={UNFILED}>Not in a category</option>
                </select>
              </label>
            ) : null}
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
            <Link href="/categories" className={styles.toolbarLink}>
              Categories
            </Link>
          </div>
        </div>
      ) : null}

      {selecting && tree ? (
        <section className={styles.bulk} aria-label="Selected recipes">
          <div className={styles.bulkHead}>
            <p aria-live="polite">
              {chosen.length} of {shown.length} selected
            </p>
            <button
              type="button"
              className={styles.textButton}
              onClick={() =>
                setSelected(
                  chosen.length === shown.length ? new Set() : new Set(shown.map((r) => r.id)),
                )
              }
            >
              {chosen.length === shown.length && shown.length > 0
                ? "Select none"
                : "Select all shown"}
            </button>
          </div>
          <BulkFile tree={tree} selected={chosen} editable={editable} run={run} />
        </section>
      ) : null}
      <UndoBar done={done} failed={failed} onUndo={() => void undo()} disabled={!editable} />

      {recipes === null ? null : list.length > 0 ? (
        <section aria-labelledby="list-title">
          <h2 id="list-title" className="visually-hidden">
            {shown.length} {shown.length === 1 ? "recipe" : "recipes"}
          </h2>
          {filter ? (
            <p className={styles.filterNote}>
              {shown.length === 0
                ? filter === UNFILED
                  ? "Every recipe is in a category."
                  : `No recipes in ${filterName}.`
                : `Showing ${shown.length} of ${list.length}: ${filterName}.`}{" "}
              <button type="button" className={styles.textButton} onClick={() => chooseFilter("")}>
                Show all recipes
              </button>
            </p>
          ) : null}
          <ul className={styles.grid}>
            {shown.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                selecting={selecting}
                selected={selected.has(recipe.id)}
                onSelect={(on) => select(recipe.id, on)}
              />
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState
          disabled={!editable}
          onAdd={add}
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
