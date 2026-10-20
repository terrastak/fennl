import { useId, useRef, useState, type FormEvent } from "react";
import { MAX_SAVED_NAME_LENGTH } from "../../shared/savedSearch";
import { parseSearch, searchKey, type RecipeFilters } from "./filters";
import { problemText, useSavedSearches, type Outcome } from "./savedSearches";
import styles from "./recipes.module.css";

// Saved searches on the recipe list (phase C13b): choose one to see its recipes, save what the
// list is showing under a name, and rename, update or remove one. A saved search is a rule, so
// the list it shows stays current as recipes change.

type Mode = "idle" | "saving" | "renaming" | "removing";

export function SavedSearches({
  query,
  filters,
  narrowing,
  currentText,
  onApply,
}: {
  /** The words typed in search, and the filters chosen. */
  query: string;
  filters: RecipeFilters;
  /** Whether the list is narrowed at all (there is something to save). */
  narrowing: boolean;
  /** The search as an address query, to save. */
  currentText: string;
  onApply: (q: string, filters: RecipeFilters) => void;
}) {
  const { searches, save, rename, update, remove } = useSavedSearches();
  const [activeId, setActiveId] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const nameBox = useRef<HTMLInputElement>(null);

  if (searches === null) return null;
  const active = searches.find((s) => s.id === activeId) ?? null;
  const here = searchKey(query, filters);
  const same = searches.find((s) => {
    const parsed = parseSearch(s.query);
    return searchKey(parsed.q, parsed.filters) === here;
  });
  // The box names a saved search only while the list shows it. Rename and Remove act on that
  // one, or on the one chosen last if the filters have been changed since.
  const changedSinceChosen = active !== null && narrowing && same?.id !== active.id;
  const shownSearch = same ?? (changedSinceChosen ? active : null);
  if (searches.length === 0 && !narrowing) return null;

  const finish = async (run: () => Promise<Outcome>, done: (o: Outcome) => string) => {
    setBusy(true);
    const outcome = await run();
    setBusy(false);
    if (outcome.ok) {
      setMessage({ text: done(outcome), problem: false });
      setMode("idle");
      return outcome;
    }
    setMessage({ text: problemText(outcome.error), problem: true });
    return outcome;
  };

  const choose = (id: string) => {
    setMessage(null);
    setMode("idle");
    setActiveId(id);
    const chosen = searches.find((s) => s.id === id);
    if (chosen) {
      const parsed = parseSearch(chosen.query);
      onApply(parsed.q, parsed.filters);
    }
  };

  const startSaving = () => {
    setMessage(null);
    setName("");
    setMode("saving");
    setTimeout(() => nameBox.current?.focus(), 0);
  };

  const startRenaming = () => {
    setMessage(null);
    setName(shownSearch?.name ?? "");
    setMode("renaming");
    setTimeout(() => nameBox.current?.select(), 0);
  };

  const submitName = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "saving") {
      const outcome = await finish(
        () => save(name, currentText),
        (o) => `Saved “${o.ok ? (o.search?.name ?? name) : name}”.`,
      );
      if (outcome.ok && outcome.search) setActiveId(outcome.search.id);
    } else if (mode === "renaming" && shownSearch) {
      await finish(
        () => rename(shownSearch.id, name),
        (o) => `Renamed to “${o.ok ? (o.search?.name ?? name) : name}”.`,
      );
    }
  };

  return (
    <section className={styles.saved} aria-label="Saved searches">
      <div className={styles.savedRow}>
        {searches.length > 0 ? (
          <label className={styles.sort}>
            Saved searches
            <select
              className={styles.select}
              value={same?.id ?? ""}
              onChange={(e) => choose(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose a saved search…</option>
              {searches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {mode === "idle" ? (
          <div className={styles.savedActions}>
            {narrowing && !same && currentText ? (
              <button type="button" className={styles.secondary} onClick={startSaving}>
                Save this search
              </button>
            ) : null}
            {active && changedSinceChosen ? (
              <button
                type="button"
                className={styles.secondary}
                disabled={busy}
                onClick={() =>
                  void finish(
                    () => update(active.id, currentText),
                    () => `Updated “${active.name}”.`,
                  )
                }
              >
                Update “{active.name}”
              </button>
            ) : null}
            {shownSearch ? (
              <>
                <button type="button" className={styles.textButton} onClick={startRenaming}>
                  Rename
                </button>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => {
                    setMessage(null);
                    setMode("removing");
                  }}
                >
                  Remove
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === "saving" || mode === "renaming" ? (
        <form className={styles.savedForm} onSubmit={(e) => void submitName(e)}>
          <label htmlFor={nameId} className={styles.sort}>
            {mode === "saving" ? "Name this search" : "New name"}
            <input
              id={nameId}
              ref={nameBox}
              type="text"
              className={styles.filterInput}
              value={name}
              maxLength={MAX_SAVED_NAME_LENGTH}
              autoComplete="off"
              placeholder="Quick weeknight dinners"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className={styles.primary} disabled={busy || !name.trim()}>
            {mode === "saving" ? "Save" : "Rename"}
          </button>
          <button type="button" className={styles.secondary} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </form>
      ) : null}

      {mode === "removing" && shownSearch ? (
        <p className={styles.savedForm}>
          <span>Remove “{shownSearch.name}”? Your recipes aren&rsquo;t touched.</span>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={async () => {
              const id = shownSearch.id;
              const gone = shownSearch.name;
              const outcome = await finish(
                () => remove(id),
                () => `Removed “${gone}”.`,
              );
              if (outcome.ok) setActiveId("");
            }}
          >
            Remove
          </button>
          <button type="button" className={styles.secondary} onClick={() => setMode("idle")}>
            Keep it
          </button>
        </p>
      ) : null}

      <p
        className={message?.problem ? styles.error : styles.hint}
        role={message?.problem ? "alert" : "status"}
        aria-live="polite"
      >
        {message?.text ?? ""}
      </p>
    </section>
  );
}
