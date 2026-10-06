/** When a device was last used, as people read dates and times where they are. */
export function lastUsed(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
