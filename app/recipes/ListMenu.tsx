import { useEffect, useId, useRef, useState } from "react";
import { Link } from "../router";
import listStyles from "./list.module.css";

// The recipe list's ⋯ (U13, owner's choices 2026-11-04): the things used less often than adding
// a recipe or searching, out of the way until wanted. Choosing one closes it; so do Escape and a
// tap anywhere else.

export function ListMenu({
  selecting,
  onSelect,
  onSurprise,
  onPrint,
  canSurprise,
  canPrint,
}: {
  selecting: boolean;
  onSelect: () => void;
  onSurprise: () => void;
  onPrint: () => void;
  canSurprise: boolean;
  canPrint: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
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

  return (
    <div ref={wrap} className={listStyles.menuWrap}>
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
        <ul id={menuId} className={listStyles.menu} aria-label="More actions">
          <li>
            <button type="button" className={listStyles.menuItem} onClick={choose(onSelect)}>
              {selecting ? "Done selecting" : "Select recipes"}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={listStyles.menuItem}
              disabled={!canSurprise}
              onClick={choose(onSurprise)}
            >
              Surprise me
            </button>
          </li>
          <li>
            <button
              type="button"
              className={listStyles.menuItem}
              disabled={!canPrint}
              onClick={choose(onPrint)}
            >
              Print these
            </button>
          </li>
          <li className={listStyles.menuSeparator}>
            <Link href="/categories" className={listStyles.menuItem}>
              Categories
            </Link>
          </li>
          <li>
            <Link href="/duplicates" className={listStyles.menuItem}>
              Find duplicates
            </Link>
          </li>
          <li>
            <Link href="/trash" className={listStyles.menuItem}>
              Trash
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
