import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { isQuickSearchItem, quickSearchKey, type QuickFilter } from "../../shared/quickSearches";
import type { CategoryTree } from "../categories/tree";
import { AddToQuick } from "./AddToQuick";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import { CategoriesField } from "./FiltersPanel";
import {
  barChips,
  clearBarFilters,
  GROUP_LABELS,
  layoutBar,
  removeChip,
  unsetGroups,
  type BarChip,
  type BarGroup,
  type BarLayout,
} from "./filterBar";
import {
  cleanWords,
  MADE_LABELS,
  RATING_LABELS,
  SERVING_CHOICES,
  shortMinutes,
  TIME_CHOICES,
  type MadeFilter,
  type RatingFilter,
  type RecipeFilters,
} from "./filters";
import { useHideNutrition } from "./nutritionSetting";
import { RemoveIcon, TickIcon } from "./QuickMenu";
import { quickFiltersIn } from "./quickSearchFilters";
import styles from "./filterBar.module.css";

// The filter bar under the list's heading on a computer (U22, owner's choices 2026-11-06), in
// place of the Filters panel there (a phone keeps its sheet). What is set shows as chips, each
// with a ▾ opening its group's menu and an ✕ taking just it away; the groups not set follow as
// "Rating ▾", or fold into "+ Add filter" when that saves a line; never more than two lines, the
// last set chips folding into "+N more". The list follows each choice at once; the chips move
// into their new places only when the menu closes, so nothing jumps about under the pointer.
// Where the chips go is worked out from their measured widths (filterBar.ts layoutBar).

/** Which menu is open, and the chip it opened from (it lines up with that chip). */
interface Open {
  menu: BarGroup | "add" | "folded";
  /** The chip's `data-chip-anchor`: a set chip's key, "group:time", "add" or "folded". */
  anchor: string;
}

const RADIO_GROUPS: BarGroup[] = ["time", "rating", "made", "serves"];
const popupOf = (menu: Open["menu"]) =>
  menu === "add" || RADIO_GROUPS.includes(menu as BarGroup) ? "menu" : "dialog";

/** A chip's words for screen readers: "With lime", "Has a photo (added)". */
const chipName = (chip: BarChip) => (chip.added ? `${chip.text} (added)` : chip.text);

const NO_LAYOUT: BarLayout = { folded: [], unset: "full", lines: 0 };

