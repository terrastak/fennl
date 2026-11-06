import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isQuickSearchItem, quickSearchKey, type QuickFilter } from "../../shared/quickSearches";
import { CategoryCombobox } from "../categories/CategoryCombobox";
import { Link } from "../router";
import { pathKey, type CategoryTree } from "../categories/tree";
import categoryStyles from "../categories/categories.module.css";
import { AddToQuick } from "./AddToQuick";
import {
  cleanWords,
  MADE_LABELS,
  NO_FILTERS,
  RATING_LABELS,
  SERVING_CHOICES,
  shortMinutes,
  TIME_CHOICES,
  type MadeFilter,
  type RatingFilter,
  type RecipeFilters,
} from "./filters";
import { useLibrary } from "./libraryContext";
import { useHideNutrition } from "./nutritionSetting";
import { RemoveIcon } from "./QuickMenu";
import { QuickAddButton, QuickChoicesButton } from "./QuickSearchMenus";
import { quickFilterOn, quickFiltersIn, toggleQuickFilter } from "./quickSearchFilters";
import { quickSearchProblem, type QuickSearchEntry } from "./quickSearches";
import { problemText } from "./savedSearches";
import listStyles from "./list.module.css";
import quickStyles from "./quickSearches.module.css";
import styles from "./recipes.module.css";

// The list's Filters (phase C13a; a panel since U13, owner's choices 2026-11-04): every way to
// narrow the list, grouped, most of them one tap each. Since U22 it is the phone's (a computer
// has the filter bar, FilterBar.tsx): it comes up from the bottom, or in from the side on a
// tablet-sized window; the list behind it follows each choice at once, and the button at the
// bottom says how many recipes are left. With no left panel (U17), it starts with the quick
// searches (U18), one tap each. Each filter that is set has a button to add it to the quick
// searches (U18, owner's choice 3); categories don't.

