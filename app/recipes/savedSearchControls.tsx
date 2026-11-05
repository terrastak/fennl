import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MAX_SAVED_NAME_LENGTH } from "../../shared/savedSearch";
import { parseSearch, searchKey, type RecipeFilters } from "./filters";
import { useLibrary } from "./libraryContext";
import { problemText, type Outcome } from "./savedSearches";
import listStyles from "./list.module.css";
import styles from "./recipes.module.css";

// Saved searches on the recipe list (phase C13b): choose one to see its recipes, save what the
// list is showing under a name, and rename, update or remove one. A saved search is a rule, so
// the list it shows stays current as recipes change. Since U18 they are search lines among the
// quick searches (app/shell/QuickSearches.tsx, and at the top of a phone's Filters), one click
// each, so saving one is "Save as quick search"; the list's header keeps the buttons to save,
// update, rename or remove one, and the box for a name opens under it.

type Mode = "idle" | "saving" | "renaming" | "removing";

export function useSavedSearchControls({
  query,
  filters,
  narrowing,
  currentText,
}: {
  /** The words typed in search, and the filters chosen. */
  query: string;
  filters: RecipeFilters;
  /** Whether the list is narrowed at all (there is something to save). */
  narrowing: boolean;
  /** The search as an address query, to save. */
  currentText: string;
}): { buttons: ReactNode; panel: ReactNode } {
  const library = useLibrary();
  const { searches, save, rename, update, remove } = library.saved;
  const activeId = library.chosenSearch;
  const setActiveId = library.setChosenSearch;
  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const nameBox = useRef<HTMLInputElement>(null);

  if (searches === null) return { buttons: null, panel: null };
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
  if (searches.length === 0 && !narrowing) return { buttons: null, panel: null };

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

  const offers =
    mode === "idle" &&
    ((narrowing && !same && currentText) || (active && changedSinceChosen) || shownSearch);
  const buttons = offers ? (
    <>
      {narrowing && !same && currentText ? (
        <button type="button" className={listStyles.tool} onClick={startSaving}>
          {STAR_ICON}
          Save as quick search
        </button>
      ) : null}
      {active && changedSinceChosen ? (
        <button
          type="button"
          className={listStyles.tool}
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
          <button type="button" className={listStyles.tool} onClick={startRenaming}>
            Rename “{shownSearch.name}”
          </button>
          <button
            type="button"
            className={listStyles.tool}
            onClick={() => {
              setMessage(null);
              setMode("removing");
            }}
          >
            Remove
          </button>
        </>
      ) : null}
    </>
  ) : null;

  const panel = (
    <section className={listStyles.saved} aria-label="Saved searches">
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
  return { buttons, panel };
}

const STAR_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z" />
  </svg>
);
