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

// Saved searches on the recipe list (phase C13b): a saved search is a rule, so the list it shows
// stays current as recipes change. Since U18 they are search lines among the quick searches
// (app/shell/QuickSearches.tsx, and at the top of a phone's Filters), one click each; their ✕
// deletes one. U20 (owner's choices 2026-11-05) makes the saved search's name the list's
// heading: a pencil beside it renames it in place, the heading becoming a box with Save and
// Cancel; once the list is changed the name stays; and "Save as quick search" names a new one in
// the same box. No panel opens under the header. U21 (owner's choices 2026-11-06): clicking the
// name opens the box too; a changed search shows "Edited" after its name, and its box offers
// Update (Enter), Save new quick search and Cancel (Escape) in place of the bar's buttons.

/** What the box in the heading is naming, and the button that opened it (for Cancel's focus). */
interface Naming {
  /**
   * "rename": an unchanged saved search (Save, Cancel); "change": a changed one (Update, Save new
   * quick search, Cancel); "new": Save as quick search (Save, Cancel).
   */
  kind: "rename" | "change" | "new";
  name: string;
  /** The saved search being renamed or updated. */
  id: string;
}

type FocusTarget = "pencil" | "name" | "save" | "heading";

export interface SavedSearchControls {
  /** The saved search whose name is the heading: the list is it exactly, or it changed since. */
  shown: SavedSearch | null;
  /** The list is exactly that saved search (the QUICK SEARCH label shows). */
  exact: boolean;
  /** The saved search was changed since it was picked: "Edited" shows after its name (U21). */
  edited: boolean;
  /** The heading's words for a saved search: its name as a button opening the name box (U21). */
  titleContent: ReactNode;
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
  /** The bar's button: Save as quick search, for a list that isn't a saved search. */
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
  const nameRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
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
    const input = box.current;
    if (!input) return;
    input.focus();
    // Chosen to type over, selected from the end back to the start, so a name longer than the
    // box shows its beginning rather than its end.
    input.setSelectionRange(0, input.value.length, "backward");
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
      name: nameRef,
      save: saveRef,
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
  if (searches !== null && naming && naming.kind !== "new" && naming.id !== shown?.id) {
    setNaming(null);
    if (problem) setProblem("");
  }

  if (searches === null) {
    return {
      shown: null,
      exact: false,
      edited: false,
      titleContent: null,
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

  /** The pencil and the name both open the box: Update and the rest once it changed. */
  const edit = (from: FocusTarget) => {
    if (!shown) return;
    open(changed ? "change" : "rename", shown.name, from, shown.id);
  };

  const cancel = () => {
    setNaming(null);
    setProblem("");
    focusNext.current = opener.current;
  };

  /** The name typed, or null (and the problem said) when it can't be a name. */
  const typedName = (): string | null => {
    const name = (naming?.name ?? "").trim();
    if (!name || name.length > MAX_SAVED_NAME_LENGTH) {
      setProblem(problemText("invalid_name"));
      box.current?.focus();
      return null;
    }
    return name;
  };

  /** What went wrong, said under the heading, the box keeping the focus; or the box closing. */
  const finish = (outcome: Outcome, said: string) => {
    if (!outcome.ok) {
      setProblem(problemText(outcome.error));
      box.current?.focus();
      return false;
    }
    setStatus(said);
    setProblem("");
    setNaming(null);
    focusNext.current = "heading";
    return true;
  };

  /** Save (renaming, or naming a new search), or Update for a changed one: what Enter does. */
  const submit = async () => {
    if (!naming || busy) return;
    const name = typedName();
    if (name === null) return;
    const target = naming.kind === "new" ? undefined : list.find((s) => s.id === naming.id);
    if (naming.kind !== "new" && !target) {
      setNaming(null);
      return;
    }
    if (naming.kind === "rename" && target && name === target.name) {
      cancel();
      return;
    }
    setBusy(true);
    let outcome: Outcome;
    if (naming.kind === "change" && target) {
      // Update saves the list into the search, and the name typed with it (U21).
      outcome = await update(target.id, currentText, name === target.name ? undefined : name);
    } else if (target) outcome = await rename(target.id, name);
    else outcome = await save(name, currentText);
    setBusy(false);
    const final = outcome.ok ? (outcome.search?.name ?? name) : name;
    // A new saved search is the one shown now, so its name is the heading.
    if (outcome.ok && naming.kind === "new" && outcome.search) {
      setChosenSearch(outcome.search.id);
    }
    finish(
      outcome,
      naming.kind === "new"
        ? `Saved “${final}”.`
        : naming.kind === "rename"
          ? `Renamed to “${final}”.`
          : target && final !== target.name
            ? `Updated and renamed to “${final}”.`
            : `Updated “${final}”.`,
    );
  };

  /**
   * Save new quick search (U21): the list as another saved search, with the name typed; a name
   * already used (the unchanged one, most often) takes the next free number ("Quick dinners 2").
   */
  const saveNew = async () => {
    if (!naming || busy) return;
    const typed = typedName();
    if (typed === null) return;
    const names = list.map((s) => s.name);
    const taken = names.some((n) => n.trim().toLocaleLowerCase() === typed.toLocaleLowerCase());
    const name = taken ? nextFreeName(typed, names, MAX_SAVED_NAME_LENGTH) : typed;
    setBusy(true);
    const outcome = await save(name, currentText);
    setBusy(false);
    const final = outcome.ok ? (outcome.search?.name ?? name) : name;
    if (outcome.ok && outcome.search) setChosenSearch(outcome.search.id);
    finish(outcome, taken ? `Saved as “${final}”.` : `Saved “${final}”.`);
  };

  // On the form, so Escape cancels from the buttons too, not only the box.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const updating = naming?.kind === "change";
  const nameBox = naming ? (
    <form
      className={listStyles.nameForm}
      onKeyDown={onKeyDown}
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
      />
      <span className={listStyles.nameActions}>
        <button type="submit" className={listStyles.nameSubmit} aria-disabled={busy || undefined}>
          {updating ? CHECK_ICON : null}
          {updating ? "Update" : "Save"}
          <kbd className={listStyles.key} aria-hidden="true">
            ↵
          </kbd>
        </button>
        {updating ? (
          <button
            type="button"
            className={listStyles.tool}
            aria-disabled={busy || undefined}
            onClick={() => void saveNew()}
          >
            {PLUS_ICON}
            Save new quick search
          </button>
        ) : null}
        <button type="button" className={listStyles.tool} onClick={cancel}>
          Cancel
          <kbd className={listStyles.key} aria-hidden="true">
            Esc
          </kbd>
        </button>
      </span>
    </form>
  ) : null;

  const editLabel = changed ? "Update or save as new" : "Rename this search";
  const pencil =
    shown && !naming ? (
      <button
        ref={pencilRef}
        type="button"
        className={listStyles.rename}
        aria-label={editLabel}
        title={editLabel}
        onClick={() => edit("pencil")}
      >
        {PENCIL_ICON}
      </button>
    ) : null;

  // The name itself opens the box too (U21), still read as the heading's words.
  const titleContent =
    shown && !naming ? (
      <button
        ref={nameRef}
        type="button"
        className={listStyles.titleButton}
        title={changed ? "Update or save as new" : "Rename"}
        onClick={() => edit("name")}
      >
        {shown.name}
      </button>
    ) : null;

  const buttons: ReactNode =
    !shown && offerSave && currentText ? (
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
    ) : null;

  return {
    shown,
    exact: same !== null,
    edited: changed,
    titleContent,
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

const CHECK_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

const PLUS_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);
