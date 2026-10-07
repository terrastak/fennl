import { and, count, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { deviceLabel } from "../../shared/devices";
import {
  FEEDBACK_STATUSES,
  MAX_FEEDBACK_LENGTH,
  type FeedbackChange,
  type FeedbackFilter,
  type FeedbackInbox,
  type FeedbackItem,
  type NewFeedback,
} from "../../shared/feedback";
import type { SQLiteColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import type { Database } from "../db/client";
import { feedback, user } from "../db/schema";

// Feedback from the app and the admin inbox (phase B8). The routes are in ./routes.ts.

const MAX_PAGE_LENGTH = 200;
const MAX_VERSION_LENGTH = 40;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_NOTE_LENGTH = 2000;

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

/** What the app sent, checked. Null when there's no message or it's too long. */
export function parseFeedback(input: unknown): NewFeedback | null {
  const body = (input ?? {}) as Record<string, unknown>;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_FEEDBACK_LENGTH) return null;
  const page = shortText(body.page, MAX_PAGE_LENGTH);
  return {
    message,
    // Only a path in the app, never an address elsewhere.
    page: page?.startsWith("/") ? page : null,
    appVersion: shortText(body.appVersion, MAX_VERSION_LENGTH),
  };
}

export async function saveFeedback(
  db: Database,
  from: { userId: string; householdId: string; userAgent: string | null },
  input: NewFeedback,
  now = new Date(),
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(feedback).values({
    id,
    userId: from.userId,
    householdId: from.householdId,
    message: input.message,
    page: input.page,
    appVersion: input.appVersion,
    device: deviceLabel(from.userAgent),
    userAgent: from.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Messages in one status, as SQL (see feedbackStatus in shared/feedback.ts). */
function inStatus(filter: FeedbackFilter): SQL | undefined {
  switch (filter) {
    case "new":
      return and(isNull(feedback.readAt), isNull(feedback.repliedAt), isNull(feedback.doneAt));
    case "read":
      return and(isNotNull(feedback.readAt), isNull(feedback.repliedAt), isNull(feedback.doneAt));
    case "replied":
      return and(isNotNull(feedback.repliedAt), isNull(feedback.doneAt));
    case "done":
      return isNotNull(feedback.doneAt);
    case "all":
      return undefined;
  }
}

interface Row {
  row: typeof feedback.$inferSelect;
  senderName: string | null;
  senderEmail: string | null;
}

function toItem({ row, senderName, senderEmail }: Row): FeedbackItem {
  return {
    id: row.id,
    message: row.message,
    page: row.page,
    appVersion: row.appVersion,
    device: row.device,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    doneAt: row.doneAt?.toISOString() ?? null,
    note: row.note,
    sender:
      senderEmail !== null ? { id: row.userId, name: senderName ?? "", email: senderEmail } : null,
  };
}

function selectItems(db: Database) {
  return db
    .select({ row: feedback, senderName: user.name, senderEmail: user.email })
    .from(feedback)
    .leftJoin(user, eq(feedback.userId, user.id));
}

/** The inbox: one status's messages, newest first, and how many each status has. */
export async function feedbackInbox(
  db: Database,
  filter: FeedbackFilter,
  limit = 200,
): Promise<FeedbackInbox> {
  const [rows, totals] = await Promise.all([
    selectItems(db).where(inStatus(filter)).orderBy(desc(feedback.createdAt)).limit(limit).all(),
    db
      .select({
        all: count(),
        new: sql<number>`sum(case when ${inStatus("new")} then 1 else 0 end)`,
        read: sql<number>`sum(case when ${inStatus("read")} then 1 else 0 end)`,
        replied: sql<number>`sum(case when ${inStatus("replied")} then 1 else 0 end)`,
        done: sql<number>`sum(case when ${inStatus("done")} then 1 else 0 end)`,
      })
      .from(feedback)
      .get(),
  ]);
  const counts = { all: totals?.all ?? 0 } as Record<FeedbackFilter, number>;
  for (const status of FEEDBACK_STATUSES) counts[status] = Number(totals?.[status] ?? 0);
  return { items: rows.map(toItem), counts };
}

export async function findFeedback(db: Database, id: string): Promise<FeedbackItem | null> {
  const row = await selectItems(db).where(eq(feedback.id, id)).get();
  return row ? toItem(row) : null;
}

/** Marks a message read the first time an admin opens it. Returns true if this was that time. */
export async function markRead(db: Database, id: string, now = new Date()): Promise<boolean> {
  const changed = await db
    .update(feedback)
    .set({ readAt: now, updatedAt: now })
    .where(and(eq(feedback.id, id), isNull(feedback.readAt)))
    .returning({ id: feedback.id })
    .all();
  return changed.length > 0;
}

/** A change from the inbox, checked. Null when it changes nothing or isn't valid. */
export function parseChange(input: unknown): FeedbackChange | null {
  const body = (input ?? {}) as Record<string, unknown>;
  const change: FeedbackChange = {};
  if (typeof body.replied === "boolean") change.replied = body.replied;
  if (typeof body.done === "boolean") change.done = body.done;
  if (body.note === null) change.note = null;
  else if (typeof body.note === "string") {
    if (body.note.length > MAX_NOTE_LENGTH) return null;
    change.note = body.note.trim() || null;
  }
  return Object.keys(change).length > 0 ? change : null;
}

/**
 * Applies a change. Replying or finishing also counts as reading. Turning "replied" or "done" on
 * when it's already on keeps the first date.
 */
export async function changeFeedback(
  db: Database,
  id: string,
  change: FeedbackChange,
  now = new Date(),
): Promise<void> {
  const keepFirst = (column: SQLiteColumn) => sql`coalesce(${column}, ${now.getTime()})`;
  const set: SQLiteUpdateSetSource<typeof feedback> = { updatedAt: now };
  if (change.replied !== undefined) {
    set.repliedAt = change.replied ? keepFirst(feedback.repliedAt) : null;
  }
  if (change.done !== undefined) set.doneAt = change.done ? keepFirst(feedback.doneAt) : null;
  if (change.replied || change.done) set.readAt = keepFirst(feedback.readAt);
  if (change.note !== undefined) set.note = change.note;
  await db.update(feedback).set(set).where(eq(feedback.id, id));
}
