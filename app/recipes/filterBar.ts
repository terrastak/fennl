import {
  MADE_LABELS,
  RATING_LABELS,
  shortMinutes,
  activeFilterCount,
  type RecipeFilters,
} from "./filters";

// The filter bar under the list's heading on a computer (U22, owner's choices 2026-11-06), as
// plain data: the chips for what is set, the groups not set, what each chip's ✕ takes away, and
// how the chips fit in at most two lines. The bar itself (FilterBar.tsx) measures the chips in
// the browser and hands the widths to `layoutBar`.

/** The bar's groups, in the order they show. */
export type BarGroup =
  "time" | "rating" | "made" | "serves" | "ingredients" | "categories" | "more";

export const BAR_GROUPS: BarGroup[] = [
  "time",
  "rating",
  "made",
  "serves",
  "ingredients",
  "categories",
  "more",
];

export const GROUP_LABELS: Record<BarGroup, string> = {
  time: "Time",
  rating: "Rating",
  made: "Last made",
  serves: "Serves",
  ingredients: "Ingredients",
  categories: "Categories",
  more: "More",
};

/** One chip for something set: "With **Demerara brown sugar**". */
export interface BarChip {
  /** What its ✕ takes away (`removeChip`): "time", "with:lime", "also", "photo"... */
  key: string;
  group: BarGroup;
  /** The plain words in front ("With", "Also in"), or "". */
  lead: string;
  /** What it is set to, in bold; the only part that may end in "…". */
  value: string;
  /** Its whole words: `lead value`. */
  text: string;
  /** Not in the saved search the heading names: added since it was picked (U20, U22 rule 6). */
  added: boolean;
}

const sameWord = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
const hasWord = (words: string[], word: string) => words.some((w) => sameWord(w, word));

function chip(key: string, group: BarGroup, lead: string, value: string, added: boolean): BarChip {
  return { key, group, lead, value, text: lead ? `${lead} ${value}` : value, added };
}

/**
 * The chips for what is set beyond the category, in the groups' order: one per ingredient word
 * (each its own rule, owner's choice), one for "Also in …" and one for "Not in …" (the "all or
 * any" choice ties a side's categories together). `pathOf` gives a category's full name from its
 * key. `saved` is the saved search the heading names, if any: a chip it doesn't have is `added`.
 */
export function barChips(
  filters: RecipeFilters,
  pathOf: (key: string) => string,
  saved: RecipeFilters | null = null,
): BarChip[] {
  const chips: BarChip[] = [];
  const isNew = (had: boolean) => saved !== null && !had;
  if (filters.maxMinutes !== null) {
    chips.push(
      chip(
        "time",
        "time",
        "",
        `${shortMinutes(filters.maxMinutes)} or less`,
        isNew(saved?.maxMinutes === filters.maxMinutes),
      ),
    );
  }
  if (filters.rating) {
    chips.push(
      chip(
        "rating",
        "rating",
        "",
        RATING_LABELS[filters.rating],
        isNew(saved?.rating === filters.rating),
      ),
    );
  }
  if (filters.made) {
    chips.push(
      chip("made", "made", "", MADE_LABELS[filters.made], isNew(saved?.made === filters.made)),
    );
  }
  if (filters.minServings !== null) {
    chips.push(
      chip(
        "serves",
        "serves",
        "",
        `Serves ${filters.minServings} or more`,
        isNew(saved?.minServings === filters.minServings),
      ),
    );
  }
  for (const word of filters.with) {
    chips.push(
      chip(
        `with:${word.toLocaleLowerCase()}`,
        "ingredients",
        "With",
        word,
        isNew(hasWord(saved?.with ?? [], word)),
      ),
    );
  }
  for (const word of filters.without) {
    chips.push(
      chip(
        `without:${word.toLocaleLowerCase()}`,
        "ingredients",
        "Without",
        word,
        isNew(hasWord(saved?.without ?? [], word)),
      ),
    );
  }
  if (filters.alsoIn.length > 0) {
    const had =
      !!saved &&
      saved.anyCategory === filters.anyCategory &&
      filters.alsoIn.every((key) => saved.alsoIn.includes(key));
    chips.push(
      chip(
        "also",
        "categories",
        "Also in",
        filters.alsoIn.map(pathOf).join(filters.anyCategory ? " or " : " and "),
        isNew(had),
      ),
    );
  }
  if (filters.notIn.length > 0) {
    const had = !!saved && filters.notIn.every((key) => saved.notIn.includes(key));
    chips.push(
      chip("notin", "categories", "Not in", filters.notIn.map(pathOf).join(" or "), isNew(had)),
    );
  }
  const source = filters.source.trim();
  if (source) {
    chips.push(
      chip("source", "more", "From", source, isNew(sameWord(saved?.source.trim() ?? "", source))),
    );
  }
  if (filters.photo) chips.push(chip("photo", "more", "", "Has a photo", isNew(!!saved?.photo)));
  if (filters.nutrition) {
    chips.push(chip("nutrition", "more", "", "Has nutrition", isNew(!!saved?.nutrition)));
  }
  return chips;
}

