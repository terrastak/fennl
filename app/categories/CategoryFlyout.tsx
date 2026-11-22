import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import styles from "./categories.module.css";
import { parsePath, pathKey, type CategoryNode, type CategoryTree } from "./tree";

// "+ Add a category" in the recipe editor on a laptop (U27, owner's choices 2026-11-21, the
// mockup "C3"): a small panel with a box to find or add a category, the suggestions, then the
// person's categories as the left panel's tree, each with a tick and its count. Ticking adds or
// takes the recipe out at once (the chips follow); typing narrows the list to the categories whose
// path holds the words, the match in bold, with "New category" last when no category has exactly
// that name. Escape, a click outside or Tab out closes it; there's no Done, each tick is done.
// The keys: ↑ and ↓ move through the rows, Enter ticks (or makes the new category).

/** The panel's height when it can have it: room for the box, the suggestions and ten or so rows. */
const PANEL_MAX = 448;
/** Kept clear between the panel and the window's edge. */
const EDGE = 16;

interface Row {
  key: string;
  node: CategoryNode | null;
  /** A new category's path, for the New row. */
  names: string[];
  group: "suggested" | "tree" | "found" | "new";
}

/** "Fish & Seafood" with "sea" in bold, matched ignoring case. */
function withMatch(text: string, wanted: string): ReactNode {
  if (!wanted) return text;
  const at = text.toLocaleLowerCase().indexOf(wanted);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + wanted.length)}</mark>
      {text.slice(at + wanted.length)}
    </>
  );
}

