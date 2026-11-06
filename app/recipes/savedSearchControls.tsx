import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { MAX_SAVED_NAME_LENGTH, type SavedSearch } from "../../shared/savedSearch";
import { parseSearch, searchKey, type RecipeFilters } from "./filters";
import { nextFreeName, type SavedShape } from "./library";
import { useLibrary } from "./libraryContext";
import { problemText, type Outcome } from "./savedSearches";
import listStyles from "./list.module.css";
import styles from "./recipes.module.css";

// Saved searches on the recipe list (phase C13b): a saved search is a rule, so the list it shows
// stays current as recipes change. Since U18 they are search lines among the quick searches
// (app/shell/QuickSearches.tsx, and at the top of a phone's Filters), one click each; their ✕
// deletes one. U20 (owner's choices 2026-11-05) makes the saved search's name the list's
// heading: a pencil beside it renames it in place, the heading becoming a box with Save and
// Cancel; once the list is changed the name stays, with "Update “name”" and "Save as new"; and
// "Save as quick search" names a new one in the same box. No panel opens under the header.

/** What the box in the heading is naming, and the button that opened it (for Cancel's focus). */
interface Naming {
  kind: "rename" | "new" | "copy";
  name: string;
  /** The saved search being renamed. */
  id: string;
}

type FocusTarget = "pencil" | "save" | "copy" | "update" | "heading";

export interface SavedSearchControls {
  /** The saved search whose name is the heading: the list is it exactly, or it changed since. */
  shown: SavedSearch | null;
  /** The list is exactly that saved search (the QUICK SEARCH label shows). */
  exact: boolean;
  /** The heading's saved search's words and filters, for the count line to mark what's added. */
  savedShape: SavedShape | null;
  /** Whether the heading is a box for a name just now. */
  naming: boolean;
  /** How tall the heading's row was as the box opened, kept while it's open (in pixels). */
  rowHeight: number | undefined;
  /** The box for a name, with Save and Cancel, in the heading's place. */
  nameBox: ReactNode;
  /** The pencil beside a saved search's name. */
  pencil: ReactNode;
  /** The bar's buttons: Update and Save as new, or Save as quick search. */
  buttons: ReactNode;
  /** What went wrong naming or updating, for the line under the heading; "" when nothing. */
  problem: string;
  /** Its id, so the box can point at it. */
  problemId: string;
  /** What happened, said aloud only. */
  status: ReactNode;
}

