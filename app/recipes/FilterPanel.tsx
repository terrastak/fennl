import { useId, useState } from "react";
import { CategoryCombobox } from "../categories/CategoryCombobox";
import { pathKey, type CategoryTree } from "../categories/tree";
import categoryStyles from "../categories/categories.module.css";
import {
  cleanWords,
  MADE_LABELS,
  minutesLabel,
  SERVING_CHOICES,
  TIME_CHOICES,
  type MadeFilter,
  type RecipeFilters,
} from "./filters";
import { useHideNutrition } from "./nutritionSetting";
import styles from "./recipes.module.css";

// The list's "More filters" (phase C13a): the ways to narrow beyond words, a category and a
// rating. Every choice narrows; the list says how many recipes are left.

/** Words for the ingredient filters, shown as chips with a box to add another. */
function WordsField({
  label,
  words,
  onChange,
}: {
  label: string;
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
          placeholder="An ingredient"
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

export function FilterPanel({
  filters,
  tree,
  onChange,
}: {
  filters: RecipeFilters;
  tree: CategoryTree | null;
  onChange: (filters: RecipeFilters) => void;
}) {
  const set = (changes: Partial<RecipeFilters>) => onChange({ ...filters, ...changes });
  const anyId = useId();
  // Nutrition hidden in Settings (phase F4): no filter for it either.
  const [hideNutrition] = useHideNutrition();
  const mainCategory =
    filters.category && filters.category !== "__unfiled" ? [filters.category] : [];
  return (
    <section className={styles.filterPanel} aria-label="More filters">
      {tree && tree.nodes.length > 0 ? (
        <div className={styles.filterGroup}>
          <CategoriesField
            label="Also in category"
            tree={tree}
            keys={filters.alsoIn}
            taken={[...mainCategory, ...filters.notIn]}
            onChange={(alsoIn) => set({ alsoIn })}
          />
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
          <CategoriesField
            label="Not in category"
            tree={tree}
            keys={filters.notIn}
            taken={[...mainCategory, ...filters.alsoIn]}
            onChange={(notIn) => set({ notIn })}
          />
        </div>
      ) : null}

      <div className={styles.filterGroup}>
        <WordsField
          label="With ingredient"
          words={filters.with}
          onChange={(words) => set({ with: words })}
        />
        <WordsField
          label="Without ingredient"
          words={filters.without}
          onChange={(words) => set({ without: words })}
        />
      </div>

      <div className={styles.filterGrid}>
        <label className={styles.sort}>
          Time
          <select
            className={styles.select}
            value={filters.maxMinutes ?? ""}
            onChange={(e) => set({ maxMinutes: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Any time</option>
            {TIME_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                Up to {minutesLabel(minutes)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.sort}>
          Serves
          <select
            className={styles.select}
            value={filters.minServings ?? ""}
            onChange={(e) => set({ minServings: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Any number</option>
            {SERVING_CHOICES.map((count) => (
              <option key={count} value={count}>
                {count} or more
              </option>
            ))}
          </select>
        </label>
        <label className={styles.sort}>
          Last made
          <select
            className={styles.select}
            value={filters.made}
            onChange={(e) => set({ made: e.target.value as MadeFilter })}
          >
            <option value="">Any time</option>
            {(Object.keys(MADE_LABELS) as Exclude<MadeFilter, "">[]).map((value) => (
              <option key={value} value={value}>
                {MADE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
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
      </div>

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
    </section>
  );
}
