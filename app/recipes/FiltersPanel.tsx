import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CategoryCombobox } from "../categories/CategoryCombobox";
import { Link } from "../router";
import { useWide } from "../shell/useWide";
import { pathKey, type CategoryTree } from "../categories/tree";
import categoryStyles from "../categories/categories.module.css";
import {
  cleanWords,
  MADE_LABELS,
  NO_FILTERS,
  parseSearch,
  RATING_LABELS,
  searchKey,
  SERVING_CHOICES,
  shortMinutes,
  TIME_CHOICES,
  type MadeFilter,
  type RatingFilter,
  type RecipeFilters,
} from "./filters";
import { favoritesOn, quickOn, toggleFavorites, toggleQuick } from "./library";
import { useLibrary } from "./libraryContext";
import { useHideNutrition } from "./nutritionSetting";
import listStyles from "./list.module.css";
import styles from "./recipes.module.css";

// The list's Filters (phase C13a; a panel since U13, owner's choices 2026-11-04): every way to
// narrow the list, grouped, most of them one tap each. It slides in from the side on a computer
// and up from the bottom on a phone; the list behind it follows each choice at once, and the
// button at the bottom says how many recipes are left. On a phone, which has no left panel
// (U17), it starts with the quick lists and the saved searches, one tap each.

/** One choice from a few, as a row of buttons (the one chosen pressed). */
function Choices<T extends string | number | null>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className={listStyles.group} role="group" aria-labelledby={id}>
      <h3 id={id} className={listStyles.groupTitle}>
        {label}
      </h3>
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
}: {
  label: string;
  placeholder: string;
  words: string[];
  onChange: (words: string[]) => void;
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
function CategoriesField({
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
  const phone = !useWide();

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
            {phone ? <PhoneLists filters={filters} onChange={onChange} onClose={onClose} /> : null}
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
                />
                <WordsField
                  label="Without ingredient"
                  placeholder="e.g. mushrooms"
                  words={filters.without}
                  onChange={(words) => set({ without: words })}
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
            />
            <Choices<number | null>
              label="Serves at least"
              value={filters.minServings}
              choices={[
                { value: null, label: "Any" },
                ...SERVING_CHOICES.map((count) => ({ value: count, label: String(count) })),
              ]}
              onChange={(minServings) => set({ minServings })}
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
              <div className={styles.filterChecks}>
                <label>
                  <input
                    type="checkbox"
                    checked={filters.photo}
                    onChange={(e) => set({ photo: e.target.checked })}
                  />
                  Has a photo
                </label>
                {hideNutrition ? null : (
                  <label>
                    <input
                      type="checkbox"
                      checked={filters.nutrition}
                      onChange={(e) => set({ nutrition: e.target.checked })}
                    />
                    Has nutrition
                  </label>
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
 * A phone's quick lists and saved searches (U17), which a computer has in the left panel. The
 * quick lists stay on together with the category shown, as filters do.
 */
function PhoneLists({
  filters,
  onChange,
  onClose,
}: {
  filters: RecipeFilters;
  onChange: (filters: RecipeFilters) => void;
  onClose: () => void;
}) {
  const library = useLibrary();
  const quickId = useId();
  const savedId = useId();
  const searches = library.saved.searches ?? [];
  const here = searchKey(library.query, filters);
  const madeLately = filters.made === "recent";
  const quick: { label: string; on: boolean; toggle: () => RecipeFilters }[] = [
    { label: "Favorites", on: favoritesOn(filters), toggle: () => toggleFavorites(filters) },
    {
      label: "Made lately",
      on: madeLately,
      toggle: () => ({ ...filters, made: madeLately ? "" : "recent" }),
    },
    { label: "30 minutes or less", on: quickOn(filters), toggle: () => toggleQuick(filters) },
  ];
  return (
    <>
      <div className={listStyles.group} role="group" aria-labelledby={quickId}>
        <h3 id={quickId} className={listStyles.groupTitle}>
          Quick lists
        </h3>
        <div className={listStyles.options}>
          {quick.map((item) => (
            <button
              key={item.label}
              type="button"
              className={listStyles.option}
              aria-pressed={item.on}
              onClick={() => onChange(item.toggle())}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {searches.length > 0 ? (
        <div className={listStyles.group}>
          <h3 id={savedId} className={listStyles.groupTitle}>
            Saved searches
          </h3>
          <ul className={listStyles.savedList} aria-labelledby={savedId}>
            {searches.map((s) => {
              const parsed = parseSearch(s.query);
              const shown = searchKey(parsed.q, parsed.filters) === here;
              return (
                <li key={s.id}>
                  <Link
                    href={s.query ? `/?${s.query.replace(/^\?/, "")}` : "/"}
                    className={listStyles.savedLink}
                    aria-current={shown ? "page" : undefined}
                    onClick={() => {
                      library.setChosenSearch(s.id);
                      onClose();
                    }}
                  >
                    {s.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}
