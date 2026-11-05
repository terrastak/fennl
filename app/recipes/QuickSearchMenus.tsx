import { useId, useRef, useState, type ReactNode } from "react";
import {
  QUICK_PRESETS,
  quickChoices,
  quickFilterLabel,
  quickSearchKey,
  type QuickFilter,
} from "../../shared/quickSearches";
import { parseSearch } from "./filters";
import { useLibrary } from "./libraryContext";
import { ChoicesIcon, QuickMenu } from "./QuickMenu";
import { quickFilterOn, turnOffQuickFilter, turnOnQuickFilter } from "./quickSearchFilters";
import { quickSearchProblem, type QuickSearchEntry } from "./quickSearches";

// The two menus of quick searches (U18), with the buttons that open them: "+ Add" (owner's
// choice 3: the common ones, ticked when already there, and a line saying anything in Filters
// can be added too) and a tick line's ▾ (choice 2: its other choices, kept with the line).

/** "+ Add" and its menu. Choosing one adds it at the end, or takes it out when it's there. */
export function QuickAddButton({
  className,
  inline = false,
  onProblem,
  children,
}: {
  className: string | undefined;
  inline?: boolean;
  onProblem: (text: string) => void;
  children: ReactNode;
}) {
  const { quick } = useLibrary();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label="Add a quick search"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-quick-add=""
        onClick={() => setOpen(!open)}
      >
        {children}
      </button>
      {open ? (
        <QuickMenu
          id={menuId}
          label="Add a quick search"
          kind="checkbox"
          inline={inline}
          trigger={button}
          choices={QUICK_PRESETS.map((preset) => ({
            key: quickSearchKey(preset),
            label: quickFilterLabel(preset),
            checked: quick.presetEntry(preset) !== null,
            onChoose: () => {
              onProblem("");
              void quick.togglePreset(preset).then((outcome) => {
                if (!outcome.ok) onProblem(quickSearchProblem(outcome.error));
              });
            },
          }))}
          note={
            <>
              Anything in <b>Filters</b> can be added too, with the <b>Add to quick searches</b>{" "}
              button beside it.
            </>
          }
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) button.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * A tick line's ▾ and its menu of choices. Choosing one changes the line (kept with the account)
 * and, when the line is on, what the list shows. `onChanged` gets the line's new key, as the line
 * is drawn again under it.
 */
export function QuickChoicesButton({
  entry,
  className,
  inline = false,
  onProblem,
  onChanged,
}: {
  entry: QuickSearchEntry;
  className: string | undefined;
  inline?: boolean;
  onProblem: (text: string) => void;
  onChanged?: (key: string) => void;
}) {
  const library = useLibrary();
  const { quick, query, filters, onList } = library;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const item = entry.item;
  if (item.type !== "filter") return null;
  const choices = quickChoices(item);
  if (choices.length === 0) return null;
  const choose = (next: QuickFilter) => {
    const nextKey = quickSearchKey(next);
    if (nextKey === entry.key) return;
    // With no connection nothing changes, the list shown included (choice 2: the shown filter
    // follows the line).
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      onProblem(quickSearchProblem("offline"));
      return;
    }
    onProblem("");
    const shown = onList && quickFilterOn(item, filters);
    if (shown) {
      library.show(query, turnOnQuickFilter(turnOffQuickFilter(filters, item), next), {
        replace: true,
      });
    }
    void quick.replace(entry.key, next).then((outcome) => {
      if (outcome.ok) return;
      onProblem(quickSearchProblem(outcome.error));
      // The line is back as it was, so the list shown goes back too, unless it has been changed
      // since. Read from the address itself: this button may be gone by now.
      if (!shown || window.location.pathname !== "/") return;
      const now = parseSearch(window.location.search);
      if (quickFilterOn(next, now.filters)) {
        library.show(now.q, turnOnQuickFilter(turnOffQuickFilter(now.filters, next), item), {
          replace: true,
        });
      }
    });
    onChanged?.(nextKey);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={`Change ${entry.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-quick-part="more"
        onClick={() => setOpen(!open)}
      >
        <ChoicesIcon />
      </button>
      {open ? (
        <QuickMenu
          id={menuId}
          label={`Choices for ${entry.label}`}
          kind="radio"
          inline={inline}
          trigger={button}
          choices={choices.map((choice) => ({
            key: quickSearchKey(choice),
            label: quickFilterLabel(choice),
            checked: quickSearchKey(choice) === entry.key,
            onChoose: () => choose(choice),
          }))}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) button.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
