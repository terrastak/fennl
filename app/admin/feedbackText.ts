import type { FeedbackItem } from "../../shared/feedback";

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Where a message stands, in words: "New", "Read on Oct 7, 2026", "Replied on …", "Done on …". */
export function statusText(item: FeedbackItem): string {
  if (item.doneAt) return `Done on ${day(item.doneAt)}`;
  if (item.repliedAt) return `Replied on ${day(item.repliedAt)}`;
  if (item.readAt) return `Read on ${day(item.readAt)}`;
  return "New";
}
