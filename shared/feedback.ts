/**
 * Feedback from the app, and the admin console's inbox for it (phase B8). Shared by the Worker,
 * the app and the console. Dates are ISO strings.
 */

/** The longest message accepted. */
export const MAX_FEEDBACK_LENGTH = 5000;

/**
 * Where a message stands. It follows the dates: done beats replied, replied beats read, and a
 * message nobody has opened is new.
 */
export const FEEDBACK_STATUSES = ["new", "read", "replied", "done"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackFilter = FeedbackStatus | "all";

export function isFeedbackFilter(value: unknown): value is FeedbackFilter {
  return value === "all" || (FEEDBACK_STATUSES as readonly unknown[]).includes(value);
}

export function feedbackStatus(item: {
  readAt: string | null;
  repliedAt: string | null;
  doneAt: string | null;
}): FeedbackStatus {
  if (item.doneAt) return "done";
  if (item.repliedAt) return "replied";
  if (item.readAt) return "read";
  return "new";
}

/** What the app sends. The server adds who sent it, their household and their browser. */
export interface NewFeedback {
  message: string;
  /** The page they were on, for example "/settings". */
  page: string | null;
  appVersion: string | null;
}

/** One message in the admin inbox. */
export interface FeedbackItem {
  id: string;
  message: string;
  page: string | null;
  appVersion: string | null;
  /** "Safari on iPhone", from the browser's user agent. */
  device: string;
  createdAt: string;
  readAt: string | null;
  repliedAt: string | null;
  doneAt: string | null;
  /** A private note, only for admins. */
  note: string | null;
  sender: { id: string; name: string; email: string } | null;
}

export interface FeedbackInbox {
  items: FeedbackItem[];
  counts: Record<FeedbackFilter, number>;
}

/** A change from the inbox. Each field is optional; only the ones present change. */
export interface FeedbackChange {
  replied?: boolean;
  done?: boolean;
  note?: string | null;
}

/**
 * A mailto: link that opens the admin's email app with a reply to the sender: their address, a
 * subject, and their message quoted below a space for the reply. Long messages are shortened so
 * the link stays within what email apps accept.
 */
export function replyLink(item: FeedbackItem, sentOn: string): string | null {
  if (!item.sender) return null;
  const QUOTE_LIMIT = 1500;
  const text =
    item.message.length > QUOTE_LIMIT ? `${item.message.slice(0, QUOTE_LIMIT)}…` : item.message;
  const where = item.page ? ` (on ${item.page})` : "";
  const quoted = text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  const body = `Hi ${item.sender.name.trim().split(/\s+/)[0] || "there"},\n\n\n\nOn ${sentOn}${where} you wrote:\n${quoted}\n`;
  const params = new URLSearchParams({ subject: "Re: your Fennl feedback", body });
  // Email apps expect %20 for spaces, not "+".
  return `mailto:${item.sender.email}?${params.toString().replace(/\+/g, "%20")}`;
}