export function FilterBar({
  id,
  filters,
  tree,
  pathOf,
  saved,
  onChange,
}: {
  /** For the Filters button's aria-controls. */
  id: string;
  filters: RecipeFilters;
  tree: CategoryTree | null;
  /** A category's full name from its key. */
  pathOf: (key: string) => string;
  /** The saved search the heading names, if any: what it doesn't have is marked as added. */
  saved: RecipeFilters | null;
  onChange: (filters: RecipeFilters) => void;
}) {
  const popId = useId();
  const [open, setOpen] = useState<Open | null>(null);
  // The chips as they were when the menu opened, shown until it closes (U22 rule 5).
  const [frozen, setFrozen] = useState<BarChip[] | null>(null);
  const [layout, setLayout] = useState<BarLayout>(NO_LAYOUT);
  const [width, setWidth] = useState(0);
  const [fonts, setFonts] = useState(0);
  const [problem, setProblem] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ anchor: string; group: BarGroup | null; next?: boolean } | null>(
    null,
  );

  const hasCategories = !!tree && tree.nodes.length > 0;
  const live = barChips(filters, pathOf, saved);
  const shown = frozen ?? live;
  const unset = unsetGroups(shown, hasCategories);
  const folded = new Set(layout.folded);
  const visible = shown.filter((chip) => !folded.has(chip.key));
  const foldedCount = shown.length - visible.length;

  const openMenu = (menu: Open["menu"], anchor: string) => {
    setProblem("");
    if (open && open.menu === menu && open.anchor === anchor) {
      close(true);
      return;
    }
    if (!open) setFrozen(live);
    setOpen({ menu, anchor });
  };
  // `refocus`: back to the chip, or on to what follows it ("next", leaving the menu with Tab).
  // Closed by pressing elsewhere, the chips keep their places until the press ends, so a
  // click on another chip lands on the chip that was pressed.
  const close = (refocus: boolean | "next", pointer = false) => {
    if (refocus && open) {
      focusAfter.current = {
        anchor: open.anchor,
        group: open.menu === "add" || open.menu === "folded" ? null : open.menu,
        next: refocus === "next",
      };
    }
    setOpen(null);
    if (!pointer) {
      setFrozen(null);
      return;
    }
    const release = () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      setFrozen(null);
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
  };
  const change = (next: RecipeFilters) => {
    setProblem("");
    onChange(next);
  };

  // The row's width, followed as the window changes; and again once the fonts have arrived.
  useEffect(() => {
    const row = chipsRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(row.clientWidth));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let gone = false;
    void document.fonts?.ready.then(() => {
      if (!gone) setFonts((n) => n + 1);
    });
    return () => {
      gone = true;
    };
  }, []);

  // Where the chips go, from their widths measured off screen; not while a menu is open.
  const signature = JSON.stringify([shown.map((c) => [c.key, c.text, c.added]), unset]);
  useLayoutEffect(() => {
    if (open) return;
    const row = chipsRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const widthOf = (name: string) =>
      measure.querySelector(`[data-m="${CSS.escape(name)}"]`)?.getBoundingClientRect().width ?? 0;
    const next = layoutBar({
      width: row.clientWidth,
      gap: parseFloat(getComputedStyle(row).columnGap) || 0,
      set: shown.map((chip) => ({ key: chip.key, width: widthOf(`set:${chip.key}`) })),
      unset: unset.map((group) => widthOf(`unset:${group}`)),
      add: widthOf("add"),
      more: (n) => widthOf(`more:${n}`),
    });
    setLayout((before) =>
      before.unset === next.unset &&
      before.lines === next.lines &&
      before.folded.join("\n") === next.folded.join("\n")
        ? before
        : next,
    );
    // `shown` and `unset` are in the signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, width, fonts, open]);

  // Back to the chip a menu opened from once it closes; that group's chip if the choice changed
  // it ("Time" became "1 hr or less"), else the first chip.
  useLayoutEffect(() => {
    const want = focusAfter.current;
    const wrap = wrapRef.current;
    if (!want || !wrap) return;
    focusAfter.current = null;
    const anchor = wrap.querySelector<HTMLElement>(
      `[data-chips] button[data-chip-anchor="${CSS.escape(want.anchor)}"]`,
    );
    if (anchor && want.next) {
      // What Tab would have reached after the chip: its ✕, the next chip, or Clear all.
      const buttons = [
        ...wrap.querySelectorAll<HTMLElement>("[data-chips] button, button[data-bar-clear]"),
      ];
      (buttons[buttons.indexOf(anchor) + 1] ?? anchor).focus();
      return;
    }
    const target =
      anchor ??
      (want.group
        ? wrap.querySelector<HTMLElement>(
            `[data-chips] button[data-bar-group="${CSS.escape(want.group)}"]`,
          )
        : null) ??
      wrap.querySelector<HTMLElement>("[data-chips] button[data-chip-anchor]");
    target?.focus();
  });

  // Each filter that is set, as the tick line it would add to the quick searches (U18).
  const addable = quickFiltersIn(filters).filter(isQuickSearchItem);
  const addFor = (find: (item: QuickFilter) => boolean, look: "menu" | "icon" = "menu") => {
    const item = addable.find(find);
    return item ? <AddToQuick item={item} look={look} onProblem={setProblem} /> : null;
  };
  const addWord = (filter: "with" | "without") => (word: string) => {
    const key = quickSearchKey({ type: "filter", filter, word });
    return addFor((item) => quickSearchKey(item) === key, "icon");
  };

  const chipProps = (menu: Open["menu"], anchor: string) => {
    const isOpen = open?.anchor === anchor;
    return {
      "data-chip-anchor": anchor,
      "aria-haspopup": popupOf(menu),
      "aria-expanded": isOpen,
      "aria-controls": isOpen ? popId : undefined,
    } as const;
  };

  const menu = open ? (
    <BarMenu
      key={`${open.menu}:${open.anchor}`}
      id={popId}
      open={open}
      kind={popupOf(open.menu)}
      wrapRef={wrapRef}
      chipsRef={chipsRef}
      popRef={popRef}
      onClose={close}
    >
      {open.menu === "add" ? (
        <ChoiceList
          label="Add filter"
          kind="menuitem"
          choices={unset.map((group) => ({
            key: group,
            label: GROUP_LABELS[group],
            checked: false,
            onChoose: () => openMenu(group, open.anchor),
          }))}
        />
      ) : open.menu === "folded" ? (
        <MoreList
          chips={live.filter((chip) => folded.has(chip.key))}
          onOpen={(chip) => openMenu(chip.group, open.anchor)}
          onRemove={(chip) => {
            const left = live.filter((c) => folded.has(c.key) && c.key !== chip.key);
            change(removeChip(filters, chip.key));
            if (left.length === 0) close(true);
          }}
        />
      ) : (
        <GroupMenu
          group={open.menu}
          filters={filters}
          tree={tree}
          onChange={change}
          onChosen={() => close(true)}
          addFor={addFor}
          addWord={addWord}
        />
      )}
      <p className={styles.problem} role="alert">
        {problem}
      </p>
    </BarMenu>
  ) : null;

  return (
    <div ref={wrapRef} id={id} className={styles.bar} role="group" aria-label="Filters">
      <div ref={chipsRef} className={styles.chips} data-chips="">
        {visible.map((chip) => (
          <span key={chip.key} className={chipClass(chip, open?.anchor === chip.key)} data-chip="">
            <button
              type="button"
              className={styles.main}
              data-bar-group={chip.group}
              aria-label={chipName(chip)}
              title={chip.text}
              {...chipProps(chip.group, chip.key)}
              onClick={() => openMenu(chip.group, chip.key)}
            >
              <ChipWords chip={chip} />
              <Chevron />
            </button>
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove ${chip.text}`}
              title={`Remove ${chip.text}`}
              onClick={() => {
                // The focus goes on to the next chip (or the one before), never lost.
                const at = visible.indexOf(chip);
                const after = visible[at + 1] ?? visible[at - 1];
                focusAfter.current = { anchor: after?.key ?? "", group: null };
                change(removeChip(filters, chip.key));
              }}
            >
              <RemoveIcon size={12} />
            </button>
          </span>
        ))}
        {foldedCount > 0 ? (
          <button
            type="button"
            className={singleClass(open?.anchor === "folded")}
            aria-label={`${foldedCount} more ${foldedCount === 1 ? "filter" : "filters"}`}
            {...chipProps("folded", "folded")}
            onClick={() => openMenu("folded", "folded")}
          >
            +{foldedCount} more
            <Chevron />
          </button>
        ) : null}
        {layout.unset !== "folded"
          ? unset.map((group) => (
              <button
                key={group}
                type="button"
                className={singleClass(open?.anchor === `group:${group}`)}
                data-bar-group={group}
                {...chipProps(group, `group:${group}`)}
                onClick={() => openMenu(group, `group:${group}`)}
              >
                {GROUP_LABELS[group]}
                <Chevron />
              </button>
            ))
          : null}
        {layout.unset === "folded" && unset.length > 0 ? (
          <button
            type="button"
            className={singleClass(open?.anchor === "add")}
            {...chipProps("add", "add")}
            onClick={() => openMenu("add", "add")}
          >
            <PlusIcon />
            Add filter
            <Chevron />
          </button>
        ) : null}
      </div>
      {shown.length > 0 ? (
        <button
          type="button"
          className={styles.clear}
          data-bar-clear=""
          onClick={() => {
            change(clearBarFilters(filters));
            focusAfter.current = { anchor: "", group: null };
          }}
        >
          Clear all
        </button>
      ) : null}

      {/* Every chip at its natural width, off screen, for working out where they go. */}
      <div ref={measureRef} className={styles.measure} aria-hidden="true">
        <div className={styles.measureRow}>
          {shown.map((chip) => (
            <span key={chip.key} className={chipClass(chip, false)} data-m={`set:${chip.key}`}>
              <span className={styles.main}>
                <ChipWords chip={chip} />
                <Chevron />
              </span>
              <span className={styles.remove}>
                <RemoveIcon size={12} />
              </span>
            </span>
          ))}
          {unset.map((group) => (
            <span key={group} className={singleClass(false)} data-m={`unset:${group}`}>
              {GROUP_LABELS[group]}
              <Chevron />
            </span>
          ))}
          <span className={singleClass(false)} data-m="add">
            <PlusIcon />
            Add filter
            <Chevron />
          </span>
          {shown.map((_, index) => (
            <span key={index} className={singleClass(false)} data-m={`more:${index + 1}`}>
              +{index + 1} more
              <Chevron />
            </span>
          ))}
        </div>
      </div>
      {menu}
    </div>
  );
}

const chipClass = (chip: BarChip, open: boolean) =>
  [styles.chip, styles.on, chip.added ? styles.added : "", open ? styles.open : ""]
    .filter(Boolean)
    .join(" ");

const singleClass = (open: boolean) =>
  [styles.chip, styles.single, open ? styles.open : ""].filter(Boolean).join(" ");

/** A set chip's words: the lead plain, the value bold (it alone may end in "…"). */
function ChipWords({ chip }: { chip: BarChip }) {
  return (
    <>
      {chip.added ? (
        <span className={styles.plus} aria-hidden="true">
          +
        </span>
      ) : null}
      {/* The space between them is in the text (copying it, reading it), the gap draws it. */}
      {chip.lead ? <span className={styles.lead}>{chip.lead}</span> : null}
      {chip.lead ? " " : null}
      <span className={styles.value}>{chip.value}</span>
      {chip.added ? <span className="visually-hidden"> (added)</span> : null}
    </>
  );
}

/**
 * A chip's menu, under the whole bar and lined up with its chip, so it never covers the other
 * chips. Escape closes it and goes back to the chip; a press elsewhere, or the focus moving
 * out of it, closes it too.
 */
function BarMenu({
  id,
  open,
  kind,
  wrapRef,
  chipsRef,
  popRef,
  onClose,
  children,
}: {
  id: string;
  open: Open;
  kind: "menu" | "dialog";
  wrapRef: RefObject<HTMLDivElement | null>;
  chipsRef: RefObject<HTMLDivElement | null>;
  popRef: RefObject<HTMLDivElement | null>;
  onClose: (refocus: boolean | "next", pointer?: boolean) => void;
  children: ReactNode;
}) {
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  const anchorOf = () =>
    wrapRef.current?.querySelector<HTMLElement>(
      `[data-chips] [data-chip-anchor="${CSS.escape(open.anchor)}"]`,
    ) ?? null;

  useLayoutEffect(() => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    const row = chipsRef.current;
    const anchor = anchorOf();
    const pop = popRef.current?.getBoundingClientRect();
    if (!wrap || !row || !anchor || !pop) return;
    const chip = (anchor.closest("[data-chip]") ?? anchor).getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(row).rowGap) || 0;
    setPlace({
      top: row.getBoundingClientRect().bottom - wrap.top + gap,
      left: Math.max(0, Math.min(chip.left - wrap.left, wrap.width - pop.width)),
    });
    // Placed once as it opens: the bar doesn't move while a menu is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The choice made (or the first thing in it) has the focus to start with; a category box
  // would open its list at once, so for Categories the panel itself has it.
  useEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const first =
      pop.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
      pop.querySelector<HTMLElement>('[role^="menuitem"], input, select, button');
    (first?.getAttribute("role") === "combobox" ? pop : first)?.focus({ preventScroll: true });
  }, [popRef]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || anchorOf()?.contains(target)) return;
      latest.current(false, true);
    };
    const resized = () => latest.current(false);
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", resized);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popRef]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      latest.current(true);
      return;
    }
    // Tab out of the menu carries on through the bar: back to its chip, or on to what follows.
    if (event.key === "Tab") {
      const pop = event.currentTarget;
      const target = event.target as HTMLElement;
      const tabbable = [
        ...pop.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, a[href], [tabindex]",
        ),
      ].filter(
        (el) => el.tabIndex >= 0 && !el.hasAttribute("disabled") && el.getClientRects().length > 0,
      );
      const ahead = (el: HTMLElement) =>
        !!(target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      const leaving = event.shiftKey
        ? !tabbable.some((el) => el !== target && !ahead(el) && !el.contains(target))
        : !tabbable.some((el) => el !== target && ahead(el));
      if (leaving) {
        event.preventDefault();
        latest.current(event.shiftKey ? true : "next");
      }
      return;
    }
    // Arrow keys, Home and End move between a menu's items.
    const target = event.target as HTMLElement;
    const list = target.closest('[role="menu"]');
    if (!list) return;
    const items = [...list.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const at = items.indexOf(target);
    const go = (index: number) => items[(index + items.length) % items.length]?.focus();
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(items.length - 1);
    else return;
    event.preventDefault();
  };

  const label = open.menu === "add" || open.menu === "folded" ? undefined : GROUP_LABELS[open.menu];
  return (
    <div
      ref={popRef}
      id={id}
      tabIndex={-1}
      className={`${styles.pop} ${kind === "dialog" ? styles.panel : ""}`}
      style={{ top: place?.top ?? 0, left: place?.left ?? 0 }}
      role={kind === "dialog" ? "dialog" : undefined}
      aria-label={
        kind === "dialog"
          ? open.menu === "folded"
            ? "More filters that are on"
            : label
          : undefined
      }
      data-popup-open=""
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || event.currentTarget.contains(next) || anchorOf()?.contains(next)) return;
        latest.current(false);
      }}
    >
      {children}
    </div>
  );
}

interface Choice {
  key: string;
  label: string;
  checked: boolean;
  onChoose: () => void;
}

/** A menu of choices: one checked ("radio"), or plain items. */
function ChoiceList({
  label,
  kind,
  choices,
}: {
  label: string;
  kind: "menuitemradio" | "menuitem";
  choices: Choice[];
}) {
  const id = useId();
  return (
    <>
      <p id={id} className={styles.menuLabel}>
        {label}
      </p>
      <div role="menu" aria-labelledby={id} className={styles.menuList}>
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            role={kind}
            aria-checked={kind === "menuitemradio" ? choice.checked : undefined}
            tabIndex={-1}
            className={styles.menuItem}
            onClick={choice.onChoose}
          >
            {kind === "menuitemradio" ? (
              <span className={styles.check} aria-hidden="true">
                {choice.checked ? <TickIcon size={14} /> : null}
              </span>
            ) : null}
            {choice.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** One group's menu: a list to choose from, or a small panel of boxes. */
function GroupMenu({
  group,
  filters,
  tree,
  onChange,
  onChosen,
  addFor,
  addWord,
}: {
  group: BarGroup;
  filters: RecipeFilters;
  tree: CategoryTree | null;
  onChange: (filters: RecipeFilters) => void;
  /** A choice from a list is made: the menu closes. */
  onChosen: () => void;
  addFor: (find: (item: QuickFilter) => boolean) => ReactNode;
  addWord: (filter: "with" | "without") => (word: string) => ReactNode;
}) {
  const anyId = useId();
  const [hideNutrition] = useHideNutrition();
  const set = (changes: Partial<RecipeFilters>) => onChange({ ...filters, ...changes });
  const radio = <T,>(
    label: string,
    value: T,
    choices: { value: T; label: string }[],
    add: ReactNode,
    apply: (v: T) => void,
  ) => (
    <>
      <ChoiceList
        label={label}
        kind="menuitemradio"
        choices={choices.map((choice) => ({
          key: String(choice.value),
          label: choice.label,
          checked: choice.value === value,
          onChoose: () => {
            apply(choice.value);
            onChosen();
          },
        }))}
      />
      {add ? (
        <>
          <hr className={styles.separator} />
          {add}
        </>
      ) : null}
    </>
  );

  switch (group) {
    case "time":
      return radio<number | null>(
        "Total time, up to",
        filters.maxMinutes,
        [
          { value: null, label: "Any" },
          ...TIME_CHOICES.map((m) => ({ value: m, label: `${shortMinutes(m)} or less` })),
        ],
        addFor((item) => item.filter === "time"),
        (maxMinutes) => set({ maxMinutes }),
      );
    case "rating":
      return radio<RatingFilter>(
        "Rating",
        filters.rating,
        [
          { value: "", label: "Any" },
          // In this order (keys like "5" would otherwise come first, lowest first).
          ...(["favorite", "5", "4", "3", "none"] as const).map((value) => ({
            value,
            label: RATING_LABELS[value],
          })),
        ],
        addFor((item) => item.filter === "rating" || item.filter === "favorites"),
        (rating) => set({ rating }),
      );
    case "made":
      return radio<MadeFilter>(
        "Last made",
        filters.made,
        [
          { value: "", label: "Any time" },
          ...(Object.keys(MADE_LABELS) as Exclude<MadeFilter, "">[]).map((value) => ({
            value,
            label: MADE_LABELS[value],
          })),
        ],
        addFor((item) => item.filter === "made"),
        (made) => set({ made }),
      );
    case "serves":
      return radio<number | null>(
        "Serves at least",
        filters.minServings,
        [
          { value: null, label: "Any" },
          ...SERVING_CHOICES.map((count) => ({ value: count, label: `${count} or more` })),
        ],
        addFor((item) => item.filter === "serves"),
        (minServings) => set({ minServings }),
      );
    case "ingredients":
      return (
        <>
          <WordsBox
            label="With these ingredients"
            placeholder="e.g. lime"
            words={filters.with}
            onChange={(words) => set({ with: words })}
            addFor={addWord("with")}
          />
          <hr className={styles.separator} />
          <WordsBox
            label="Without these ingredients"
            placeholder="e.g. mushrooms"
            words={filters.without}
            onChange={(words) => set({ without: words })}
            addFor={addWord("without")}
          />
          <p className={styles.hint}>
            Press Enter to add each one. A recipe needs every &ldquo;with&rdquo; ingredient and none
            of the &ldquo;without&rdquo; ones.
          </p>
        </>
      );
    case "categories": {
      const main = filters.category && filters.category !== "__unfiled" ? [filters.category] : [];
      if (!tree) return <p className={styles.hint}>Your categories are still loading.</p>;
      return (
        <div className={styles.section}>
          <CategoriesField
            label="Also in category"
            tree={tree}
            keys={filters.alsoIn}
            taken={[...main, ...filters.notIn]}
            onChange={(alsoIn) => set({ alsoIn })}
          />
          <CategoriesField
            label="Not in category"
            tree={tree}
            keys={filters.notIn}
            taken={[...main, ...filters.alsoIn]}
            onChange={(notIn) => set({ notIn })}
          />
          {main.length + filters.alsoIn.length > 1 ? (
            <fieldset className={styles.choice}>
              <legend>A recipe must be in</legend>
              <label>
                <input
                  type="radio"
                  name={anyId}
                  checked={!filters.anyCategory}
                  onChange={() => set({ anyCategory: false })}
                />
                all of these categories
              </label>
              <label>
                <input
                  type="radio"
                  name={anyId}
                  checked={filters.anyCategory}
                  onChange={() => set({ anyCategory: true })}
                />
                any of these categories
              </label>
            </fieldset>
          ) : null}
        </div>
      );
    }
    case "more":
      return (
        <div className={styles.section}>
          <MoreSource value={filters.source} onChange={(source) => set({ source })} />
          {addFor((item) => item.filter === "source")}
          <label className={styles.check2}>
            <input
              type="checkbox"
              checked={filters.photo}
              onChange={(e) => set({ photo: e.target.checked })}
            />
            Has a photo
          </label>
          {addFor((item) => item.filter === "photo")}
          {/* Nutrition hidden in Settings (phase F4): no filter for it either. */}
          {hideNutrition ? null : (
            <>
              <label className={styles.check2}>
                <input
                  type="checkbox"
                  checked={filters.nutrition}
                  onChange={(e) => set({ nutrition: e.target.checked })}
                />
                Has nutrition
              </label>
              {addFor((item) => item.filter === "nutrition")}
            </>
          )}
        </div>
      );
  }
}

function MoreSource({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        Source
      </label>
      <input
        id={id}
        type="text"
        className={styles.input}
        value={value}
        placeholder="A site, book or person"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Words for one ingredient filter: a box to add one (Enter), then each word in full with ✕. */
function WordsBox({
  label,
  placeholder,
  words,
  onChange,
  addFor,
}: {
  label: string;
  placeholder: string;
  words: string[];
  onChange: (words: string[]) => void;
  addFor: (word: string) => ReactNode;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const add = () => {
    if (!typed.trim()) return;
    onChange(cleanWords([...words, typed]));
    setTyped("");
  };
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <div className={styles.inputRow}>
        <input
          id={id}
          type="text"
          className={styles.input}
          value={typed}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={styles.soft} onClick={add} disabled={!typed.trim()}>
          <LaptopIcon path={LAPTOP_ICONS.plus} />
          Add
        </button>
      </div>
      {words.length > 0 ? (
        <ul className={styles.words} aria-label={label}>
          {words.map((word) => (
            <li key={word} className={styles.word}>
              <span className={styles.wordText}>{word}</span>
              {addFor(word)}
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Remove ${word}`}
                title={`Remove ${word}`}
                onClick={() =>
                  onChange(words.filter((w) => w.toLocaleLowerCase() !== word.toLocaleLowerCase()))
                }
              >
                <RemoveIcon size={11} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** "+N more": the set chips that didn't fit, each in full, opening its menu, with its ✕. */
function MoreList({
  chips,
  onOpen,
  onRemove,
}: {
  chips: BarChip[];
  onOpen: (chip: BarChip) => void;
  onRemove: (chip: BarChip) => void;
}) {
  return (
    <>
      <p className={styles.menuLabel}>Also on</p>
      <ul className={styles.moreList}>
        {chips.map((chip) => (
          <li key={chip.key} className={styles.moreRow}>
            <button
              type="button"
              className={styles.moreOpen}
              aria-label={chipName(chip)}
              aria-haspopup={popupOf(chip.group)}
              onClick={() => onOpen(chip)}
            >
              {chip.added ? <span aria-hidden="true">+ </span> : null}
              {chip.lead ? <span className={styles.lead}>{chip.lead} </span> : null}
              <b>{chip.value}</b>
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`Remove ${chip.text}`}
              title={`Remove ${chip.text}`}
              onClick={(event) => {
                // The focus goes on to the next one's ✕ (or the one before), never lost.
                const row = event.currentTarget.closest("li");
                const next = row?.nextElementSibling ?? row?.previousElementSibling;
                onRemove(chip);
                next?.querySelector<HTMLElement>("button:last-child")?.focus();
              }}
            >
              <RemoveIcon size={11} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Chevron() {
  return (
    <svg
      className={styles.chev}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      className={styles.plusIcon}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
