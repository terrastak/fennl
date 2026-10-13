// Money as the admin console's AI imports section shows and reads it (phase E7).

export const dollars = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(2)}`;
export const centsAsDollars = (cents: number) => (cents / 100).toFixed(2);

/** "12.50" as cents, or undefined when it isn't an amount. */
export function parseDollars(text: string): number | undefined {
  const trimmed = text.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  return Math.round(Number(trimmed) * 100);
}
