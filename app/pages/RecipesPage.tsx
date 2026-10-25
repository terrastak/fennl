import { useEffect, useId, useRef, useState } from "react";
import type { SyncChange } from "../../shared/sync";
import { BulkFile } from "../categories/BulkFile";
import { addBlockedText, NOTHING_LOST } from "../limits/limitText";
import { UsageNote } from "../limits/Usage";
import { useAddBlocked, useUsage } from "../limits/useLimits";
import { UndoBar } from "../categories/UndoBar";
import { useUndoable } from "../categories/useUndoable";
import { NAVIGATE_EVENT, navigate, queryParam, replaceAddress } from "../navigation";
import { FilterPanel } from "../recipes/FilterPanel";
import { SavedSearches } from "../recipes/SavedSearches";
import {
  activeFilterCount,
  applyFilters,
  filterChips,
  filtersFromParams,
  filtersToParams,
  ingredientWords,
  NO_FILTERS,
  pickSurprise,
  recipeMinutes,
  UNFILED,
  type RatingFilter,
  type RecipeFilters,
} from "../recipes/filters";
import categoryStyles from "../categories/categories.module.css";
import { minutesText } from "../recipes/format";
import { Highlight } from "../recipes/Highlight";
import { forgetTrashed, recentlyTrashed } from "../recipes/trashNotice";
import styles from "../recipes/recipes.module.css";
import { SAMPLE_COUNT, sampleRecipeChanges } from "../recipes/samples";
import { Link } from "../router";
import { PhotoImage } from "../photos/PhotoImage";
import { printRecipes } from "../print/booklet";
import type { RecipeSummary } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import type { SearchHit } from "../sync/search";
import {
  activeSyncClient,
  useCategoryTree,
  useIngredientMatches,
  useRecipeList,
  useSearch,
  useSyncStatus,
} from "../sync/useSync";
import { greetingFor } from "./greeting";
import { PageHeader } from "./PageHeader";

// The recipe list (phase C5): cards from this browser's copy, sorting, the empty state from
// docs/design/design-direction.md, and sample recipes to try. "Add recipe" opens the editor
// (phase C6) on a new recipe. Phase C7 adds the category filter and Select, for filing many
// recipes at once. Phase C8 adds search (app/sync/search.ts) and the rating filter. Phase C13a
// adds "More filters" (app/recipes/filters.ts). The search and filters are kept in the address
// (?q=, ?category=, ?rating=, and the others filtersToParams writes).

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
  const titleId = `card-title-${recipe.id}`;
  // The total time, or prep and cook added up when the recipe gives no total.
  const minutes = recipeMinutes(recipe);
  const body = (
    <>
      <span className={styles.cardPicture}>
        {recipe.cover ? (
          // The cover's small copy (phase D2).
          <PhotoImage
            hash={recipe.cover.hash}
            size="thumb"
            width={recipe.cover.width}
            height={recipe.cover.height}
            alt=""
            className={styles.coverPhoto}
          />
        ) : (
          // No photo: a warm card with a sprig of fennel.
          <span className={styles.cover} aria-hidden="true">
            <LogoSprig />
          </span>
        )}
        {recipe.favorite ? (
          <span className={styles.cardFavorite}>
            <HeartIcon />
            <span className="visually-hidden">A favorite</span>
          </span>
        ) : null}
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
        {minutes !== null ? (
          <span className={styles.cardMeta}>
            <ClockIcon />
            {minutesText(minutes)}
          </span>
        ) : null}
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

function LogoSprig() {
  return (
    <svg width="40" height="40" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
      <path
        d="M17 28V10M17 15l-6-7M17 15l6-7M17 20l-5-4M17 20l5-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5c-2.2 4.6-9.2 9-9.2 9z"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/**
 * "⋯" beside Add recipe (owner's choice 2026-10-25): the list's less-used tools, out of the way.
 */
function MoreMenu({ selecting, onSelect }: { selecting: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={box} className={styles.menuBox}>
      <button
        ref={button}
        type="button"
        className={styles.iconButton}
        aria-label="More options"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="5" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="19" cy="12" r="1.8" fill="currentColor" />
        </svg>
      </button>
      <ul id={id} className={styles.menu} hidden={!open}>
        <li>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              setOpen(false);
              onSelect();
            }}
          >
            {selecting ? "Done selecting" : "Select"}
          </button>
        </li>
        <li>
          <Link href="/categories" className={styles.menuItem}>
            Categories
          </Link>
        </li>
        <li>
          <Link href="/duplicates" className={styles.menuItem}>
            Find duplicates
          </Link>
        </li>
        <li>
          <Link href="/trash" className={styles.menuItem}>
            Trash
          </Link>
        </li>
      </ul>
    </div>
  );
}

/** The quick choices above the list (owner's choice 2026-10-25), each one of the filters. */
const QUICK: {
  label: string;
  on: (f: RecipeFilters) => boolean;
  toggle: (f: RecipeFilters) => RecipeFilters;
}[] = [
  {
    label: "Favorites",
    on: (f) => f.rating === "favorite",
    toggle: (f) => ({ ...f, rating: f.rating === "favorite" ? "" : "favorite" }),
  },
  {
    label: "30 minutes or less",
    on: (f) => f.maxMinutes === 30,
    toggle: (f) => ({ ...f, maxMinutes: f.maxMinutes === 30 ? null : 30 }),
  },
  {
    label: "Made recently",
    on: (f) => f.made === "recent",
    toggle: (f) => ({ ...f, made: f.made === "recent" ? "" : "recent" }),
  },
  {
    label: "Not tried yet",
    on: (f) => f.made === "never",
    toggle: (f) => ({ ...f, made: f.made === "never" ? "" : "never" }),
  },
];

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
  // Even with no recipes, text left in Trash can fill the plan (phase C11).
  const usage = useUsage();
  const blocked = useAddBlocked();
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
        {blocked && usage ? (
          <p className={styles.hint}>
            {addBlockedText(blocked, usage)} {NOTHING_LOST}
          </p>
        ) : null}
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.primary}
            onClick={onAdd}
            disabled={disabled || blocked !== null}
          >
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
          disabled={disabled || addingSamples || blocked !== null}
        >
          {addingSamples
            ? "Adding sample recipes…"
            : `Or add ${SAMPLE_COUNT} sample recipes to try`}
        </button>
      </div>
    </section>
  );
}

