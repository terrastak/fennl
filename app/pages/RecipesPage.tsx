import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { SyncChange } from "../../shared/sync";
import { BulkFile } from "../categories/BulkFile";
import { addBlockedText, NOTHING_LOST } from "../limits/limitText";
import { UsageNote } from "../limits/Usage";
import { reportRefused } from "../limits/reportRefused";
import { useAddBlocked, useUsage } from "../limits/useLimits";
import { UndoBar } from "../categories/UndoBar";
import { useUndoable } from "../categories/useUndoable";
import { navigate, useSearchString } from "../navigation";
import { FiltersPanel } from "../recipes/FiltersPanel";
import { ListMenu } from "../recipes/ListMenu";
import { useSavedSearchControls } from "../recipes/savedSearchControls";
import {
  activeFilterCount,
  applyFilters,
  filtersToParams,
  pickSurprise,
  UNFILED,
  type RecipeFilters,
} from "../recipes/filters";
import {
  addressCategoryName,
  favoritesOn,
  listTitle,
  pickAll,
  outsideCount,
  pickedList,
  quickOn,
  shownSentence,
} from "../recipes/library";
import { today, useLibrary } from "../recipes/libraryContext";
import { minutesText } from "../recipes/format";
import { Highlight } from "../recipes/Highlight";
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
import { PhoneLibrary } from "../shell/PhoneLibrary";
import { typeIntoSearch } from "../shell/typeToSearch";
import { useWide } from "../shell/useWide";
import { greetingFor } from "./greeting";