export function CategoryFlyout({
  tree,
  ticked,
  suggestions,
  disabled,
  onTick,
  onCreate,
}: {
  tree: CategoryTree;
  /** The keys of the categories the recipe is in. */
  ticked: Set<string>;
  /** Suggested categories the recipe isn't in yet. */
  suggestions: CategoryNode[];
  disabled: boolean;
  onTick: (node: CategoryNode, on: boolean) => void;
  /** A category typed that doesn't exist yet ("Desserts › Pies" makes Pies inside Desserts). */
  onCreate: (names: string[]) => void;
}) {
  const id = useId();
  const [opened, setOpen] = useState(false);
  // Editing paused (a free account's save that can't go through) closes it.
  const open = opened && !disabled;
  const [query, setQuery] = useState("");
  // The row the keys are on: none until ↑ or ↓ (or the mouse) picks one.
  const [active, setActive] = useState(-1);
  // Where it opens and how tall it may be, worked out as it opens; then its height is kept while
  // typing, so the box never moves under the cursor.
  const [place, setPlace] = useState<{ up: boolean; max: number; min: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const typed = query.trim();
  const wanted = typed.toLocaleLowerCase();
  const rows: Row[] = [];
  if (!wanted) {
    for (const node of suggestions)
      rows.push({ key: `s:${node.key}`, node, names: node.names, group: "suggested" });
    for (const node of tree.nodes)
      rows.push({ key: `t:${node.key}`, node, names: node.names, group: "tree" });
  } else {
    for (const node of tree.nodes) {
      if (node.path.toLocaleLowerCase().includes(wanted))
        rows.push({ key: `f:${node.key}`, node, names: node.names, group: "found" });
    }
    const names = parsePath(typed);
    if (names && !tree.byKey.has(pathKey(names)))
      rows.push({ key: "new", node: null, names, group: "new" });
  }
  const current = Math.min(active, rows.length - 1);
  const rowId = (i: number) => `${id}-row-${i}`;
  const hasNew = rows.some((row) => row.group === "new");
  const newHint = `${id}-new-hint`;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    setActive(-1);
    setPlace(null);
    if (refocus) button.current?.focus();
  };

  // Up or down, whichever has room (up when there isn't enough below and there's more above).
  useLayoutEffect(() => {
    if (!open || place) return;
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom - EDGE;
    const above = box.top - EDGE;
    const up = below < PANEL_MAX && above > below;
    const max = Math.max(160, Math.min(PANEL_MAX, up ? above : below));
    setPlace({ up, max, min: 0 });
  }, [open, place]);

  // Once drawn with nothing typed, its height stays while typing.
  useLayoutEffect(() => {
    if (!open || !place || place.min || wanted) return;
    const height = panel.current?.offsetHeight ?? 0;
    if (height) setPlace({ ...place, min: height });
  }, [open, place, wanted]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // A click anywhere outside closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const choose = (row: Row | undefined) => {
    if (!row || disabled) return;
    if (row.node) {
      onTick(row.node, !ticked.has(row.node.key));
    } else {
      onCreate(row.names);
      setQuery("");
      setActive(-1);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(
        current < 0
          ? step > 0
            ? 0
            : rows.length - 1
          : (current + step + rows.length) % rows.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      // With no row picked, Enter only ever adds: the first match not ticked yet, else the new
      // category. It takes a category off only when ↑ or ↓ picked that row.
      if (current >= 0) choose(rows[current]);
      else if (wanted) {
        choose(
          rows.find((row) => row.node && !ticked.has(row.node.key)) ??
            rows.find((row) => row.group === "new"),
        );
      }
    }
  };

  // The active row stays in view as the keys move through a long list.
  useEffect(() => {
    if (!open || current < 0) return;
    document.getElementById(`${id}-row-${current}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, current, id]);

  const renderRow = (row: Row, i: number) => {
    const isNew = row.group === "new";
    const on = row.node ? ticked.has(row.node.key) : false;
    const depth = row.group === "tree" ? (row.node?.depth ?? 0) : 0;
    return (
      <li
        key={row.key}
        id={rowId(i)}
        role="option"
        aria-selected={on}
        aria-describedby={isNew ? newHint : undefined}
        data-active={i === current ? "" : undefined}
        className={`${styles.flyRow} ${isNew ? styles.flyNew : ""}`}
        style={depth ? ({ "--depth": depth } as CSSProperties) : undefined}
        // Keep the typing box focused while choosing with the mouse.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => i !== current && setActive(i)}
        onClick={() => {
          setActive(i);
          choose(row);
        }}
      >
        {isNew ? (
          <>
            <LaptopIcon path={LAPTOP_ICONS.plus} className={styles.flyPlus} />
            <span className={styles.flyName}>
              New category: <b>“{row.names.join(" › ")}”</b>
            </span>
          </>
        ) : (
          <>
            <span className={`${styles.flyTick} ${on ? styles.flyTickOn : ""}`} aria-hidden="true">
              {on ? <LaptopIcon path={LAPTOP_ICONS.check} /> : null}
            </span>
            <span className={styles.flyName}>
              {row.group === "tree" && row.node?.parent ? (
                <span className="visually-hidden">{row.node.parent.path} › </span>
              ) : null}
              {row.group === "tree" ? row.node?.name : withMatch(row.node?.path ?? "", wanted)}
            </span>
            <span className={styles.flyCount} aria-hidden="true">
              {row.node?.count ?? 0}
            </span>
          </>
        )}
      </li>
    );
  };

  const group = (name: string, label: string, list: [Row, number][]) =>
    list.length > 0 ? (
      <li role="presentation" className={styles.flyGroupItem}>
        <p id={`${id}-${name}`} className={styles.flyGroup} aria-hidden="true">
          {label}
        </p>
        <ul role="group" aria-labelledby={`${id}-${name}`} className={styles.flyRows}>
          {list.map(([row, i]) => renderRow(row, i))}
        </ul>
      </li>
    ) : null;

  const indexed = rows.map((row, i) => [row, i] as [Row, number]);
  const panelStyle: CSSProperties | undefined = place
    ? {
        maxHeight: `${place.max}px`,
        minHeight: wanted && place.min ? `${Math.min(place.min, place.max)}px` : undefined,
      }
    : undefined;

  return (
    <span
      ref={wrap}
      className={styles.flyWrap}
      onBlur={(event) => {
        // Tab out of the panel (or the button) closes it.
        if (open && !wrap.current?.contains(event.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={`${styles.flyButton} ${open ? styles.flyButtonOpen : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `${id}-panel` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <LaptopIcon path={LAPTOP_ICONS.plus} />
        Add a category
        <LaptopIcon path={LAPTOP_ICONS.chevron} className={styles.flyChevron} />
      </button>
      {open ? (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label="Add a category"
          className={`${styles.flyPanel} ${place?.up ? styles.flyUp : ""}`}
          style={panelStyle}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            }
          }}
          // A click on the panel's own space keeps the focus in the box.
          onMouseDown={(event) => {
            if (event.target !== input.current) event.preventDefault();
          }}
        >
          <span className={styles.flyFind}>
            <LaptopIcon path={LAPTOP_ICONS.search} />
            <input
              ref={input}
              className={styles.flyInput}
              role="combobox"
              aria-label="Find or add a category"
              aria-autocomplete="list"
              aria-expanded={rows.length > 0}
              aria-controls={rows.length > 0 ? `${id}-list` : undefined}
              aria-activedescendant={current >= 0 ? rowId(current) : undefined}
              aria-describedby={hasNew ? newHint : undefined}
              autoComplete="off"
              placeholder="Find or add a category"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(-1);
              }}
              onKeyDown={onKeyDown}
            />
          </span>
          {rows.length > 0 ? (
            <ul
              id={`${id}-list`}
              role="listbox"
              aria-label="Categories"
              aria-multiselectable="true"
              className={styles.flyList}
            >
              {wanted ? (
                indexed.map(([row, i]) => renderRow(row, i))
              ) : (
                <>
                  {group(
                    "suggested",
                    "Suggested from similar recipes",
                    indexed.filter(([row]) => row.group === "suggested"),
                  )}
                  {group(
                    "tree",
                    "Your categories",
                    indexed.filter(([row]) => row.group === "tree"),
                  )}
                </>
              )}
            </ul>
          ) : null}
          {hasNew ? (
            <p id={newHint} className={styles.flyNewHint}>
              For one inside another: Desserts › Cakes
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