export function useSavedSearchControls({
  query,
  filters,
  narrowing,
  offerSave,
  currentText,
  headingRef,
  rowRef,
}: {
  /** The words typed in search, and the filters chosen. */
  query: string;
  filters: RecipeFilters;
  /** Whether the list is narrowed at all. */
  narrowing: boolean;
  /** Whether to offer "Save as quick search" (a phone doesn't for a category on its own). */
  offerSave: boolean;
  /** The search as an address query, to save. */
  currentText: string;
  /** The heading, focused once a name is saved. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** The heading's row, whose height the box keeps, so nothing below moves. */
  rowRef: RefObject<HTMLElement | null>;
}): SavedSearchControls {
  const library = useLibrary();
  const { searches, save, rename, update } = library.saved;
  const { chosenSearch, setChosenSearch } = library;
  const [naming, setNaming] = useState<Naming | null>(null);
  const [problem, setProblem] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowHeight, setRowHeight] = useState<number | undefined>(undefined);
  const problemId = useId();
  const box = useRef<HTMLInputElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const updateRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<FocusTarget>("heading");
  const focusNext = useRef<FocusTarget | null>(null);

  const list = searches ?? [];
  const here = searchKey(query, filters);
  const same =
    list.find((s) => {
      const parsed = parseSearch(s.query);
      return searchKey(parsed.q, parsed.filters) === here;
    }) ?? null;
  const active = list.find((s) => s.id === chosenSearch) ?? null;
  const changed = same === null && active !== null && narrowing;
  const shown = same ?? (changed ? active : null);

  // Being exactly a saved search (from its line, Back or a link) makes it the chosen one, so a
  // change after keeps its name as the heading.
  const sameId = same?.id ?? "";
  useEffect(() => {
    if (sameId && sameId !== chosenSearch) setChosenSearch(sameId);
  }, [sameId, chosenSearch, setChosenSearch]);

  // The box takes the focus when it opens, its name chosen to type over.
  const namingKind = naming?.kind ?? null;
  useEffect(() => {
    if (!namingKind) return;
    box.current?.focus();
    box.current?.select();
  }, [namingKind]);

  // Where the focus goes once the box closes or a button goes: the heading after saving, the
  // button that opened the box after Cancel.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const element = {
      heading: headingRef,
      pencil: pencilRef,
      save: saveRef,
      copy: copyRef,
      update: updateRef,
    }[target].current;
    (element ?? headingRef.current)?.focus();
  });

  // A name being typed belongs to the list it was opened on; another list closes the box, and
  // so does the renamed search no longer being the one shown (another chosen, or deleted).
  const [seenHere, setSeenHere] = useState(here);
  if (seenHere !== here) {
    setSeenHere(here);
    if (naming && naming.kind !== "rename") setNaming(null);
    if (problem) setProblem("");
  }
  if (searches !== null && naming?.kind === "rename" && naming.id !== shown?.id) {
    setNaming(null);
    if (problem) setProblem("");
  }

  if (searches === null) {
    return {
      shown: null,
      exact: false,
      savedShape: null,
      naming: false,
      rowHeight: undefined,
      nameBox: null,
      pencil: null,
      buttons: null,
      problem: "",
      problemId,
      status: null,
    };
  }

  const open = (kind: Naming["kind"], name: string, from: FocusTarget, id = "") => {
    opener.current = from;
    // The row keeps the height it has now (a long name on two lines), so nothing below moves.
    setRowHeight(rowRef.current?.getBoundingClientRect().height);
    setProblem("");
    setStatus("");
    setNaming({ kind, name, id });
  };

  const cancel = () => {
    setNaming(null);
    setProblem("");
    focusNext.current = opener.current;
  };

  const submit = async () => {
    if (!naming || busy) return;
    const name = naming.name.trim();
    if (!name || name.length > MAX_SAVED_NAME_LENGTH) {
      setProblem(problemText("invalid_name"));
      box.current?.focus();
      return;
    }
    const renaming = naming.kind === "rename" ? list.find((s) => s.id === naming.id) : undefined;
    if (naming.kind === "rename" && !renaming) {
      setNaming(null);
      return;
    }
    if (renaming && name === renaming.name) {
      cancel();
      return;
    }
    setBusy(true);
    let outcome: Outcome;
    if (renaming) outcome = await rename(renaming.id, name);
    else outcome = await save(name, currentText);
    setBusy(false);
    if (!outcome.ok) {
      setProblem(problemText(outcome.error));
      box.current?.focus();
      return;
    }
    const final = outcome.search?.name ?? name;
    // A new saved search is the one shown now, so its name is the heading.
    if (naming.kind !== "rename" && outcome.search) setChosenSearch(outcome.search.id);
    setStatus(naming.kind === "rename" ? `Renamed to “${final}”.` : `Saved “${final}”.`);
    setProblem("");
    setNaming(null);
    focusNext.current = "heading";
  };

  const updateShown = async () => {
    if (!active || busy) return;
    setBusy(true);
    setStatus("");
    const outcome = await update(active.id, currentText);
    setBusy(false);
    if (!outcome.ok) {
      setProblem(problemText(outcome.error));
      return;
    }
    setProblem("");
    setStatus(`Updated “${active.name}”.`);
    // The button goes once the list is the saved search again.
    focusNext.current = "heading";
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const nameBox = naming ? (
    <form
      className={listStyles.nameForm}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        ref={box}
        type="text"
        className={listStyles.nameBox}
        aria-label="Name of this search"
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        value={naming.name}
        maxLength={MAX_SAVED_NAME_LENGTH}
        autoComplete="off"
        spellCheck={false}
        placeholder={naming.kind === "new" ? "Name this search" : undefined}
        onChange={(event) => {
          const name = event.target.value;
          setNaming((was) => (was ? { ...was, name } : was));
        }}
        onKeyDown={onKeyDown}
      />
      <span className={listStyles.nameActions}>
        <button
          type="submit"
          className={`${styles.primary} ${listStyles.nameButton}`}
          aria-disabled={busy || undefined}
        >
          Save
        </button>
        <button
          type="button"
          className={`${styles.secondary} ${listStyles.nameButton}`}
          onClick={cancel}
        >
          Cancel
        </button>
      </span>
    </form>
  ) : null;

  const pencil =
    shown && !naming ? (
      <button
        ref={pencilRef}
        type="button"
        className={listStyles.rename}
        aria-label="Rename this search"
        title="Rename this search"
        onClick={() => open("rename", shown.name, "pencil", shown.id)}
      >
        {PENCIL_ICON}
      </button>
    ) : null;

  let buttons: ReactNode = null;
  if (changed && active) {
    buttons = (
      <>
        <button
          ref={updateRef}
          type="button"
          className={`${listStyles.tool} ${listStyles.toolStrong}`}
          disabled={naming !== null}
          aria-disabled={busy || undefined}
          onClick={() => void updateShown()}
        >
          Update “{active.name}”
        </button>
        <button
          ref={copyRef}
          type="button"
          className={listStyles.tool}
          disabled={naming !== null}
          onClick={() =>
            open(
              "copy",
              nextFreeName(
                active.name,
                list.map((s) => s.name),
                MAX_SAVED_NAME_LENGTH,
              ),
              "copy",
            )
          }
        >
          {STAR_ICON}
          Save as new
        </button>
      </>
    );
  } else if (!shown && offerSave && currentText) {
    buttons = (
      <button
        ref={saveRef}
        type="button"
        className={listStyles.tool}
        disabled={naming !== null}
        onClick={() => open("new", "", "save")}
      >
        {STAR_ICON}
        Save as quick search
      </button>
    );
  }

  return {
    shown,
    exact: same !== null,
    savedShape: shown ? parseSearch(shown.query) : null,
    naming: naming !== null,
    rowHeight: naming ? rowHeight : undefined,
    nameBox,
    pencil,
    buttons,
    problem,
    problemId,
    status: (
      <span className="visually-hidden" role="status">
        {status}
      </span>
    ),
  };
}

const PENCIL_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />
  </svg>
);

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
