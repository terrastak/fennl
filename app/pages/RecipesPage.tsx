import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { SyncChange } from "../../shared/sync";
import { BulkFile } from "../categories/BulkFile";
import { addBlockedText, NOTHING_LOST } from "../limits/limitText";
import { UsageNote } from "../limits/Usage";
import { reportRefused } from "../limits/reportRefused";
import { useAddBlocked, useUsage } from "../limits/useLimits";
import { UndoBar } from "../categories/UndoBar";
import { useUndoable } from "../categories/useUndoable";
import { navigate, useSearchString } from "../navigation";
import { FilterBar } from "../recipes/FilterBar";
import { barFiltersOn } from "../recipes/filterBar";
import { FiltersPanel } from "../recipes/FiltersPanel";
import { ListMenu } from "../recipes/ListMenu";
import { RemoveIcon } from "../recipes/QuickMenu";
import { useSavedSearchControls } from "../recipes/savedSearchControls";
import {
  activeFilterCount,
  applyFilters,
  filtersToParams,
  pickSurprise,
  searchKey,
  UNFILED,
  type RecipeFilters,
} from "../recipes/filters";
import {
  addressCategoryName,
  ALL_RECIPES,
  countLineParts,
  listTitle,
  pickAll,
  outsideCount,
  pickedList,
  recipesText,
} from "../recipes/library";
import { today, useLibrary } from "../recipes/libraryContext";
import { minutesText } from "../recipes/format";
import { CardFace } from "../recipes/CardFace";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import { forgetTrashed, recentlyTrashed } from "../recipes/trashNotice";
import listStyles from "../recipes/list.module.css";
import styles from "../recipes/recipes.module.css";
import { SAMPLE_COUNT, sampleRecipeChanges } from "../recipes/samples";
import { Link } from "../router";
import { PhotoImage } from "../photos/PhotoImage";
import { printRecipes } from "../print/booklet";
import type { RecipeSummary } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import type { SearchHit } from "../sync/search";
import { activeSyncClient, useSyncStatus } from "../sync/useSync";
import { SearchIcon } from "../shell/Library";
import { PhoneLibrary } from "../shell/PhoneLibrary";
import { typeIntoSearch } from "../shell/typeToSearch";
import { useWide } from "../shell/useWide";
import { greetingFor } from "./greeting";

// The recipe list (phase C5): cards from this browser's copy, sorting, the empty state from
// docs/design/design-direction.md, and sample recipes to try. "Add recipe" opens the editor
// (phase C6) on a new recipe. Phase C7 adds the category filter and Select, for filing many
// recipes at once. Phase C8 adds search (app/sync/search.ts) and the rating filter. Phase C13a
// adds the Filters panel (app/recipes/filters.ts). The search and filters are kept in the address
// (?q=, ?category=, ?rating=, and the others filtersToParams writes). U17 (owner's choices
// 2026-11-04) moves the search, quick lists, saved searches and categories into the left panel
// (app/shell/Library.tsx); the list keeps a slim header saying what's shown, with Filters (called
// More filters until U21), the order, Add recipe and a ⋯ menu for the rest. A phone has the
// search box, Filters and a row of categories at the top of the list instead
// (app/shell/PhoneLibrary.tsx). U22: on a computer, Filters is a bar of chips under the count
// line (app/recipes/FilterBar.tsx); a phone keeps the Filters sheet.

async function save(change: SyncChange): Promise<boolean> {
  try {
    await activeSyncClient()?.save(change);
    return true;
  } catch {
    return false;
  }
}

type SortBy = "title" | "newest" | "changed";

const SORTS: { value: SortBy; label: string; short: string }[] = [
  { value: "title", label: "Title, A to Z", short: "A to Z" },
  { value: "newest", label: "Newest first", short: "Newest" },
  { value: "changed", label: "Recently changed", short: "Changed" },
];

const SORT_KEY = "fennl:recipe-sort";

/** The filters the filter bar shows, as one text (the category isn't one of them). */
const barKey = (filters: RecipeFilters) => searchKey("", { ...filters, category: "" });

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
  const body = <CardFace recipe={recipe} terms={terms} hit={hit} titleId={titleId} />;
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
            <LaptopIcon path={LAPTOP_ICONS.plus} />
            Add recipe
          </button>
          <Link href="/import" className={styles.secondary}>
            <LaptopIcon path={LAPTOP_ICONS.import} />
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

