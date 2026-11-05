import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Drop } from "../categories/drop";
import {
  moveCategory,
  placeCategory,
  type CategoryNode,
  type PlanContext,
} from "../categories/tree";
import { UndoBar } from "../categories/UndoBar";
import { useUndoable } from "../categories/useUndoable";
import { usePath } from "../navigation";
import { parseSearch, searchKey, UNFILED } from "../recipes/filters";
import {
  favoritesOn,
  pickAll,
  pickCategory,
  pickedList,
  pickMadeLately,
  quickOn,
  toggleFavorites,
  toggleQuick,
} from "../recipes/library";
import { useLibrary } from "../recipes/libraryContext";
import { Link } from "../router";
import { canEdit } from "../sync/status";
import { activeSyncClient, useSyncStatus } from "../sync/useSync";
import styles from "./Library.module.css";
import { keepOpen, rememberedOpen } from "./openCategories";
import { takeSearchFocus, TYPE_EVENT } from "./typeToSearch";
import { useCategoryDrag, type DragState } from "./useCategoryDrag";

// The recipe box in the left panel on a computer (U17, owner's choices 2026-11-04): search,
// the quick lists, saved searches and every category with how many recipes it has, always in
// view and one click each. The counts follow the words searched for and the switches that are
// on; a category with nothing that matches is faint, never hidden. It shows on every page: a
// click from another page goes to the recipe list with that list picked. Categories are put in
// order by dragging them with the mouse (useCategoryDrag.ts), each move with its Undo.

/** Who is moving categories, and when. */
function planContext(): PlanContext {
  return { me: activeSyncClient()?.userId ?? "", now: Date.now() };
}

/** What the Undo bar says after a category was dragged somewhere. */
function movedMessage(node: CategoryNode, drop: Drop): string {
  if (drop.kind === "inside") return `Moved ${node.name} into ${drop.target.path}.`;
  const { parent, before } = drop.place;
  if (parent !== node.parent) {
    return `Moved ${node.name} ${parent ? `into ${parent.path}` : "to the top level"}.`;
  }
  return before ? `Moved ${node.name} before ${before.name}.` : `Moved ${node.name} to the end.`;
}

/** A row's count, said in full to screen readers ("6 recipes"). */
export function Count({ n }: { n: number | undefined }) {
  if (n === undefined) return null;
  return (
    <>
      <span className={styles.count} aria-hidden="true">
        {n}
      </span>
      <span className="visually-hidden">
        , {n} {n === 1 ? "recipe" : "recipes"}
      </span>
    </>
  );
}

/**
 * The search box: at the top of the left panel on a computer, and at the top of the recipe list
 * on a phone (with what it searches in: "Search 827 recipes", "Search in Dessert"). Typing
 * searches at once.
 */
export function LibrarySearch({
  variant = "side",
  placeholder = "Search recipes",
}: {
  variant?: "side" | "phone";
  placeholder?: string;
}) {
  const library = useLibrary();
  const id = useId();
  const box = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(library.query);

  // "/" pressed on a phone-sized page with a keyboard opens the recipe list to search there.
  useEffect(() => {
    if (variant === "phone" && takeSearchFocus()) box.current?.focus();
  }, [variant]);

  // The address changed (Back, a saved search, a link): show what it searches for.
  const { query } = library;
  const [seen, setSeen] = useState(query);
  if (seen !== query) {
    setSeen(query);
    if (text.trim() !== query.trim()) setText(query);
  }

  const type = (value: string) => {
    setText(value);
    library.show(value, library.filters, { replace: true });
  };

  // Typing on the recipe list goes straight into this box (Library's type-to-search below).
  useEffect(() => {
    const onType = (event: Event) => {
      const char = (event as CustomEvent<string>).detail;
      const input = box.current;
      if (!input || input.getClientRects().length === 0) return;
      input.focus();
      // Put in at once, caret at the end, so the next letter typed lands after it.
      const value = input.value + char;
      input.value = value;
      input.setSelectionRange(value.length, value.length);
      type(value);
    };
    window.addEventListener(TYPE_EVENT, onType);
    return () => window.removeEventListener(TYPE_EVENT, onType);
  });

  return (
    <form
      role="search"
      aria-label="Recipes"
      className={variant === "side" ? styles.search : `${styles.search} ${styles.phoneSearch}`}
      onSubmit={(event) => event.preventDefault()}
    >
      <SearchIcon />
      <label htmlFor={id} className="visually-hidden">
        Search recipes
      </label>
      <input
        ref={box}
        id={id}
        type="search"
        data-shell-search={variant === "side" ? "side" : "list"}
        data-type-to-search=""
        className={styles.field}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            type("");
          }
        }}
      />
      {text ? (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear search"
          onClick={() => {
            type("");
            box.current?.focus();
          }}
        >
          <CrossIcon />
        </button>
      ) : (
        <kbd className={styles.key} title="Press / to search">
          <span aria-hidden="true">/</span>
          <span className="visually-hidden">Press slash to search</span>
        </kbd>
      )}
    </form>
  );
}