/** One choice from a few, as a row of buttons (the one chosen pressed). */
function Choices<T extends string | number | null>({
  label,
  value,
  choices,
  onChange,
  add,
}: {
  label: string;
  value: T;
  choices: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  /** The button adding the choice made to the quick searches, when there is one. */
  add?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={listStyles.group} role="group" aria-labelledby={id}>
      <div className={quickStyles.titleRow}>
        <h3 id={id} className={listStyles.groupTitle}>
          {label}
        </h3>
        {add}
      </div>
      <div className={listStyles.options}>
        {choices.map((choice) => (
          <button
            key={String(choice.value)}
            type="button"
            className={listStyles.option}
            aria-pressed={choice.value === value}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Words for the ingredient filters, shown as chips with a box to add another. */
function WordsField({
  label,
  placeholder,
  words,
  onChange,
  addFor,
}: {
  label: string;
  placeholder: string;
  words: string[];
  onChange: (words: string[]) => void;
  /** The button adding a word to the quick searches ("Without mushroom"). */
  addFor: (word: string) => ReactNode;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const add = () => {
    if (!typed.trim()) return;
    onChange(cleanWords([...words, typed]));
    setTyped("");
  };
  return (
    <div className={styles.filterField}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.addWord}>
        <input
          id={id}
          type="text"
          className={styles.filterInput}
          value={typed}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={styles.secondary} onClick={add} disabled={!typed.trim()}>
          Add
        </button>
      </div>
      {words.length > 0 ? (
        <ul className={categoryStyles.chips} aria-label={label}>
          {words.map((word) => (
            <li key={word} className={categoryStyles.chip}>
              {word}
              {addFor(word)}
              <button
                type="button"
                className={categoryStyles.chipRemove}
                aria-label={`Remove ${word}`}
                onClick={() =>
                  onChange(words.filter((w) => w.toLocaleLowerCase() !== word.toLocaleLowerCase()))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Categories for one of the category filters: chips, and a box to find another to add. */
export function CategoriesField({
  label,
  tree,
  keys,
  taken,
  onChange,
}: {
  label: string;
  tree: CategoryTree;
  keys: string[];
  /** Keys already used by the other category filters, which aren't offered again. */
  taken: string[];
  onChange: (keys: string[]) => void;
}) {
  return (
    <div className={styles.filterField}>
      <CategoryCombobox
        tree={tree}
        label={label}
        allowNew={false}
        closeOnChoose
        exclude={[...keys, ...taken]}
        onChoose={(names) => onChange([...keys, pathKey(names)])}
      />
      {keys.length > 0 ? (
        <ul className={categoryStyles.chips} aria-label={label}>
          {keys.map((key) => (
            <li key={key} className={categoryStyles.chip}>
              {tree.byKey.get(key)?.path ?? key}
              <button
                type="button"
                className={categoryStyles.chipRemove}
                aria-label={`Remove ${tree.byKey.get(key)?.path ?? key}`}
                onClick={() => onChange(keys.filter((k) => k !== key))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FiltersPanel({
  open,
  onClose,
  filters,
  tree,
  shown,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  filters: RecipeFilters;
  tree: CategoryTree | null;
  /** How many recipes the list shows with these filters, for the button that closes it. */
  shown: number | null;
  onChange: (filters: RecipeFilters) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const anyId = useId();
  const set = (changes: Partial<RecipeFilters>) => onChange({ ...filters, ...changes });
  // Nutrition hidden in Settings (phase F4): no filter for it either.
  const [hideNutrition] = useHideNutrition();
  const mainCategory =
    filters.category && filters.category !== "__unfiled" ? [filters.category] : [];
  // A change to the quick searches that didn't save, said at the top of the panel.
  const [problem, setProblem] = useState("");
  // Each filter that is set, as the tick line it would add (one a line can't hold, such as a
  // time typed into the address, has no button).
  const addable = quickFiltersIn(filters).filter(isQuickSearchItem);
  const addFor = (find: (item: QuickFilter) => boolean) => {
    const item = addable.find(find);
    return item ? <AddToQuick item={item} onProblem={setProblem} /> : null;
  };
  const addWord = (filter: "with" | "without") => (word: string) => {
    const key = quickSearchKey({ type: "filter", filter, word });
    const item = addable.find((i) => quickSearchKey(i) === key);
    return item ? <AddToQuick item={item} small onProblem={setProblem} /> : null;
  };

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={listStyles.panel}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the dimmed page around the panel closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Its contents only while open, so nothing in it lingers unseen. */}
      {open ? (
        <>
          <div className={listStyles.panelHead}>
            <h2 id={titleId} className={listStyles.panelTitle}>
              Filters
            </h2>
            <button
              type="button"
              className={listStyles.close}
              aria-label="Close filters"
              onClick={onClose}
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <div className={listStyles.panelBody}>
            <p className={quickStyles.problem} role="alert">
              {problem}
            </p>
            <PhoneQuick
              filters={filters}
              onChange={onChange}
              onClose={onClose}
              onProblem={setProblem}
            />
            {tree && tree.nodes.length > 0 ? (
              <div className={listStyles.group}>
                <h3 className={listStyles.groupTitle}>Categories</h3>
                <div className={styles.filterGroup}>
                  <CategoriesField
                    label="Also in category"
                    tree={tree}
                    keys={filters.alsoIn}
                    taken={[...mainCategory, ...filters.notIn]}
                    onChange={(alsoIn) => set({ alsoIn })}
                  />
                  <CategoriesField
                    label="Not in category"
                    tree={tree}
                    keys={filters.notIn}
                    taken={[...mainCategory, ...filters.alsoIn]}
                    onChange={(notIn) => set({ notIn })}
                  />
                </div>
                {mainCategory.length + filters.alsoIn.length > 1 ? (
                  <fieldset className={styles.filterChoice}>
                    <legend id={anyId}>A recipe must be in</legend>
                    <label>
                      <input
                        type="radio"
                        name={anyId}
                        checked={!filters.anyCategory}
                        onChange={() => set({ anyCategory: false })}
                      />
                      all of these categories
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={anyId}
                        checked={filters.anyCategory}
                        onChange={() => set({ anyCategory: true })}
                      />
                      any of these categories
                    </label>
                  </fieldset>
                ) : null}
              </div>
            ) : null}

            <div className={listStyles.group}>
              <h3 className={listStyles.groupTitle}>Ingredients</h3>
              <div className={styles.filterGroup}>
                <WordsField
                  label="With ingredient"
                  placeholder="e.g. lime"
                  words={filters.with}
                  onChange={(words) => set({ with: words })}
                  addFor={addWord("with")}
                />
                <WordsField
                  label="Without ingredient"
                  placeholder="e.g. mushrooms"
                  words={filters.without}
                  onChange={(words) => set({ without: words })}
                  addFor={addWord("without")}
                />
              </div>
            </div>

            <Choices<number | null>
              label="Total time, up to"
              value={filters.maxMinutes}
              choices={[
                { value: null, label: "Any" },
                ...TIME_CHOICES.map((m) => ({ value: m, label: shortMinutes(m) })),
              ]}
              onChange={(maxMinutes) => set({ maxMinutes })}
              add={addFor((item) => item.filter === "time")}
            />
            <Choices<RatingFilter>
              label="Rating"
              value={filters.rating}
              choices={[
                { value: "", label: "Any" },
                // In this order (keys like "5" would otherwise come first, lowest first).
                ...(["favorite", "5", "4", "3", "none"] as const).map((value) => ({
                  value,
                  label: RATING_LABELS[value],
                })),
              ]}
              onChange={(rating) => set({ rating })}
              add={addFor((item) => item.filter === "rating" || item.filter === "favorites")}
            />
            <Choices<MadeFilter>
              label="Last made"
              value={filters.made}
              choices={[
                { value: "", label: "Any time" },
                ...(Object.keys(MADE_LABELS) as Exclude<MadeFilter, "">[]).map((value) => ({
                  value,
                  label: MADE_LABELS[value],
                })),
              ]}
              onChange={(made) => set({ made })}
              add={addFor((item) => item.filter === "made")}
            />
            <Choices<number | null>
              label="Serves at least"
              value={filters.minServings}
              choices={[
                { value: null, label: "Any" },
                ...SERVING_CHOICES.map((count) => ({ value: count, label: String(count) })),
              ]}
              onChange={(minServings) => set({ minServings })}
              add={addFor((item) => item.filter === "serves")}
            />

            <div className={listStyles.group}>
              <h3 className={listStyles.groupTitle}>More</h3>
              <label className={styles.sort}>
                Source
                <input
                  type="text"
                  className={styles.filterInput}
                  value={filters.source}
                  placeholder="A site, book or person"
                  autoComplete="off"
                  onChange={(e) => set({ source: e.target.value })}
                />
              </label>
              {addFor((item) => item.filter === "source") ? (
                <div className={quickStyles.withAdd}>
                  {addFor((item) => item.filter === "source")}
                </div>
              ) : null}
              <div className={styles.filterChecks}>
                <div className={quickStyles.withAdd}>
                  <label>
                    <input
                      type="checkbox"
                      checked={filters.photo}
                      onChange={(e) => set({ photo: e.target.checked })}
                    />
                    Has a photo
                  </label>
                  {addFor((item) => item.filter === "photo")}
                </div>
                {hideNutrition ? null : (
                  <div className={quickStyles.withAdd}>
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.nutrition}
                        onChange={(e) => set({ nutrition: e.target.checked })}
                      />
                      Has nutrition
                    </label>
                    {addFor((item) => item.filter === "nutrition")}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={listStyles.panelFoot}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => onChange({ ...NO_FILTERS })}
            >
              Clear filters
            </button>
            <button type="button" className={styles.primary} onClick={onClose}>
              {shown === null
                ? "Show recipes"
                : `Show ${shown} ${shown === 1 ? "recipe" : "recipes"}`}
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

/**
 * A phone's quick searches (U18, owner's choice 8), which a computer has in the left panel: a tick
 * line is a button, on or off, staying on together with the category shown, as filters do; one
 * with choices has a ▾ beside it; a search line shows its saved search. "+ Add" offers the common
 * ones, and Edit shows a ✕ on each, removing it at once (a search line's saved search is deleted).
 */
function PhoneQuick({
  filters,
  onChange,
  onClose,
  onProblem,
}: {
  filters: RecipeFilters;
  onChange: (filters: RecipeFilters) => void;
  onClose: () => void;
  onProblem: (text: string) => void;
}) {
  const library = useLibrary();
  const { quick } = library;
  const [editing, setEditing] = useState(false);
  const titleId = useId();
  const group = useRef<HTMLDivElement>(null);
  // After a ✕, the focus goes on to the next chip's ✕ (else the one before, else Done) once the
  // chip has really gone, so it never falls out of the sheet; if it wasn't removed, it stays.
  const focusNext = useRef<{ key: string | null; gone: string } | null>(null);
  useLayoutEffect(() => {
    const want = focusNext.current;
    const root = group.current;
    if (!want || !root) return;
    if (root.querySelector(`[data-quick-key="${CSS.escape(want.gone)}"]`)) return;
    focusNext.current = null;
    const target =
      (want.key !== null &&
        root.querySelector<HTMLElement>(
          `[data-quick-key="${CSS.escape(want.key)}"] [data-chip-remove]`,
        )) ||
      root.querySelector<HTMLElement>("[data-quick-edit]");
    target?.focus();
  });
  const remove = (entry: QuickSearchEntry, index: number) => {
    onProblem("");
    const next = quick.entries[index + 1] ?? quick.entries[index - 1];
    const want = { key: next?.key ?? null, gone: entry.key };
    focusNext.current = want;
    const done = () => {
      if (focusNext.current === want) focusNext.current = null;
    };
    if (entry.search) {
      void library.saved.remove(entry.search.id).then((outcome) => {
        if (outcome.ok) return;
        done();
        onProblem(problemText(outcome.error));
      });
    } else {
      void quick.remove(entry.key).then((outcome) => {
        if (outcome.ok) return;
        done();
        onProblem(quickSearchProblem(outcome.error));
      });
    }
  };
  return (
    <div ref={group} className={listStyles.group} role="group" aria-labelledby={titleId}>
      <div className={quickStyles.titleRow}>
        <h3 id={titleId} className={listStyles.groupTitle}>
          Quick searches
        </h3>
        {quick.entries.length > 0 || editing ? (
          <button
            type="button"
            className={quickStyles.phoneEdit}
            aria-label={editing ? "Done editing quick searches" : "Edit quick searches"}
            data-quick-edit=""
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </div>
      <ul className={quickStyles.chips}>
        {quick.entries.map((entry, index) => {
          const item = entry.item;
          if (editing) {
            return (
              <li key={entry.key} className={quickStyles.chipWrap} data-quick-key={entry.key}>
                <span className={`${quickStyles.chip} ${quickStyles.chipEditing}`}>
                  {entry.search ? <SearchGlass /> : null}
                  {entry.label}
                  <button
                    type="button"
                    className={quickStyles.chipRemove}
                    aria-label={
                      entry.search
                        ? `Delete the saved search ${entry.label}`
                        : `Remove ${entry.label} from quick searches`
                    }
                    data-chip-remove=""
                    onClick={() => remove(entry, index)}
                  >
                    <RemoveIcon size={10} />
                  </button>
                </span>
              </li>
            );
          }
          if (item.type === "search") {
            const search = entry.search;
            return (
              <li key={entry.key} className={quickStyles.chipWrap}>
                <Link
                  href={search?.query ? `/?${search.query.replace(/^\?/, "")}` : "/"}
                  className={quickStyles.chip}
                  onClick={() => {
                    if (search) library.setChosenSearch(search.id);
                    onClose();
                  }}
                >
                  <SearchGlass />
                  {entry.label}
                </Link>
              </li>
            );
          }
          return (
            <li key={entry.key} className={quickStyles.chipWrap}>
              <button
                type="button"
                className={quickStyles.chip}
                aria-pressed={quickFilterOn(item, filters)}
                onClick={() => onChange(toggleQuickFilter(filters, item))}
              >
                {entry.label}
              </button>
              <QuickChoicesButton
                entry={entry}
                className={quickStyles.chipMore}
                inline
                onProblem={onProblem}
              />
            </li>
          );
        })}
        {editing ? null : (
          <li className={quickStyles.chipWrap}>
            <QuickAddButton
              className={`${quickStyles.chip} ${quickStyles.chipAdd}`}
              inline
              onProblem={onProblem}
            >
              <span aria-hidden="true">+</span> Add
            </QuickAddButton>
          </li>
        )}
      </ul>
    </div>
  );
}

function SearchGlass() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
