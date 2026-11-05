import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { CategoryNode } from "../categories/tree";
import { UNFILED } from "../recipes/filters";
import { listTitle, pickAll, pickCategory, pickedList } from "../recipes/library";
import { useLibrary } from "../recipes/libraryContext";
import { Link } from "../router";
import { CheckIcon, LibrarySearch } from "./Library";
import { keepOpen, rememberedOpen } from "./openCategories";
import styles from "./PhoneLibrary.module.css";

// The recipe box on a phone (U17, owner's choice 10, 2026-11-04): the search box at the top of
// the Recipes tab with Filters beside it; a sideways row of category buttons in the person's
// order, ending with "All categories", which opens every category in a sheet from the bottom;
// and, when the category shown has subcategories, a second row of them. One tap each. On a
// computer the left panel (Library.tsx) does all this, so none of it shows there.

/** How many recipes a row has, said in full to screen readers ("6 recipes"). */
function Count({ n, className }: { n: number | undefined; className: string | undefined }) {
  if (n === undefined) return null;
  return (
    <>
      <span className={className} aria-hidden="true">
        {n}
      </span>
      <span className="visually-hidden">
        , {n} {n === 1 ? "recipe" : "recipes"}
      </span>
    </>
  );
}

/** The button cut by a row's right edge, and how much of it shows. */
function cutAtEnd(row: HTMLElement) {
  const edge = row.scrollLeft + row.clientWidth;
  for (const item of row.children) {
    const { offsetLeft: left, offsetWidth: width } = item as HTMLElement;
    if (left < edge && left + width > edge) return { left, showing: edge - left };
  }
  return null;
}

/**
 * A row that scrolls sideways, fading at an edge where there's more to see, with the category
 * shown scrolled into view.
 */
function Scroller({
  children,
  className,
  shown,
  ...rest
}: {
  children: ReactNode;
  className: string | undefined;
  /** What's shown: when it changes, its button is brought into view. */
  shown: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [fade, setFade] = useState({ start: 0, end: 0 });

  // A fade only where there's more to see: on the right it runs across the button cut by the
  // edge (at most 2.5rem of it), on the left once the row has scrolled past its margin.
  const measure = useCallback(() => {
    const row = ref.current;
    if (!row) return;
    const margin = parseFloat(getComputedStyle(row).paddingLeft) || 0;
    const start = row.scrollLeft > margin + 1 ? 32 : 0;
    const more = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    const end = more ? Math.min(cutAtEnd(row)?.showing ?? 0, 40) : 0;
    setFade((was) => (was.start === start && was.end === end ? was : { start, end }));
  }, []);

  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const on = row.querySelector<HTMLElement>("[aria-current], [data-within]");
    if (on) {
      const left = on.offsetLeft;
      const right = left + on.offsetWidth;
      // Out of view, or under a fade: brought in, with a little of the one before it showing.
      if (left < row.scrollLeft + 32 || right > row.scrollLeft + row.clientWidth - 32) {
        row.scrollLeft = Math.max(0, left - row.clientWidth * 0.2);
      }
    } else {
      // From the start; but if the edge only just catches a button, the row's own margin goes,
      // so enough of it shows to see there's more.
      row.scrollLeft = 0;
      const cut = cutAtEnd(row);
      const margin = parseFloat(getComputedStyle(row).paddingLeft) || 0;
      if (cut && cut.showing < 40) row.scrollLeft = Math.min(margin, 40 - cut.showing);
    }
    measure();
  }, [shown, measure]);

  useEffect(() => {
    const row = ref.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <ul
      ref={ref}
      className={className}
      style={{ "--fade-start": `${fade.start}px`, "--fade-end": `${fade.end}px` } as CSSProperties}
      onScroll={measure}
      {...rest}
    >
      {children}
    </ul>
  );
}

export function PhoneLibrary({
  filtersOn,
  onFilters,
}: {
  /** How many filters the Filters panel has on (a category isn't one). */
  filtersOn: number;
  onFilters: () => void;
}) {
  const library = useLibrary();
  const { query, filters, tree, counts, recipes } = library;
  const [sheetOpen, setSheetOpen] = useState(false);
  const subLeadId = useId();

  const picked = pickedList(filters);
  const pickedNode =
    picked.kind === "category" && picked.key !== UNFILED ? tree?.byKey.get(picked.key) : undefined;
  const nameOf = (key: string) => tree?.byKey.get(key)?.name ?? key;
  const placeholder =
    picked.kind === "category"
      ? `Search in ${listTitle(filters, nameOf)}`
      : picked.kind === "made"
        ? "Search recipes made lately"
        : `Search ${recipes?.length ?? 0} ${recipes?.length === 1 ? "recipe" : "recipes"}`;

  // The top-level category the one shown is in, marked in the first row.
  let rootKey = "";
  for (let node = pickedNode; node; node = node.parent ?? undefined) rootKey = node.key;
  // The second row: what's inside the one shown, or, for one with nothing inside it, the
  // categories beside it in the one it's in.
  const subParent =
    pickedNode && pickedNode.children.length > 0 ? pickedNode : (pickedNode?.parent ?? undefined);

  const countOf = (node: CategoryNode) => (counts ? (counts.byKey.get(node.key) ?? 0) : undefined);
  const pill = (node: CategoryNode, sub = false) => {
    const n = countOf(node);
    const on = picked.kind === "category" && picked.key === node.key;
    const within = !on && node.key === rootKey;
    return (
      <li key={node.key}>
        <Link
          href={library.hrefFor(query, pickCategory(filters, node.key))}
          className={[
            styles.pill,
            sub ? styles.sub : "",
            within ? styles.within : "",
            n === 0 && !on ? styles.none : "",
          ].join(" ")}
          aria-current={on ? "page" : undefined}
          data-within={within || undefined}
        >
          <span>{node.name}</span>
          <Count n={n} className={styles.pillCount} />
        </Link>
      </li>
    );
  };

  const hasCategories = !!tree && tree.roots.length > 0;

  return (
    <div className={styles.box}>
      <div className={styles.searchRow}>
        <LibrarySearch variant="phone" placeholder={placeholder} />
        <button type="button" className={styles.filters} aria-haspopup="dialog" onClick={onFilters}>
          <SlidersIcon />
          Filters
          {filtersOn > 0 ? (
            <span className={styles.on}>
              {filtersOn}
              <span className="visually-hidden"> on</span>
            </span>
          ) : null}
        </button>
      </div>

      {hasCategories ? (
        <nav aria-label="Categories" className={styles.categories}>
          <div className={styles.rowWrap}>
            <Scroller className={styles.row} shown={picked.kind === "category" ? picked.key : ""}>
              {tree.roots.map((node) => pill(node))}
            </Scroller>
            <button
              type="button"
              className={styles.all}
              aria-haspopup="dialog"
              onClick={() => setSheetOpen(true)}
            >
              <ListIcon />
              All categories
            </button>
          </div>
          {subParent ? (
            <div className={styles.subRow}>
              <span id={subLeadId} className={styles.lead}>
                In {subParent.name}:
              </span>
              <Scroller
                className={`${styles.row} ${styles.subList}`}
                shown={picked.kind === "category" ? picked.key : ""}
                aria-labelledby={subLeadId}
              >
                {subParent.children.map((node) => pill(node, true))}
              </Scroller>
            </div>
          ) : null}
        </nav>
      ) : null}

      {hasCategories ? (
        <CategorySheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      ) : null}
    </div>
  );
}

