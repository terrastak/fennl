import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import styles from "./quickSearches.module.css";

// The small menus of quick searches (U18): a tick line's ▾ (its choices, one checked) and
// "+ Add" (the common ones, ticked when already there). A menu in the ARIA sense: the arrow
// keys, Home and End move between its items, Escape or Tab closes it and puts the focus back on
// the button that opened it, and a press anywhere else closes it. On a computer it opens over the
// page, so the left panel never cuts it off; in the phone's Filters sheet it opens in place, as
// the rest of the page can't be reached while the sheet is open.

export interface MenuChoice {
  key: string;
  label: string;
  checked: boolean;
  onChoose: () => void;
}

export function QuickMenu({
  id,
  label,
  kind,
  choices,
  note,
  trigger,
  inline = false,
  onClose,
}: {
  id: string;
  /** What the menu is, for screen readers ("30 minutes or less: choices"). */
  label: string;
  /** "radio": one choice, and choosing closes the menu; "checkbox": each on or off, stays open. */
  kind: "radio" | "checkbox";
  choices: MenuChoice[];
  /** A line under the choices. */
  note?: ReactNode;
  /** The button that opened it: focus goes back there, and pressing it isn't "outside". */
  trigger: RefObject<HTMLElement | null>;
  /** In place (under the button, inside its wrapper) rather than over the page. */
  inline?: boolean;
  onClose: (refocus: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  // Over the page: just under the button, kept on screen.
  useLayoutEffect(() => {
    if (inline) return;
    const button = trigger.current?.getBoundingClientRect();
    const menu = box.current?.getBoundingClientRect();
    if (!button || !menu) return;
    const margin = 8;
    const left = Math.max(margin, Math.min(button.left, window.innerWidth - menu.width - margin));
    const below = button.bottom + 4;
    const top =
      below + menu.height > window.innerHeight - margin && button.top - menu.height - 4 > margin
        ? button.top - menu.height - 4
        : below;
    setPlace({ top, left });
  }, [inline, trigger]);

  // In place: moved left as far as it needs to stay inside its list of chips, so a menu from a
  // chip near the right edge never makes the sheet scroll sideways. Worked out again after every
  // change, as adding or removing a chip can move the button it opened from.
  const [shift, setShift] = useState(0);
  const ticked = choices.map((choice) => `${choice.key}:${choice.checked}`).join();
  useLayoutEffect(() => {
    if (!inline) return;
    const menu = box.current;
    const area = menu?.parentElement?.closest("ul")?.getBoundingClientRect();
    if (!menu || !area) return;
    const rect = menu.getBoundingClientRect();
    const left = rect.left - shift;
    const over = left + rect.width - area.right;
    const next = over > 0 ? -Math.min(over, Math.max(0, left - area.left)) : 0;
    if (Math.abs(next - shift) > 0.5) setShift(next);
  }, [inline, shift, ticked]);

  // The checked choice (or the first) has the focus to start with, once it's on the page.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !box.current) return;
    focused.current = true;
    const items = [...box.current.querySelectorAll<HTMLElement>("[role^=menuitem]")];
    (
      items.find((item) => item.getAttribute("aria-checked") === "true" && kind === "radio") ??
      items[0]
    )?.focus({ preventScroll: true });
  });

  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (box.current?.contains(target) || trigger.current?.contains(target)) return;
      latest.current(false);
    };
    // Over the page it would drift from its button, so scrolling anything else closes it.
    const scrolled = (event: Event) => {
      if (inline || box.current?.contains(event.target as Node)) return;
      latest.current(false);
    };
    const resized = () => {
      if (!inline) latest.current(false);
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
    };
  }, [inline, trigger]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => items[(index + items.length) % items.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        go(at + 1);
        break;
      case "ArrowUp":
        go(at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(items.length - 1);
        break;
      case "Escape":
      case "Tab":
        latest.current(true);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const menu = (
    <div
      ref={box}
      className={inline ? `${styles.menu} ${styles.menuInline}` : styles.menu}
      style={inline ? { left: shift } : { top: place?.top ?? 0, left: place?.left ?? 0 }}
      data-popup-open=""
      onKeyDown={onKeyDown}
    >
      <div id={id} role="menu" aria-label={label} className={styles.menuList}>
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            role={kind === "radio" ? "menuitemradio" : "menuitemcheckbox"}
            aria-checked={choice.checked}
            tabIndex={-1}
            className={styles.menuItem}
            onClick={() => {
              choice.onChoose();
              if (kind === "radio") latest.current(true);
            }}
          >
            <span className={styles.menuCheck} aria-hidden="true">
              {choice.checked ? <TickIcon /> : null}
            </span>
            {choice.label}
          </button>
        ))}
      </div>
      {note ? <p className={styles.menuNote}>{note}</p> : null}
    </div>
  );
  if (inline) return menu;
  // Over the page it is a region of its own, as it sits outside the page's other landmarks.
  return createPortal(
    <div role="region" aria-label={label}>
      {menu}
    </div>,
    document.body,
  );
}

export function TickIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/** The ▾ after a tick line's name. */
export function ChoicesIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 8h14l-7 9z" />
    </svg>
  );
}

/** The ✕ that removes a line. */
export function RemoveIcon({ size = 9 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
