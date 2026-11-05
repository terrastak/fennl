import { checkInside, checkPlace, type CategoryNode, type CategoryTree, type Place } from "./tree";

// Where a category dragged in the left panel would land (U17, owner's choices 2026-11-04):
// between two rows moves it there, at that level; onto a row puts it inside. Worked out from the
// rows as they are on screen, so it can be tested without a browser.

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

/** After the last row: the end of the top level. */
const atEnd = (row: RowBox): Drop => ({
  kind: "between",
  place: { parent: null, before: null },
  y: row.bottom,
  depth: 0,
});

/** Where a drop at height `y` would go. Between two rows it goes in the lower row's level. */
export function dropAt(rows: RowBox[], y: number): Drop | null {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;
  if (y < first.top) return before(first);
  if (y >= last.bottom) return atEnd(last);
  const i = rows.findIndex((row) => y >= row.top && y < row.bottom);
  const row = rows[i];
  if (!row) {
    // In a gap between rows: before the next one down.
    const next = rows.find((r) => r.top > y);
    return next ? before(next) : atEnd(last);
  }
  const at = (y - row.top) / Math.max(1, row.bottom - row.top);
  if (at < EDGE) return before(row);
  if (at > 1 - EDGE) {
    const next = rows[i + 1];
    return next ? before(next) : atEnd(row);
  }
  return { kind: "inside", target: row.node };
}

/** Whether the dragged category can go there: "refused" into itself or what's inside it. */
export function checkDrop(tree: CategoryTree, node: CategoryNode, drop: Drop) {
  return drop.kind === "inside"
    ? checkInside(node, drop.target)
    : checkPlace(tree, node, drop.place);
}