export function Library() {
  const library = useLibrary();
  const { query, filters, counts, tree, onList } = library;
  const [open, setOpen] = useState(rememberedOpen);
  const panel = useRef<HTMLElement>(null);
  const editable = canEdit(useSyncStatus());
  const moves = useUndoable();

  // A move's Undo shows on the page it was made on; going to another page puts it away.
  const path = usePath();
  const [movedOn, setMovedOn] = useState(path);
  if (movedOn !== path) {
    setMovedOn(path);
    if (moves.done || moves.failed) moves.clear();
  }

  const searches = library.saved.searches ?? [];
  const here = searchKey(query, filters);
  const savedHere = onList
    ? searches.find((s) => {
        const parsed = parseSearch(s.query);
        return searchKey(parsed.q, parsed.filters) === here;
      })
    : undefined;
  const picked = pickedList(filters);
  // One row is the list shown: a saved search when it's exactly that, else the list or category.
  const current = (kind: "all" | "made" | string) => {
    if (!onList || savedHere) return false;
    if (kind === "all" || kind === "made") return picked.kind === kind;
    return picked.kind === "category" && picked.key === kind;
  };

  // The picked category's parents stay open, so it can be seen.
  const shownOpen = new Set(open);
  if (picked.kind === "category") {
    for (let node = tree?.byKey.get(picked.key)?.parent; node; node = node.parent) {
      shownOpen.add(node.key);
    }
  }
  const toggleOpen = (key: string) => {
    const next = new Set(shownOpen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
    keepOpen(next);
  };

  const { drag, onPointerDown } = useCategoryDrag({
    tree,
    enabled: editable,
    scroller: panel,
    onDrop: (node, drop) => {
      if (!tree) return;
      const ctx = planContext();
      const plan =
        drop.kind === "inside"
          ? moveCategory(tree, node, drop.target, ctx)
          : placeCategory(tree, node, drop.place, ctx);
      // Where it went is opened, so it can be seen there.
      const parent = drop.kind === "inside" ? drop.target : drop.place.parent;
      if (parent && !shownOpen.has(parent.key)) toggleOpen(parent.key);
      void moves.run(plan, movedMessage(node, drop));
    },
  });

  const countOf = (node: CategoryNode) => (counts ? (counts.byKey.get(node.key) ?? 0) : undefined);

  const row = (node: CategoryNode): ReactNode => {
    const n = countOf(node);
    const isOpen = shownOpen.has(node.key);
    const kids = node.children.length > 0;
    const on = current(node.key);
    const dragged = drag?.node.key === node.key;
    const into =
      drag?.check === "ok" && drag.drop?.kind === "inside" && drag.drop.target.key === node.key;
    return (
      <li key={node.key}>
        <div
          className={`${styles.catRow} ${dragged ? styles.from : ""} ${into ? styles.into : ""}`}
          style={{ "--depth": node.depth } as CSSProperties}
          data-cat-key={node.key}
        >
          {kids ? (
            <button
              type="button"
              className={styles.caret}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Hide" : "Show"} what's in ${node.name}`}
              onClick={() => toggleOpen(node.key)}
            >
              <CaretIcon open={isOpen} />
            </button>
          ) : null}
          <Link
            href={library.hrefFor(query, pickCategory(filters, node.key))}
            className={`${styles.cat} ${n === 0 && !on ? styles.none : ""}`}
            aria-current={on ? "page" : undefined}
            draggable={false}
            onPointerDown={(event) => onPointerDown(event, node)}
            onClick={() => {
              // Picking a category shows what's inside it too.
              if (kids && !isOpen) toggleOpen(node.key);
            }}
          >
            <span className={styles.name}>{node.name}</span>
            <Count n={n} />
          </Link>
        </div>
        {kids && isOpen ? <ul className={styles.list}>{node.children.map(row)}</ul> : null}
      </li>
    );
  };

  return (
    <nav
      ref={panel}
      aria-label="Recipe box"
      className={`${styles.library} ${drag ? styles.dragging : ""}`}
    >
      {onList && (library.recipes?.length ?? 0) > 0 ? (
        <a className={styles.skip} href="#recipe-results">
          Skip to recipes
        </a>
      ) : null}
      <ul className={styles.list}>
        <li>
          <Link
            href={library.hrefFor(query, pickAll(filters))}
            className={styles.tile}
            aria-current={current("all") ? "page" : undefined}
          >
            <span className={styles.icon}>
              <BookIcon />
            </span>
            <span className={styles.name}>All recipes</span>
            <Count n={counts?.all} />
          </Link>
        </li>
        <li>
          <button
            type="button"
            className={`${styles.tile} ${styles.switch}`}
            aria-pressed={onList && favoritesOn(filters)}
            onClick={() => library.show(query, toggleFavorites(filters))}
          >
            <span className={styles.icon}>
              <span className={styles.box}>
                <CheckIcon />
              </span>
            </span>
            <span className={styles.name}>Favorites</span>
            <Count n={counts?.favorites} />
          </button>
        </li>
        <li>
          <Link
            href={library.hrefFor(query, pickMadeLately(filters))}
            className={styles.tile}
            aria-current={current("made") ? "page" : undefined}
          >
            <span className={styles.icon}>
              <MadeIcon />
            </span>
            <span className={styles.name}>Made lately</span>
            <Count n={counts?.made} />
          </Link>
        </li>
        <li>
          <button
            type="button"
            className={`${styles.tile} ${styles.switch}`}
            aria-pressed={onList && quickOn(filters)}
            onClick={() => library.show(query, toggleQuick(filters))}
          >
            <span className={styles.icon}>
              <span className={styles.box}>
                <CheckIcon />
              </span>
            </span>
            <span className={styles.name}>30 minutes or less</span>
            <Count n={counts?.quick} />
          </button>
        </li>
      </ul>

      {searches.length > 0 ? (
        <>
          <h2 className={styles.heading}>Saved searches</h2>
          <ul className={styles.list}>
            {searches.map((s) => (
              <li key={s.id}>
                <Link
                  href={s.query ? `/?${s.query.replace(/^\?/, "")}` : "/"}
                  className={`${styles.cat} ${styles.saved}`}
                  aria-current={savedHere?.id === s.id ? "page" : undefined}
                  onClick={() => library.setChosenSearch(s.id)}
                >
                  <span className={styles.icon}>
                    <SearchIcon size={15} />
                  </span>
                  <span className={styles.name}>{s.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {tree && tree.roots.length > 0 ? (
        <>
          <div className={styles.headingRow}>
            <h2 className={styles.heading}>Categories</h2>
            <Link href="/categories" className={styles.edit} aria-label="Edit categories">
              Edit
            </Link>
          </div>
          <div className={styles.undo}>
            <UndoBar
              done={moves.done}
              failed={moves.failed}
              onUndo={() => void moves.undo()}
              disabled={!editable}
            />
          </div>
          {drag?.hint ? (
            <div className={styles.dragHint}>
              <p>
                <b>Between two</b> moves it there.
              </p>
              <p>
                <b>Onto one</b> puts it inside.
              </p>
            </div>
          ) : null}
          <ul className={styles.list}>
            {tree.roots.map(row)}
            {(counts?.unfiled ?? 0) > 0 || current(UNFILED) ? (
              <li>
                <Link
                  href={library.hrefFor(query, pickCategory(filters, UNFILED))}
                  className={`${styles.cat} ${styles.unfiled}`}
                  aria-current={current(UNFILED) ? "page" : undefined}
                >
                  <span className={styles.name}>Not in a category</span>
                  <Count n={counts?.unfiled} />
                </Link>
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
      {drag
        ? createPortal(<DragOverlay drag={drag} count={countOf(drag.node)} />, document.body)
        : null}
    </nav>
  );
}

/** The category lifted under the mouse, and the line where it would go. */
function DragOverlay({ drag, count }: { drag: DragState; count: number | undefined }) {
  const line = drag.check === "ok" && drag.drop?.kind === "between" ? drag.drop : null;
  const left = Math.max(drag.left, drag.x - drag.grabX + 8);
  return (
    <div aria-hidden="true">
      {line ? (
        <div
          className={styles.dropLine}
          style={
            {
              top: line.y,
              left: drag.left,
              width: drag.span,
              "--depth": line.depth,
            } as CSSProperties
          }
        />
      ) : null}
      <div
        className={styles.lifted}
        data-drag-lifted=""
        // Just under the mouse, so the row it points at stays readable.
        style={{ left, top: drag.y + 6, width: drag.span - 8 }}
      >
        <GripIcon />
        <span className={styles.liftedName}>
          {drag.node.name}
          {drag.check === "refused" ? (
            <span className={styles.liftedNo}>Can&rsquo;t go inside itself</span>
          ) : null}
        </span>
        {count !== undefined ? <span className={styles.count}>{count}</span> : null}
      </div>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="3" r="1.5" />
      <circle cx="8.5" cy="3" r="1.5" />
      <circle cx="3.5" cy="8" r="1.5" />
      <circle cx="8.5" cy="8" r="1.5" />
      <circle cx="3.5" cy="13" r="1.5" />
      <circle cx="8.5" cy="13" r="1.5" />
    </svg>
  );
}

function SvgIcon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
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

export function SearchIcon({ size = 17 }: { size?: number }) {
  return (
    <SvgIcon size={size}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </SvgIcon>
  );
}

function BookIcon() {
  return (
    <SvgIcon>
      <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" />
      <path d="M5 18a2 2 0 0 1 2-2h11" />
    </SvgIcon>
  );
}

function MadeIcon() {
  return (
    <SvgIcon>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4M9 15l2 2 4-4" />
    </SvgIcon>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      width="10"
      height="10"
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

export function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={open ? "M6 9h12l-6 7z" : "M9 6v12l7-6z"} />
    </svg>
  );
}