/** The filters with one chip taken away. */
export function removeChip(filters: RecipeFilters, key: string): RecipeFilters {
  const [kind, ...rest] = key.split(":");
  const word = rest.join(":");
  switch (kind) {
    case "time":
      return { ...filters, maxMinutes: null };
    case "rating":
      return { ...filters, rating: "" };
    case "made":
      return { ...filters, made: "" };
    case "serves":
      return { ...filters, minServings: null };
    case "with":
      return { ...filters, with: filters.with.filter((w) => !sameWord(w, word)) };
    case "without":
      return { ...filters, without: filters.without.filter((w) => !sameWord(w, word)) };
    case "also":
      return { ...filters, alsoIn: [], anyCategory: false };
    case "notin":
      return { ...filters, notIn: [] };
    case "source":
      return { ...filters, source: "" };
    case "photo":
      return { ...filters, photo: false };
    case "nutrition":
      return { ...filters, nutrition: false };
    default:
      return filters;
  }
}

/** The groups with nothing set, in order; Categories only when there are categories to pick. */
export function unsetGroups(chips: BarChip[], hasCategories: boolean): BarGroup[] {
  return BAR_GROUPS.filter(
    (group) => !chips.some((c) => c.group === group) && (group !== "categories" || hasCategories),
  );
}

/** Whether anything beyond the category is set, so the bar shows on its own. */
export function barFiltersOn(filters: RecipeFilters): boolean {
  return activeFilterCount({ ...filters, category: "" }) > 0;
}

/** "Clear all": every filter goes except the category (the search words aren't filters). */
export function clearBarFilters(filters: RecipeFilters): RecipeFilters {
  return {
    category: filters.category,
    alsoIn: [],
    anyCategory: false,
    notIn: [],
    rating: "",
    maxMinutes: null,
    minServings: null,
    photo: false,
    nutrition: false,
    made: "",
    source: "",
    with: [],
    without: [],
  };
}

/**
 * How many lines chips of these widths take in a row this wide, wrapping as the browser's flex
 * wrap does (a chip wider than the row has the row to itself).
 */
export function countLines(widths: number[], width: number, gap: number): number {
  let lines = 0;
  let x = 0;
  for (const raw of widths) {
    const w = Math.min(raw, width);
    if (lines === 0) {
      lines = 1;
      x = w;
    } else if (x + gap + w <= width + 0.5) {
      x += gap + w;
    } else {
      lines++;
      x = w;
    }
  }
  return lines;
}

export interface BarMeasure {
  /** The row's width for chips (the bar less Clear all). */
  width: number;
  /** The gap between chips, across and down. */
  gap: number;
  /** Each set chip, in order. */
  set: { key: string; width: number }[];
  /** Each group not set, as its own chip ("Rating ▾"), in order. */
  unset: number[];
  /** "+ Add filter". */
  add: number;
  /** "+N more", for that many folded chips. */
  more: (n: number) => number;
  /** The chip whose menu is open: it never folds. */
  open?: string | null;
}

export interface BarLayout {
  /** Set chips folded into "+N more", in order. */
  folded: string[];
  /** The groups not set: each its own chip, folded into "+ Add filter", or none to show. */
  unset: "full" | "folded" | "none";
  lines: number;
}

/**
 * Where the chips go (U22 rules 4 and 10, bar.html's layout()): the set chips first, wrapping
 * onto as many lines as they need; then the groups not set, in full only if that adds no line,
 * otherwise folded into "+ Add filter" when that saves one; never more than two lines, the last
 * set chips (never the open one) folding into "+N more" when they need more.
 */
export function layoutBar(m: BarMeasure): BarLayout {
  const lines = (widths: number[]) => countLines(widths, m.width, m.gap);
  const setWidths = m.set.map((c) => c.width);
  let unset: BarLayout["unset"] = m.unset.length > 0 ? "full" : "none";
  if (m.set.length > 0 && m.unset.length > 0) {
    const alone = lines(setWidths);
    const all = lines([...setWidths, ...m.unset]);
    if (all > Math.max(alone, 1)) {
      const folded = lines([...setWidths, m.add]);
      unset = folded < all || all > 2 ? "folded" : "full";
    }
  }
  // Never a third line: the last set chips (never the open one) fold into "+N more". The set
  // chips get the room first, so if the groups not set in full would fold more of them, those
  // groups fold into "+ Add filter" instead.
  const fold = (mode: BarLayout["unset"]): BarLayout => {
    const tail = mode === "full" ? m.unset : mode === "folded" ? [m.add] : [];
    const folded: string[] = [];
    const candidates = m.set.filter((c) => c.key !== m.open).map((c) => c.key);
    const widths = () => {
      const shown = m.set.filter((c) => !folded.includes(c.key)).map((c) => c.width);
      return [...shown, ...(folded.length > 0 ? [m.more(folded.length)] : []), ...tail];
    };
    for (let key = candidates.pop(); key !== undefined && lines(widths()) > 2;) {
      folded.unshift(key);
      key = candidates.pop();
    }
    return { folded, unset: mode, lines: lines(widths()) };
  };
  const layout = fold(unset);
  if (unset !== "full" || layout.folded.length === 0) return layout;
  const instead = fold("folded");
  return instead.folded.length < layout.folded.length ? instead : layout;
}
