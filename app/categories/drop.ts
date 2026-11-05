import { checkInside, checkPlace, type CategoryNode, type CategoryTree, type Place } from "./tree";

// Where a category dragged in the left panel would land (U17, owner's choices 2026-11-04):
// between two rows moves it there, at that level; onto a row puts it inside. Worked out from the
// rows as they are on screen, so it can be tested without a browser.
//
// Between the last subcategory of an open category and the row after it, more than one level
// fits (last inside, or next a level out). The lifted row's level decides, as in an outline:
// its own level unless it's moved right (further in) or left (further out).

/** A category row as it is on screen, top to bottom. */
export interface RowBox {
  node: CategoryNode;
  top: number;
  bottom: number;
}

export type Drop =
  | {
      kind: "between";
      place: Place;
      /** Where the insertion line is drawn, and how far in (the level it goes to). */
      y: number;
      depth: number;
    }
  | { kind: "inside"; target: CategoryNode };

/** How much of a row, at its top and bottom, counts as between it and the next. */
const EDGE = 0.25;

const before = (row: RowBox): Drop => ({
  kind: "between",
  place: { parent: row.node.parent, before: row.node },
  y: row.top,
  depth: row.node.depth,
});

/**
 * Between row `above` and row `below` (none: after the last row). Usually before `below`, at its
 * level; when `above` is deeper, any level from `below`'s to `above`'s fits, and `level` picks:
 * at the end of the category at that level that `above` is in.
 */
function between(above: RowBox | undefined, below: RowBox | undefined, level: number): Drop {
  const low = below ? below.node.depth : 0;
  const high = above ? above.node.depth : 0;
  const depth = Math.min(high, Math.max(low, level));
  if (!above || depth <= low) {
    if (below) return before(below);
    return { kind: "between", place: { parent: null, before: null }, y: above?.bottom ?? 0, depth };
  }
  let last: CategoryNode = above.node;
  while (last.depth > depth && last.parent) last = last.parent;
  return { kind: "between", place: { parent: last.parent, before: null }, y: above.bottom, depth };
}

/**
 * Where a drop at height `y` would go. Between two rows it goes in the lower row's level, or, at
 * the end of a list of subcategories, at `level` if that fits there (0, the top level, if not
 * given).
 */
export function dropAt(rows: RowBox[], y: number, level = 0): Drop | null {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;
  if (y < first.top) return before(first);
  if (y >= last.bottom) return between(last, undefined, level);
  const i = rows.findIndex((row) => y >= row.top && y < row.bottom);
  const row = rows[i];
  if (!row) {
    // In a gap between rows: between the ones on either side.
    const j = rows.findIndex((r) => r.top > y);
    return between(rows[j - 1], rows[j], level);
  }
  const at = (y - row.top) / Math.max(1, row.bottom - row.top);
  if (at < EDGE) return i > 0 ? between(rows[i - 1], row, level) : before(row);
  if (at > 1 - EDGE) return between(row, rows[i + 1], level);
  return { kind: "inside", target: row.node };
}

/** Whether the dragged category can go there: "refused" into itself or what's inside it. */
export function checkDrop(tree: CategoryTree, node: CategoryNode, drop: Drop) {
  return drop.kind === "inside"
    ? checkInside(node, drop.target)
    : checkPlace(tree, node, drop.place);
}