const RATINGS: { value: RatingFilter; label: string }[] = [
  { value: "", label: "Any rating" },
  { value: "favorite", label: "My favorites" },
  { value: "5", label: "5 stars" },
  { value: "4", label: "4 stars and up" },
  { value: "3", label: "3 stars and up" },
  { value: "none", label: "Not rated yet" },
];

/** Today as a day ("2026-10-20") in this person's own calendar, as "made it" days are. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Recipes shown at a time; more on request, so a big recipe box stays quick. */
const PAGE = 100;

/** Recipes a time or servings filter left out because they don't say (CLAUDE.md: never guess). */
function unknownNote(unknown: { time: number; servings: number }, filters: RecipeFilters): string {
  const parts: string[] = [];
  if (filters.maxMinutes !== null && unknown.time > 0) {
    parts.push(`${unknown.time} with no time written down`);
  }
  if (filters.minServings !== null && unknown.servings > 0) {
    parts.push(`${unknown.servings} with no number served`);
  }
  return parts.length > 0 ? ` Not shown: ${parts.join(" and ")}.` : "";
}

export function RecipesPage() {
  const status = useSyncStatus();
  const recipes = useRecipeList();
  const tree = useCategoryTree();
  const editable = canEdit(status);
  // Over a plan limit (phase C11), "Add recipe" says why instead of opening the editor.
  const addBlocked = useAddBlocked();
  const limitNote = useRef<HTMLParagraphElement>(null);
  const add = () =>
    addBlocked ? limitNote.current?.focus() : navigate(`/recipes/${crypto.randomUUID()}/edit?new`);
  const [sortBy, setSortBy] = useState<SortBy>(savedSort);
  const [filters, setFilters] = useState<RecipeFilters>(() =>
    filtersFromParams(new URLSearchParams(window.location.search)),
  );
  const moreCount = filterChips(filters, (key) => key).length;
  const [showMore, setShowMore] = useState(() => moreCount > 0);
  const [query, setQuery] = useState(() => queryParam("q") ?? "");
  const [limit, setLimit] = useState(PAGE);
  const search = useSearch(query);
  const ingredientAnswer = useIngredientMatches(ingredientWords(filters));
  const [addingSamples, setAddingSamples] = useState(false);
  const [surprise, setSurprise] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // A recipe just moved to Trash from its page can be put back from here (phase C9).
  const { done, failed, run, undo } = useUndoable(recentlyTrashed);
  useEffect(forgetTrashed, []);

  const chooseSort = (value: SortBy) => {
    setSortBy(value);
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {
      // Not kept; the choice lasts while the page is open.
    }
  };

  // A search sent from another screen (phase C13c), or the back button, changes the address
  // under this page: show what it says. This page's own changes don't announce themselves.
  useEffect(() => {
    const fromAddress = () => {
      setQuery(queryParam("q") ?? "");
      setFilters(filtersFromParams(new URLSearchParams(window.location.search)));
      setSurprise(null);
      setLimit(PAGE);
    };
    window.addEventListener(NAVIGATE_EVENT, fromAddress);
    window.addEventListener("popstate", fromAddress);
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, fromAddress);
      window.removeEventListener("popstate", fromAddress);
    };
  }, []);

  /** Search and filters go in the address too, so they survive a reload and can be shared. */
  const remember = (nextQuery: string, next: RecipeFilters) => {
    const params = filtersToParams(nextQuery, next, (key) => tree?.byKey.get(key)?.path);
    const search = params.toString();
    replaceAddress(search ? `/?${search}` : "/");
    setLimit(PAGE);
  };

  const changeFilters = (next: RecipeFilters) => {
    setFilters(next);
    remember(query, next);
  };

  /** Shows a saved search: its words and its filters. */
  const applySearch = (q: string, next: RecipeFilters) => {
    setQuery(q);
    setFilters(next);
    remember(q, next);
    if (filterChips(next, (key) => key).length > 0) setShowMore(true);
  };

  const typeQuery = (value: string) => {
    setQuery(value);
    remember(value, filters);
  };

  const clearAll = () => {
    setQuery("");
    setFilters(NO_FILTERS);
    replaceAddress("/");
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
  const found = applyFilters(list, filters, ingredientAnswer, today());
  const narrowed = found.recipes;
  let shown: RecipeSummary[];
  if (!searching) shown = sorted(narrowed, sortBy);
  else if (!search) shown = [];
  else {
    // Recipes with every word in the title first, then the rest; each in the chosen order.
    const inSearch = new Set(search.ids);
    const inTitle = new Set(search.titleIds);
    const hits = narrowed.filter((recipe) => inSearch.has(recipe.id));
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
  const filtering = activeFilterCount(filters);
  const narrowing = searching || filtering > 0;
  // "Surprise me" (phase C13c): a recipe from what the list shows; gone if the list moves on.
  const surpriseRecipe = shown.find((recipe) => recipe.id === surprise) ?? null;
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
    filters.category === UNFILED
      ? "not in a category"
      : (tree?.byKey.get(filters.category)?.path ?? filters.category);
  const nameOf = (key: string) => tree?.byKey.get(key)?.path ?? key;
  const chips = filterChips(filters, nameOf);
  // Printing several at once (phase F6), coming back to the list as it was.
  const print = (ids: string[]) => printRecipes(ids, `/${window.location.search}`);

  // Each filter that's on, as a chip to take it off; the quick choices above show their own.
  const removable: { id: string; label: string; remove: () => void }[] = [
    ...(searching ? [{ id: "q", label: `“${query.trim()}”`, remove: () => typeQuery("") }] : []),
    ...(filters.category
      ? [
          {
            id: "category",
            label: filters.category === UNFILED ? "Not in a category" : `In ${filterName}`,
            remove: () => changeFilters({ ...filters, category: "" }),
          },
        ]
      : []),
    ...(filters.rating && filters.rating !== "favorite"
      ? [
          {
            id: "rating",
            label: RATINGS.find((r) => r.value === filters.rating)?.label ?? "",
            remove: () => changeFilters({ ...filters, rating: "" }),
          },
        ]
      : []),
    ...chips
      .filter(
        (chip) =>
          !(chip.id === "time" && filters.maxMinutes === 30) &&
          !(chip.id === "made" && (filters.made === "recent" || filters.made === "never")),
      )
      .map((chip) => ({
        id: chip.id,
        label: chip.label,
        remove: () => changeFilters(chip.remove(filters)),
      })),
  ];
  const moreOn = removable.filter((chip) => chip.id !== "q").length;

  return (
    <>
      <div className={styles.listHead}>
        <PageHeader title="Your recipes" note={greetingFor(new Date())} />
        <div className={styles.listActions}>
          {list.length > 0 ? (
            <button
              type="button"
              className={styles.addButton}
              onClick={add}
              disabled={!editable}
              aria-disabled={addBlocked ? true : undefined}
              aria-describedby={addBlocked ? "add-blocked" : undefined}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className={styles.addLabel}>Add recipe</span>
            </button>
          ) : null}
          <MoreMenu
            selecting={selecting}
            onSelect={() => (selecting ? stopSelecting() : setSelecting(true))}
          />
        </div>
      </div>

      {/* On a phone the list has its own search box (owner's choice 2026-10-25); on a computer
          the sidebar's search is the one search, and what it found shows as a chip below. */}
      {list.length > 0 ? (
        <form
          role="search"
          className={styles.search}
          onSubmit={(e) => {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <label htmlFor="recipe-search" className="visually-hidden">
            Search recipes
          </label>
          <input
            id="recipe-search"
            type="search"
            className={styles.searchInput}
            value={query}
            placeholder="Search your recipes"
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => typeQuery(e.target.value)}
          />
        </form>
      ) : null}

      {list.length > 0 ? (
        <div className={styles.quick} role="group" aria-label="Show">
          <button
            type="button"
            className={styles.chipButton}
            aria-pressed={!narrowing}
            onClick={clearAll}
          >
            All
          </button>
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              className={styles.chipButton}
              aria-pressed={q.on(filters)}
              onClick={() => changeFilters(q.toggle(filters))}
            >
              {q.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.filtersButton}
            aria-expanded={showMore}
            aria-controls="more-filters"
            onClick={() => setShowMore(!showMore)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="10" cy="17" r="2" />
            </svg>
            {moreOn > 0 ? `Filters (${moreOn})` : "Filters"}
          </button>
        </div>
      ) : null}

      {list.length > 0 && showMore ? (
        <div id="more-filters" className={styles.filtersBox}>
          <div className={styles.filterGrid}>
            <div className={styles.sort}>
              <label htmlFor="list-category">Category</label>
              <select
                id="list-category"
                className={styles.select}
                value={filters.category}
                onChange={(e) => changeFilters({ ...filters, category: e.target.value })}
              >
                <option value="">All recipes</option>
                {tree?.nodes.map((node) => (
                  <option key={node.key} value={node.key}>
                    {node.path} ({node.count})
                  </option>
                ))}
                {filters.category &&
                filters.category !== UNFILED &&
                !tree?.byKey.has(filters.category) ? (
                  <option value={filters.category}>{filterName}</option>
                ) : null}
                <option value={UNFILED}>Not in a category</option>
              </select>
            </div>
            <div className={styles.sort}>
              <label htmlFor="list-rating">Rating</label>
              <select
                id="list-rating"
                className={styles.select}
                value={filters.rating}
                onChange={(e) =>
                  changeFilters({ ...filters, rating: e.target.value as RatingFilter })
                }
              >
                {RATINGS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <FilterPanel filters={filters} tree={tree} onChange={changeFilters} />
        </div>
      ) : null}

      {list.length > 0 && removable.length > 0 ? (
        <ul className={styles.activeFilters} aria-label="Filters on">
          {removable.map((chip) => (
            <li key={chip.id} className={categoryStyles.chip}>
              {chip.id === "q" ? <span className="visually-hidden">Search: </span> : null}
              {chip.label}
              <button
                type="button"
                className={categoryStyles.chipRemove}
                aria-label={chip.id === "q" ? "Clear the search" : `Remove filter: ${chip.label}`}
                onClick={chip.remove}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {list.length > 0 ? (
        <SavedSearches
          query={query}
          filters={filters}
          narrowing={narrowing}
          currentText={filtersToParams(
            query,
            filters,
            (key) => tree?.byKey.get(key)?.path,
          ).toString()}
          onApply={applySearch}
        />
      ) : null}

      {list.length > 0 ? <UsageNote id="add-blocked" ref={limitNote} /> : null}

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
            <button type="button" className={styles.secondary} onClick={stopSelecting}>
              Done selecting
            </button>
          </div>
          <BulkFile tree={tree} selected={chosen} editable={editable} run={run} />
          <div>
            <button
              type="button"
              className={styles.secondary}
              disabled={chosen.length === 0}
              onClick={() => print(chosen)}
            >
              Print {chosen.length === 1 ? "this recipe" : "these recipes"}
            </button>
          </div>
        </section>
      ) : null}
      <UndoBar done={done} failed={failed} onUndo={() => void undo()} disabled={!editable} />

      {recipes === null ? null : list.length > 0 ? (
        <section aria-labelledby="list-title">
          <h2 id="list-title" className="visually-hidden">
            {shown.length} {shown.length === 1 ? "recipe" : "recipes"}
          </h2>
          <div className={styles.countRow}>
            <p className={styles.filterNote}>
              <span aria-live="polite">
                {!narrowing
                  ? `${list.length} ${list.length === 1 ? "recipe" : "recipes"}`
                  : (searching && !search) || found.pending
                    ? "Searching…"
                    : shown.length === 0
                      ? filters.category === UNFILED && !searching && filtering === 1
                        ? "Every recipe is in a category."
                        : "No recipes found."
                      : `Showing ${shown.length} of ${list.length}${
                          search && search.titleIds.length > 0 && shown.length > 1
                            ? "; titles with every word come first"
                            : ""
                        }.`}
                {unknownNote(found.unknown, filters)}
              </span>{" "}
              {narrowing ? (
                <button type="button" className={styles.textButton} onClick={clearAll}>
                  Show all recipes
                </button>
              ) : null}
              {narrowing && !selecting && shown.length > 0 && !found.pending ? (
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => print(shown.map((recipe) => recipe.id))}
                >
                  {shown.length === 1 ? "Print it" : "Print these"}
                </button>
              ) : null}
            </p>
            <div className={styles.countTools}>
              <button
                type="button"
                className={styles.quietButton}
                disabled={shown.length === 0}
                onClick={() => setSurprise(pickSurprise(shown, surprise)?.id ?? null)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <rect x="4" y="4" width="16" height="16" rx="3" />
                  <circle cx="9" cy="9" r="1" fill="currentColor" />
                  <circle cx="15" cy="15" r="1" fill="currentColor" />
                  <circle cx="15" cy="9" r="1" fill="currentColor" />
                  <circle cx="9" cy="15" r="1" fill="currentColor" />
                </svg>
                Surprise me
              </button>
              {list.length > 1 ? (
                <label className={styles.sortQuiet}>
                  Sort by
                  <select
                    className={styles.sortSelect}
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
          </div>

          {/* Under the button, so it is seen on a phone too. */}
          <div aria-live="polite">
            {surpriseRecipe ? (
              <section className={styles.surprise} aria-label="A suggestion">
                {surpriseRecipe.cover ? (
                  <PhotoImage
                    hash={surpriseRecipe.cover.hash}
                    size="thumb"
                    width={surpriseRecipe.cover.width}
                    height={surpriseRecipe.cover.height}
                    alt=""
                    className={styles.coverPhoto}
                  />
                ) : (
                  <span className={styles.cover} aria-hidden="true">
                    <LogoSprig />
                  </span>
                )}
                <div className={styles.surpriseBody}>
                  <p className={styles.hint}>How about…</p>
                  <p className={styles.surpriseTitle}>{surpriseRecipe.title}</p>
                  {surpriseRecipe.totalMinutes !== null ? (
                    <p className={styles.hint}>{minutesText(surpriseRecipe.totalMinutes)}</p>
                  ) : null}
                </div>
                <div className={styles.surpriseActions}>
                  <Link href={`/recipes/${surpriseRecipe.id}`} className={styles.primary}>
                    Open
                  </Link>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => setSurprise(pickSurprise(shown, surprise)?.id ?? null)}
                  >
                    Another one
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => setSurprise(null)}
                  >
                    Not now
                  </button>
                </div>
              </section>
            ) : null}
          </div>

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
    </>
  );
}
