/**
 * Photo order (phase D2). Each photo has a sortOrder number and the first is the cover, so moving
 * one changes only its own number: it takes a number between its new neighbours.
 */

/** The sortOrder for a photo moved to `index` among the others (in order, itself left out). */
export function orderAt(others: number[], index: number): number {
  const before = others[index - 1];
  const after = others[index];
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/** The sortOrder for a photo added after all the others. */
export function orderAfter(orders: number[]): number {
  return orders.length === 0 ? 1 : Math.max(...orders) + 1;
}
