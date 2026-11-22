import { partsText, type DraftPart } from "../../../shared/drafts";
import { dayText, localDay } from "../format";

// The words a draft's card says (U27 part 3, owner's choices 2026-11-21 and 22): how many there
// are, when each was last changed (and, for a recipe already in the recipe box, what changed, in
// the editor's section names), and when an untitled one was started, so two never look the same.

/** "3 drafts", "1 draft". */
export function draftsText(n: number): string {
  return `${n} ${n === 1 ? "draft" : "drafts"}`;
}

/** "today", or the day: "Nov 18" (with the year when it isn't this one). */
function whenDay(ms: number, now: Date): string {
  const day = localDay(new Date(ms));
  return day === localDay(now) ? "today" : dayText(day, now);
}

/**
 * When the draft was last changed: "Changed today", "Changed Nov 18"; for a recipe already in the
 * recipe box, what changed too: "Changed today: Ingredients, Photos".
 */
export function changedText(
  editedAt: number,
  parts: DraftPart[] | null,
  now: Date = new Date(),
): string {
  const when = `Changed ${whenDay(editedAt, now)}`;
  return parts && parts.length > 0 ? `${when}: ${partsText(parts)}` : when;
}

/** When an untitled draft was started: "Started today, 3:42 PM", "Started Nov 18, 3:42 PM". */
export function startedText(startedAt: number, now: Date = new Date(), locale?: string): string {
  const time = new Date(startedAt).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Started ${whenDay(startedAt, now)}, ${time}`;
}

/** What an untitled new recipe's card is labelled: "Untitled · 2 cups flour, 1 tsp salt…". */
export function untitledLabel(hint: string | null): string {
  return hint ? `Untitled · ${hint}` : "Untitled";
}

/**
 * A draft's name for its card's buttons, which a screen reader reads after "Continue editing" and
 * "Discard": its title, or for an untitled one its label and when it was started, so no two read
 * the same ("Untitled · 2 cups flour, 1 tsp salt…, started today, 3:42 PM").
 */
export function draftName(
  item: { title: string; untitledHint: string | null; startedAt: number },
  now: Date = new Date(),
  locale?: string,
): string {
  if (item.title) return item.title;
  const started = startedText(item.startedAt, now, locale).replace(/^Started/, "started");
  return `${untitledLabel(item.untitledHint)}, ${started}`;
}