// The recipe list (phase C5): cards from this browser's copy, sorting, the empty state from
// docs/design/design-direction.md, and sample recipes to try. "Add recipe" opens the editor
// (phase C6) on a new recipe. Phase C7 adds the category filter and Select, for filing many
// recipes at once. Phase C8 adds search (app/sync/search.ts) and the rating filter. Phase C13a
// adds "More filters" (app/recipes/filters.ts). The search and filters are kept in the address
// (?q=, ?category=, ?rating=, and the others filtersToParams writes). U17 (owner's choices
// 2026-11-04) moves the search, quick lists, saved searches and categories into the left panel
// (app/shell/Library.tsx); the list keeps a slim header saying what's shown, with More filters,
// the order, Add recipe and a ⋯ menu for the rest. A phone has the search box, Filters and a row
// of categories at the top of the list instead (app/shell/PhoneLibrary.tsx).

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
  // Stars and time on one line (the dot stays with the time, so a line never ends on one), the
  // categories under them (U17 mockup).
  const stars = recipe.myRating ?? 0;
  const time = recipe.totalMinutes !== null ? minutesText(recipe.totalMinutes) : "";
  const titleId = `card-title-${recipe.id}`;
  const heart = recipe.favorite ? (
    <span className={listStyles.heart}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      </svg>
      <span className="visually-hidden">Favorite</span>
    </span>
  ) : null;
  const body = (
    <>
      {recipe.cover ? (
        // The cover's small copy (phase D2); recipes without one keep their first letter.
        <PhotoImage
          hash={recipe.cover.hash}
          size="thumb"
          width={recipe.cover.width}
          height={recipe.cover.height}
          alt=""
          className={styles.coverPhoto}
        />
      ) : (
        <span className={styles.cover} aria-hidden="true">
          {recipe.title.trim().charAt(0).toUpperCase()}
        </span>
      )}
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
        {stars > 0 || time ? (
          <span className={listStyles.cardFacts}>
            {stars > 0 ? (
              <span className={listStyles.stars}>
                <span aria-hidden="true">{"★".repeat(stars)}</span>
                <span className="visually-hidden">
                  {stars} {stars === 1 ? "star" : "stars"}
                </span>
              </span>
            ) : null}
            {stars > 0 && time ? (
              <span className={listStyles.nowrap}>
                {" "}
                · <span className={listStyles.time}>{time}</span>
              </span>
            ) : time ? (
              <span className={listStyles.time}>{time}</span>
            ) : null}
          </span>
        ) : null}
        {recipe.categories.length > 0 ? (
          <span className={styles.cardMeta}>
            {recipe.categories.map((path, i) => (
              <span key={path}>
                {i > 0 ? " " : ""}
                {/* Kept whole on its line, its comma with it; one too long for the card ends in
                    "…", the whole path shown on hover (and read out in full). */}
                <span className={listStyles.nowrap}>
                  <span className={listStyles.path} title={path}>
                    {path}
                  </span>
                  {i < recipe.categories.length - 1 ? "," : ""}
                </span>
              </span>
            ))}
          </span>
        ) : null}
        {recipe.waiting ? <span className={styles.cardMeta}>Not synced yet</span> : null}
      </span>
      {heart}
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
      range.selectNodeContents(heading);
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

  /** Filters chosen here (More filters, the title's ✕) replace the address, as typing does. */
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
  const nameOf = (key: string) => tree?.byKey.get(key)?.path ?? key;
  // Printing several at once (phase F6), coming back to the list as it was.
  const print = (ids: string[]) => printRecipes(ids, `/${window.location.search}`);

  const busy = (searching && !search) || found.pending;
  // On a phone the Filters panel also holds the quick lists, so all but the category count.
  const phoneOn = filtering - (filters.category !== "" ? 1 : 0);
  // On a phone a category on its own isn't offered as a search to save: the row of categories
  // is one tap away already, and the button would sit alone between the header and the cards.
  const phoneNarrowing = searching || phoneOn > 0;
  const saved = useSavedSearchControls({
    query,
    filters,
    narrowing: wide ? narrowing : phoneNarrowing,
    currentText: filtersToParams(query, filters, (key) => tree?.byKey.get(key)?.path).toString(),
  });

  // What the header says (U17): what's shown, and in a sentence what narrows it.
  const picked = pickedList(filters);
  const address = useSearchString();
  const title = listTitle(
    filters,
    (key) => tree?.byKey.get(key)?.name ?? addressCategoryName(address, key),
  );
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFitToLines(titleRef, title);
  // An address naming a category that no longer exists (an old bookmark, or one renamed).
  const gone =
    !!tree && picked.kind === "category" && picked.key !== UNFILED && !tree.byKey.has(picked.key);
  const sentence = busy ? "Searching…" : shownSentence(shown.length, query, filters, nameOf);
  const showCount = recipes !== null && list.length > 0;
  // Filters only More filters shows (the left panel shows the rest).
  const moreOn =
    filtering -
    [
      filters.category !== "",
      favoritesOn(filters),
      quickOn(filters),
      picked.kind === "made",
    ].filter(Boolean).length;
  const outside =
    searching && !busy && counts ? outsideCount(filters, counts.all, shown.length) : 0;

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
        {picked.kind === "all" && !narrowing && wide ? (
          <p className="hand-note">{greetingFor(new Date())}</p>
        ) : null}
        <div className={listStyles.titleRow}>
          <div className={`${listStyles.what} ${title.length > 18 ? listStyles.longName : ""}`}>
            {/* The name, then its ✕ and the count kept together after its last line. */}
            <div className={listStyles.nameRow}>
              <h1 ref={titleRef} tabIndex={-1} className={listStyles.title}>
                {title}
              </h1>
              {picked.kind !== "all" || (showCount && !sentence) ? (
                <span className={listStyles.after}>
                  {picked.kind !== "all" ? (
                    <button
                      type="button"
                      className={listStyles.unpick}
                      aria-label={
                        picked.kind === "made" ? "Show all recipes" : "Show all categories"
                      }
                      title={picked.kind === "made" ? "Show all recipes" : "Show all categories"}
                      onClick={() => library.show(query, pickAll(filters))}
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  ) : null}
                  {showCount && !sentence ? (
                    <span className={listStyles.shown} aria-hidden="true">
                      {shown.length}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            {/* Said aloud as it changes: the sentence, or how many recipes the list shows. */}
            {showCount ? (
              <p
                className={
                  sentence ? `${listStyles.shown} ${listStyles.sentence}` : "visually-hidden"
                }
                aria-live="polite"
              >
                {sentence ?? `${shown.length} ${shown.length === 1 ? "recipe" : "recipes"}`}
              </p>
            ) : null}
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
                canPrint={shown.length > 0 && !busy}
              />
            </div>
          ) : null}
        </div>

        {list.length > 0 ? (
          <div className={listStyles.bar}>
            <p className={listStyles.hint}>
              {gone ? (
                <>There&rsquo;s no category called &ldquo;{title}&rdquo; now. </>
              ) : outside > 0 ? (
                <>
                  {outside} more {outside === 1 ? "matches" : "match"}{" "}
                  {filters.category === UNFILED ? (
                    "in categories"
                  ) : (
                    <>
                      outside{" "}
                      {/* A very long name is shortened here; the heading says it in full. */}
                      <span className={listStyles.outsideName} title={title}>
                        {title}
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
              ) : !busy && shown.length === 0 ? (
                filters.category === UNFILED && !searching && filtering === 1 ? (
                  "Every recipe is in a category."
                ) : (
                  "No recipes found."
                )
              ) : !narrowing && wide ? (
                "Pick a category on the left, or just start typing to search."
              ) : null}
              {busy ? "" : unknownNote(found.unknown, filters)}
            </p>
            <div className={listStyles.tools}>
              {saved.buttons}
              {wide ? (
                <button
                  type="button"
                  className={`${listStyles.tool} ${listStyles.toolOutlined}`}
                  aria-haspopup="dialog"
                  onClick={() => setPanelOpen(true)}
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
                  More filters
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
      </header>
      {list.length > 0 ? saved.panel : null}

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
              </Link>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setSurprise(pickSurprise(shown, surprise)?.id ?? null)}
              >
                Another one
              </button>
              <button type="button" className={styles.textButton} onClick={() => setSurprise(null)}>
                Not now
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {list.length > 0 ? (
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