/** Every category in a sheet from the bottom: All recipes first, the one shown checked. */
function CategorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const library = useLibrary();
  const { query, filters, tree, counts } = library;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [openKeys, setOpenKeys] = useState(rememberedOpen);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // Opening the sheet shows the one picked, inside whatever it's in, and what's inside it; the
  // rest open as they were left (on this device, as in the left panel on a computer).
  const picked = pickedList(filters);
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) {
      const keys = rememberedOpen();
      const node = picked.kind === "category" ? tree?.byKey.get(picked.key) : undefined;
      if (node && node.children.length > 0) keys.add(node.key);
      for (let up = node?.parent; up; up = up.parent) keys.add(up.key);
      setOpenKeys(keys);
    }
  }
  const toggle = (key: string) => {
    const next = new Set(openKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenKeys(next);
    keepOpen(next);
  };

  const row = (
    key: string,
    name: string,
    href: string,
    n: number | undefined,
    on: boolean,
    depth: number,
    extra: { node?: CategoryNode; className?: string | undefined } = {},
  ): ReactNode => {
    const kids = extra.node?.children ?? [];
    const isOpen = openKeys.has(key);
    return (
      <li key={key}>
        <div
          className={`${styles.sheetRow} ${depth > 0 ? styles.child : ""}`}
          style={{ "--depth": depth } as CSSProperties}
        >
          <Link
            href={href}
            className={[
              styles.sheetLink,
              n === 0 && !on ? styles.none : "",
              extra.className ?? "",
            ].join(" ")}
            aria-current={on ? "page" : undefined}
            onClick={onClose}
          >
            <span className={styles.sheetName}>{name}</span>
            {on ? (
              <span className={styles.check}>
                <CheckIcon />
              </span>
            ) : null}
            <Count n={n} className={styles.sheetCount} />
          </Link>
          {kids.length > 0 ? (
            <button
              type="button"
              className={styles.expand}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Hide" : "Show"} what's in ${name}`}
              onClick={() => toggle(key)}
            >
              <ChevronIcon open={isOpen} />
            </button>
          ) : (
            <span className={styles.noExpand} />
          )}
        </div>
        {kids.length > 0 && isOpen ? (
          <ul className={styles.sheetNested}>{kids.map(categoryRow)}</ul>
        ) : null}
      </li>
    );
  };

  const categoryRow = (node: CategoryNode): ReactNode =>
    row(
      node.key,
      node.name,
      library.hrefFor(query, pickCategory(filters, node.key)),
      counts ? (counts.byKey.get(node.key) ?? 0) : undefined,
      picked.kind === "category" && picked.key === node.key,
      node.depth,
      { node },
    );

  const unfiledOn = picked.kind === "category" && picked.key === UNFILED;

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the dimmed page above the sheet closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && tree ? (
        <>
          <span className={styles.grab} aria-hidden="true" />
          <div className={styles.sheetHead}>
            <h2 id={titleId} className={styles.sheetTitle}>
              Categories
            </h2>
            <button type="button" className={styles.done} onClick={onClose}>
              Done
            </button>
          </div>
          <ul className={styles.sheetList}>
            {row(
              "all",
              "All recipes",
              library.hrefFor(query, pickAll(filters)),
              counts?.all,
              picked.kind === "all",
              0,
            )}
            {tree.roots.map(categoryRow)}
            {(counts?.unfiled ?? 0) > 0 || unfiledOn
              ? row(
                  UNFILED,
                  "Not in a category",
                  library.hrefFor(query, pickCategory(filters, UNFILED)),
                  counts?.unfiled,
                  unfiledOn,
                  0,
                  { className: styles.unfiled },
                )
              : null}
          </ul>
          <div className={styles.sheetFoot}>
            <span>Tap one to show its recipes.</span>
            <Link href="/categories" className={styles.editLink}>
              Edit categories
            </Link>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

function SlidersIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={open ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} />
    </svg>
  );
}