/** Recipes shown at a time; more on request, so a big recipe box stays quick. */
const PAGE = 100;

/**
 * A heading that wraps onto two lines is as wide as its longest line, not the whole row, so
 * what follows it (the ✕ and the count) sits beside the words rather than at the far edge.
 * Measured again when the row changes size or the fonts arrive.
 */
function useFitToLines(ref: RefObject<HTMLElement | null>, text: string) {
  useLayoutEffect(() => {
    const heading = ref.current;
    const row = heading?.parentElement?.parentElement;
    if (!heading || !row) return;
    const fit = () => {
      heading.style.width = "";
      const range = document.createRange();
      // The words alone: a saved search's name is a button inside the heading (U21), whose
      // own box would be as wide as the row.
      range.selectNodeContents(heading.querySelector("button") ?? heading);
      const lines = [...range.getClientRects()];
      if (new Set(lines.map((line) => Math.round(line.top))).size < 2) return;
      const left = heading.getBoundingClientRect().left;
      const right = Math.max(...lines.map((line) => line.right));
      heading.style.width = `${Math.ceil(right - left) + 1}px`;
    };
    fit();
    void document.fonts?.ready.then(fit);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [ref, text]);
}

export function RecipesPage() {
  const status = useSyncStatus();
  const library = useLibrary();
  const { recipes, tree, query, filters, search, counts } = library;
  const editable = canEdit(status);
  // A phone has no left panel: the recipe box is at the top of the list instead (U17).
  const wide = useWide();
  // Over a plan limit (phase C11), "Add recipe" says why instead of opening the editor.
  const addBlocked = useAddBlocked();
  const limitNote = useRef<HTMLParagraphElement>(null);
  const add = () => {
    if (!addBlocked) {
      navigate(`/recipes/${crypto.randomUUID()}/edit?new`);
      return;
    }
    limitNote.current?.focus();
    // The admin console sees what the person tried (phase U15).
    reportRefused(addBlocked, "recipe");
  };
  const [sortBy, setSortBy] = useState<SortBy>(savedSort);
  const [panelOpen, setPanelOpen] = useState(false);
  // The filter bar shows on its own whenever something beyond the category is set (U22); with
  // nothing set, after pressing Filters, or once emptied from the bar itself, so nothing moves
  // under the pointer. Kept as the filters it was opened for: changed from elsewhere (a quick
  // search, All recipes, closing a saved search), it goes when nothing is set.
  const [barOpenFor, setBarOpenFor] = useState<string | null>(null);
  const barId = useId();
  const [limit, setLimit] = useState(PAGE);
  const [addingSamples, setAddingSamples] = useState(false);
  const [surprise, setSurprise] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // A recipe just moved to Trash from its page can be put back from here (phase C9).
  const { done, failed, run, undo } = useUndoable(recentlyTrashed);
  useEffect(forgetTrashed, []);

  // A new search or list starts at the top, with no suggestion left over from the last one.
  const [seen, setSeen] = useState({ query, filters });
  if (seen.query !== query || seen.filters !== filters) {
    setSeen({ query, filters });
    setLimit(PAGE);
    setSurprise(null);
    // Filters changed from elsewhere (not by the bar, which remembers what it changed them to):
    // the bar no longer stays open on its own, so it goes once nothing is set.
    if (seen.filters !== filters && barOpenFor !== null && barOpenFor !== barKey(filters)) {
      setBarOpenFor(null);
    }
  }

  // Typing on the list goes straight into the search box (U17), unless it's typed into
  // something else. "/" is the frame's: it moves to the search box from any page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1 || event.key === " " || event.key === "/") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      // Not while a dialog or a menu (the list's ⋯) is open: the letter is for that.
      if (document.querySelector("dialog[open], [data-popup-open]")) return;
      const box = [...document.querySelectorAll<HTMLElement>("[data-type-to-search]")].find(
        (el) => el.getClientRects().length > 0,
      );
      if (!box) return;
      event.preventDefault();
      typeIntoSearch(event.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chooseSort = (value: SortBy) => {
    setSortBy(value);
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {
      // Not kept; the choice lasts while the page is open.
    }
  };

  /** Filters chosen here (Filters, the title's ✕) replace the address, as typing does. */
  const changeFilters = (next: RecipeFilters) => library.show(query, next, { replace: true });

  const addSamples = async () => {
    setAddingSamples(true);
    for (const change of sampleRecipeChanges()) {
      if (!(await save(change))) break;
    }
    setAddingSamples(false);
  };

  const list = recipes ?? [];
  const searching = query.trim() !== "";
  const found = applyFilters(list, filters, library.ingredients, today());
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
  // Printing several at once (phase F6), coming back to the list as it was.
  const print = (ids: string[]) => printRecipes(ids, `/${window.location.search}`);

  const busy = (searching && !search) || found.pending;
  // On a phone the Filters panel also holds the quick lists, so all but the category count.
  const phoneOn = filtering - (filters.category !== "" ? 1 : 0);
  // On a phone a category on its own isn't offered as a search to save: the row of categories
  // is one tap away already, and the button would sit alone between the header and the cards.
  const phoneNarrowing = searching || phoneOn > 0;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleRowRef = useRef<HTMLDivElement>(null);
  const saved = useSavedSearchControls({
    query,
    filters,
    narrowing,
    offerSave: wide ? narrowing : phoneNarrowing,
    currentText: filtersToParams(query, filters, (key) => tree?.byKey.get(key)?.path).toString(),
    headingRef: titleRef,
    rowRef: titleRowRef,
  });

  // What the header says (U17, U20): what's shown (a saved search's name, a category, or All
  // recipes), and under it how many recipes and what narrows them.
  const picked = pickedList(filters);
  const address = useSearchString();
  const nameOf = (key: string) => tree?.byKey.get(key)?.name ?? addressCategoryName(address, key);
  const listName = listTitle(filters, nameOf);
  const title = saved.shown?.name ?? listName;
  useFitToLines(titleRef, `${title}|${saved.naming}`);
  // An address naming a category that no longer exists (an old bookmark, or one renamed).
  const gone =
    !!tree && picked.kind === "category" && picked.key !== UNFILED && !tree.byKey.has(picked.key);
  const everything = picked.kind === "all" && !narrowing;
  // Categories in the line are said with what they're in ("Also in Dessert › Cakes").
  const pathOf = (key: string) => tree?.byKey.get(key)?.path ?? addressCategoryName(address, key);
  // With the filter bar the line is just the count (U22): the chips say what narrows the list.
  const barShown =
    wide && list.length > 0 && (barFiltersOn(filters) || barOpenFor === barKey(filters));
  const parts = barShown ? [] : countLineParts(query, filters, pathOf, saved.savedShape);
  // Filters' badge: what the filter bar shows (U22), everything set beyond the category, the
  // quick searches' tick lines included (until U22 it left those out, as the left panel shows
  // them).
  const moreOn = activeFilterCount({ ...filters, category: "" });
  const outside =
    searching && !busy && counts ? outsideCount(filters, counts.all, shown.length) : 0;

  // What else the line under the heading says, after the count. With nothing matching it says
  // just "0 recipes" and what narrows the list (U21: no "No recipes found.", and no note of
  // recipes a time or servings filter leaves out for not saying).
  const extra: ReactNode = gone ? (
    <>There&rsquo;s no category called &ldquo;{listName}&rdquo; now.</>
  ) : outside > 0 ? (
    <>
      {outside} more {outside === 1 ? "matches" : "match"}{" "}
      {filters.category === UNFILED ? (
        "in categories"
      ) : (
        <>
          outside {/* A very long name is shortened here; the heading says it in full. */}
          <span className={listStyles.outsideName} title={listName}>
            {listName}
          </span>
        </>
      )}
      .{" "}
      <button
        type="button"
        className={listStyles.inlineLink}
        onClick={() => library.show(query, pickAll(filters))}
      >
        Search all recipes
      </button>
    </>
  ) : null;

  // The order: under the title on a computer, beside it on a phone, where its names are short.
  const sortChoice = (
    <span className={listStyles.sortChip}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 5v14M4 16l3 3 3-3M13 7h7M13 12h5M13 17h3" />
      </svg>
      <select
        aria-label="Sort by"
        value={sortBy}
        onChange={(e) => chooseSort(e.target.value as SortBy)}
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {wide ? s.label : s.short}
          </option>
        ))}
      </select>
    </span>
  );

  return (
    <>
      {/* On a phone the search box and categories are on the page (the left panel is a
          computer's). */}
      {list.length > 0 && !wide ? (
        <PhoneLibrary filtersOn={phoneOn} onFilters={() => setPanelOpen(true)} />
      ) : null}

      <header className={listStyles.head}>
        {/* The line above the heading keeps its space on a computer, so nothing below moves
            between lists (U20): the greeting on All recipes with nothing on, QUICK SEARCH when
            the list is exactly a saved search, else nothing. */}
        {wide ? (
          <div className={listStyles.above}>
            {saved.shown && saved.exact ? (
              <p className={listStyles.kind}>
                <SearchIcon size={14} />
                Quick search
              </p>
            ) : everything && !saved.shown ? (
              <p className="hand-note">{greetingFor(new Date())}</p>
            ) : null}
          </div>
        ) : null}
        <div
          ref={titleRowRef}
          className={`${listStyles.titleRow} ${saved.naming ? listStyles.namingRow : ""}`}
          style={saved.rowHeight ? { minHeight: saved.rowHeight } : undefined}
        >
          <div className={`${listStyles.what} ${title.length > 18 ? listStyles.longName : ""}`}>
            {/* The name, then its pencil and ✕ kept together after its last line; or, while
                naming a saved search, the box for its name in the same place. */}
            <div className={`${listStyles.nameRow} ${saved.naming ? listStyles.naming : ""}`}>
              {saved.naming ? (
                saved.nameBox
              ) : (
                <>
                  <h1 ref={titleRef} tabIndex={-1} className={listStyles.title}>
                    {saved.titleContent ?? title}
                  </h1>
                  {saved.shown || picked.kind !== "all" ? (
                    <span className={listStyles.after}>
                      {/* A changed saved search can be saved (U21): in words, not colour. */}
                      {saved.edited ? <span className={listStyles.edited}>Edited</span> : null}
                      {saved.pencil}
                      {saved.shown ? (
                        <button
                          type="button"
                          className={listStyles.unpick}
                          aria-label="Close this search"
                          title="Close this search"
                          onClick={() => {
                            library.setChosenSearch("");
                            library.show("", ALL_RECIPES);
                          }}
                        >
                          <RemoveIcon />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={listStyles.unpick}
                          aria-label="Show all categories"
                          title="Show all categories"
                          onClick={() => library.show(query, pickAll(filters))}
                        >
                          <RemoveIcon />
                        </button>
                      )}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {list.length > 0 ? (
            <div className={listStyles.headActions}>
              {list.length > 1 && !wide ? sortChoice : null}
              <button
                type="button"
                className={`${styles.primary} ${listStyles.add}`}
                onClick={add}
                disabled={!editable}
                aria-disabled={addBlocked ? true : undefined}
                aria-describedby={addBlocked ? "add-blocked" : undefined}
              >
                <span aria-hidden="true">+</span>
                <span className={listStyles.addText}>Add recipe</span>
              </button>
              <ListMenu
                selecting={selecting}
                onSelect={() => (selecting ? stopSelecting() : setSelecting(true))}
                onSurprise={() => setSurprise(pickSurprise(shown, surprise)?.id ?? null)}
                onPrint={() => print(shown.map((recipe) => recipe.id))}
                canSurprise={shown.length > 0}
                shown={busy ? null : shown.length}
                trash={!wide}
              />
            </div>
          ) : null}
        </div>

        {list.length > 0 ? (
          <div className={`${listStyles.bar} ${barShown ? listStyles.barAbove : ""}`}>
            <p className={listStyles.hint}>
              {/* How many recipes and what narrows them (U20), said aloud in full as it
                  changes. */}
              <span className={listStyles.countLine} aria-live="polite" aria-atomic="true">
                {busy ? (
                  "Searching…"
                ) : (
                  <>
                    <strong className={listStyles.countWord}>{recipesText(shown.length)}</strong>
                    {parts.map((part, i) => (
                      <span key={i}>
                        {" · "}
                        {part.added ? (
                          <span className={listStyles.added}>
                            <span aria-hidden="true">+ </span>
                            {part.text}
                            <span className="visually-hidden"> (added)</span>
                          </span>
                        ) : (
                          part.text
                        )}
                      </span>
                    ))}
                    {everything && wide && !saved.shown ? (
                      <> · pick a category on the left, or just start typing to search</>
                    ) : null}
                  </>
                )}
              </span>
              {extra ? (
                <>
                  {busy ? " " : ". "}
                  {extra}
                </>
              ) : null}
              {/* What went wrong naming or updating a saved search, after the count. */}
              {saved.problem ? (
                <>
                  {busy || extra ? " " : ". "}
                  <span id={saved.problemId} className={listStyles.problem} role="alert">
                    {saved.problem}
                  </span>
                </>
              ) : null}
            </p>
            <div className={listStyles.tools}>
              {saved.buttons}
              {wide ? (
                <button
                  type="button"
                  className={listStyles.tool}
                  aria-expanded={barShown}
                  aria-controls={barShown ? barId : undefined}
                  onClick={() => {
                    // With something set the bar stays, and the focus goes to its first chip;
                    // with nothing set, Filters shows or hides the bar's groups.
                    if (barFiltersOn(filters)) {
                      document
                        .getElementById(barId)
                        ?.querySelector<HTMLElement>("button[data-chip-anchor]")
                        ?.focus();
                    } else setBarOpenFor(barShown ? null : barKey(filters));
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                    <circle cx="16" cy="7" r="2" />
                    <circle cx="10" cy="17" r="2" />
                  </svg>
                  Filters
                  {moreOn > 0 ? (
                    <span className={listStyles.count}>
                      {moreOn}
                      <span className="visually-hidden"> on</span>
                    </span>
                  ) : null}
                </button>
              ) : null}
              {list.length > 1 && wide ? sortChoice : null}
            </div>
          </div>
        ) : null}
        {barShown ? (
          <FilterBar
            id={barId}
            filters={filters}
            tree={tree}
            pathOf={pathOf}
            saved={saved.shown && !saved.exact ? (saved.savedShape?.filters ?? null) : null}
            onChange={(next) => {
              setBarOpenFor(barKey(next));
              changeFilters(next);
            }}
          />
        ) : null}
        {saved.status}
      </header>

      {/* Right under the filters, where the list starts, so it is seen on a phone too. */}
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
                {surpriseRecipe.title.trim().charAt(0).toUpperCase()}
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
                <LaptopIcon path={LAPTOP_ICONS.arrow} />
              </Link>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setSurprise(pickSurprise(shown, surprise)?.id ?? null)}
              >
                <LaptopIcon path={LAPTOP_ICONS.shuffle} />
                Another one
              </button>
              <button type="button" className={styles.textButton} onClick={() => setSurprise(null)}>
                Not now
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {list.length > 0 && !wide ? (
        <FiltersPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          filters={filters}
          tree={tree}
          shown={busy ? null : shown.length}
          onChange={changeFilters}
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
              <LaptopIcon path={LAPTOP_ICONS.print} />
              Print {chosen.length === 1 ? "this recipe" : "these recipes"}
            </button>
          </div>
        </section>
      ) : null}
      <UndoBar done={done} failed={failed} onUndo={() => void undo()} disabled={!editable} />

      {recipes === null ? null : list.length > 0 ? (
        <section
          id="recipe-results"
          tabIndex={-1}
          className={listStyles.results}
          aria-labelledby="list-title"
        >
          <h2 id="list-title" className="visually-hidden">
            {shown.length} {shown.length === 1 ? "recipe" : "recipes"}
          </h2>
          <ul className={`${styles.grid} ${styles.twoUp}`}>
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
        Deleted recipes stay in <Link href="/trash">Trash</Link> for 30 days.
      </p>
    </>
  );
}
