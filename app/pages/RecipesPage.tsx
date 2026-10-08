import { useState } from "react";
import type { SyncChange } from "../../shared/sync";
import { BulkFile } from "../categories/BulkFile";
import { underPath } from "../categories/tree";
import { UndoBar } from "../categories/UndoBar";
import { useUndoable } from "../categories/useUndoable";
import { navigate, queryParam } from "../navigation";
import { minutesText } from "../recipes/format";
import { Highlight } from "../recipes/Highlight";
import styles from "../recipes/recipes.module.css";
import { SAMPLE_COUNT, sampleRecipeChanges } from "../recipes/samples";
import { Link } from "../router";
import type { RecipeSummary } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import type { SearchHit } from "../sync/search";
import {
  activeSyncClient,
  useCategoryTree,
  useRecipeList,
  useSearch,
  useSyncStatus,
} from "../sync/useSync";
import { greetingFor } from "./greeting";
import { PageHeader } from "./PageHeader";

// The recipe list (phase C5): cards from this browser's copy, sorting, the empty state from
// docs/design/design-direction.md, and sample recipes to try. "Add recipe" opens the editor
// (phase C6) on a new recipe. Phase C7 adds the category filter and Select, for filing many
// recipes at once. Phase C8 adds search (app/sync/search.ts) and the rating filter. The search
// and filters are kept in the address (?q=, ?category=, ?rating=).

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
  terms,
  hit,
}: {
  recipe: RecipeSummary;
  selecting: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  /** What's being searched for, to mark in the card (phase C8). */
  terms: string[];
  /** Where the search found it, when not in the title. */
  hit: SearchHit | undefined;
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
          <Highlight text={recipe.title} terms={terms} />
        </span>
        {hit ? (
          <span className={styles.cardHit}>
            <span className={styles.cardHitField}>{hit.field}:</span>{" "}
            <Highlight text={hit.text} terms={terms} />
          </span>
        ) : null}
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

type RatingFilter = "" | "favorite" | "5" | "4" | "3" | "none";

const RATINGS: { value: RatingFilter; label: string }[] = [
  { value: "", label: "Any rating" },
  { value: "favorite", label: "My favorites" },
  { value: "5", label: "5 stars" },
  { value: "4", label: "4 stars and up" },
  { value: "3", label: "3 stars and up" },
  { value: "none", label: "Not rated yet" },
];

/** Your own rating and favorite (CLAUDE.md: opinions are per person). */
function rated(recipe: RecipeSummary, rating: RatingFilter): boolean {
  if (!rating) return true;
  if (rating === "favorite") return recipe.favorite;
  if (rating === "none") return recipe.myRating === null;
  return (recipe.myRating ?? 0) >= Number(rating);
}

function ratingFromAddress(): RatingFilter {
  const value = queryParam("rating");
  return RATINGS.some((r) => r.value === value) ? (value as RatingFilter) : "";
}

/** Recipes shown at a time; more on request, so a big recipe box stays quick. */
const PAGE = 100;

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
  const [rating, setRating] = useState<RatingFilter>(ratingFromAddress);
  const [query, setQuery] = useState(() => queryParam("q") ?? "");
  const [limit, setLimit] = useState(PAGE);
  const search = useSearch(query);
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

  /** Search and filters go in the address too, so they survive a reload and can be shared. */
  const remember = (next: { q?: string; category?: string; rating?: RatingFilter }) => {
    const params = new URLSearchParams();
    const q = next.q ?? query;
    const path = tree?.byKey.get(next.category ?? filter)?.path;
    const r = next.rating ?? rating;
    if (q.trim()) params.set("q", q);
    if (path) params.set("category", path);
    if (r) params.set("rating", r);
    const search = params.toString();
    window.history.replaceState(null, "", search ? `/?${search}` : "/");
    setLimit(PAGE);
  };

  const chooseFilter = (value: string) => {
    setFilter(value);
    remember({ category: value });
  };

  const chooseRating = (value: RatingFilter) => {
    setRating(value);
    remember({ rating: value });
  };

  const typeQuery = (value: string) => {
    setQuery(value);
    remember({ q: value });
  };

  const clearAll = () => {
    setQuery("");
    setFilter("");
    setRating("");
    window.history.replaceState(null, "", "/");
    setLimit(PAGE);
  };

  const addSamples = async () => {
    setAddingSamples(true);
    for (const change of sampleRecipeChanges()) {
      if (!(await save(change))) break;
    }
    setAddingSamples(false);
  };

  const list = recipes ?? [];
  const searching = query.trim() !== "";
  const narrowed = list.filter((recipe) => matches(recipe, filter) && rated(recipe, rating));
  let shown: RecipeSummary[];
  if (!searching) shown = sorted(narrowed, sortBy);
  else if (!search) shown = [];
  else {
    // Recipes with every word in the title first, then the rest; each in the chosen order.
    const found = new Set(search.ids);
    const inTitle = new Set(search.titleIds);
    const hits = narrowed.filter((recipe) => found.has(recipe.id));
    shown = [
      ...sorted(
        hits.filter((recipe) => inTitle.has(recipe.id)),
        sortBy,
      ),
      ...sorted(
        hits.filter((recipe) => !inTitle.has(recipe.id)),
        sortBy,
      ),
    ];
  }
  const narrowing = searching || filter !== "" || rating !== "";
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
        <form role="search" className={styles.search} onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="recipe-search" className={styles.searchLabel}>
            Search recipes
          </label>
          <input
            id="recipe-search"
            type="search"
            className={styles.searchInput}
            value={query}
            placeholder="A title, an ingredient, a word in the notes…"
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => typeQuery(e.target.value)}
          />
        </form>
      ) : null}
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
            <label className={styles.sort}>
              Rating
              <select
                className={styles.select}
                value={rating}
                onChange={(e) => chooseRating(e.target.value as RatingFilter)}
              >
                {RATINGS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
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
          <p className={styles.filterNote}>
            <span aria-live="polite">
              {!narrowing
                ? ""
                : searching && !search
                  ? "Searching…"
                  : shown.length === 0
                    ? filter === UNFILED && !searching && !rating
                      ? "Every recipe is in a category."
                      : "No recipes found."
                    : `Showing ${shown.length} of ${list.length}${
                        search && search.titleIds.length > 0 && shown.length > 1
                          ? "; titles with every word come first"
                          : ""
                      }.`}
            </span>{" "}
            {narrowing ? (
              <button type="button" className={styles.textButton} onClick={clearAll}>
                Show all recipes
              </button>
            ) : null}
          </p>
          <ul className={styles.grid}>
            {shown.slice(0, limit).map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                selecting={selecting}
                selected={selected.has(recipe.id)}
                onSelect={(on) => select(recipe.id, on)}
                terms={searching ? (search?.terms ?? []) : []}
                hit={searching ? search?.hits[recipe.id] : undefined}
              />
            ))}
          </ul>
          {shown.length > limit ? (
            <div className={styles.more}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setLimit(limit + PAGE)}
              >
                Show {Math.min(PAGE, shown.length - limit)} more
              </button>
              <span className={styles.hint}>{shown.length - limit} more to see</span>
            </div>
          ) : null}
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
