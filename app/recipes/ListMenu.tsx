import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MAX_PRINT_RECIPES } from "../../shared/print";
import { Link } from "../router";
import { recipesText } from "./library";
import listStyles from "./list.module.css";

// The recipe list's ⋯ (U13, owner's choices 2026-11-04): the things used less often than adding
// a recipe or searching, out of the way until wanted. Choosing one closes it; so do Escape and a
// tap anywhere else. U21 (owner's choices 2026-11-06): headed "These N recipes", it holds what
// acts on the recipes shown (Select recipes, Print these with how many, Surprise me), then Find
// duplicates. Categories went (the left panel's Edit opens them), and Trash moved to the left
// panel; a phone, with no left panel, keeps Trash here.

export function ListMenu({
  selecting,
  onSelect,
  onSurprise,
  onPrint,
  canSurprise,
  shown,
  trash,
}: {
  selecting: boolean;
  onSelect: () => void;
  onSurprise: () => void;
  onPrint: () => void;
  canSurprise: boolean;
  /** How many recipes the list shows; null while it's still searching. */
  shown: number | null;
  /** Whether Trash is here too (a phone's; a computer has it in the left panel). */
  trash: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const printNote = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  // A printout holds MAX_PRINT_RECIPES at most (F6), so Print these is off past that, saying so;
  // and off with nothing shown, or while the list is still searching.
  const canPrint = shown !== null && shown > 0 && shown <= MAX_PRINT_RECIPES;
  const printSide =
    shown === null
      ? "Searching…"
      : shown > MAX_PRINT_RECIPES
        ? `${MAX_PRINT_RECIPES} at most`
        : String(shown);

  return (
    // Marked while open, so typing on the list doesn't start a search behind it.
    <div ref={wrap} className={listStyles.menuWrap} data-popup-open={open || undefined}>
      <button
        ref={button}
        type="button"
        className={listStyles.iconButton}
        aria-label="More actions"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div id={menuId} className={listStyles.menu}>
          <p className={listStyles.menuHeading}>
            {shown === null
              ? "These recipes"
              : shown === 1
                ? "This 1 recipe"
                : `These ${recipesText(shown)}`}
          </p>
          <ul className={listStyles.menuList} aria-label="More actions">
            <li>
              <button type="button" className={listStyles.menuItem} onClick={choose(onSelect)}>
                {SELECT_ICON}
                {selecting ? "Done selecting" : "Select recipes…"}
              </button>
            </li>
            <li>
              <button
                type="button"
                className={listStyles.menuItem}
                disabled={!canPrint}
                aria-describedby={canPrint ? undefined : printNote}
                onClick={choose(onPrint)}
              >
                {PRINT_ICON}
                Print these
                {/* How many, beside it; when it's off, why (read out as its description). */}
                <span id={printNote} className={listStyles.menuSide} aria-hidden="true">
                  {printSide}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className={listStyles.menuItem}
                disabled={!canSurprise}
                onClick={choose(onSurprise)}
              >
                {SHUFFLE_ICON}
                Surprise me
              </button>
            </li>
            <li className={listStyles.menuSeparator}>
              <Link href="/duplicates" className={listStyles.menuItem}>
                {DUPLICATES_ICON}
                Find duplicates
              </Link>
            </li>
            {trash ? (
              <li>
                <Link href="/trash" className={listStyles.menuItem}>
                  {TRASH_ICON}
                  Trash
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className={listStyles.menuIcon}
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
      {children}
    </svg>
  );
}

const SELECT_ICON = (
  <MenuIcon>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </MenuIcon>
);

const PRINT_ICON = (
  <MenuIcon>
    <path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" />
    <path d="M7 14h10v6H7z" />
  </MenuIcon>
);

const SHUFFLE_ICON = (
  <MenuIcon>
    <path d="M16 4h4v4M4 20 20 4M20 16v4h-4M15 15l5 5M4 4l5 5" />
  </MenuIcon>
);

const DUPLICATES_ICON = (
  <MenuIcon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </MenuIcon>
);

const TRASH_ICON = (
  <MenuIcon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </MenuIcon>
);
