import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import {
  isEmailProblem,
  type EmailDeliveryStatus,
  type EmailProblem,
} from "../../shared/emailDelivery";
import type { Database } from "../db/client";
import { emailMessage, user } from "../db/schema";
import { MAX_DETAIL_LENGTH } from "./delivery";

/**
 * What Resend's webhook events say happened to an email (phase U14). Payloads from Resend's docs
 * (https://resend.com/docs/dashboard/webhooks/event-types, checked 2026-11-04): every event is
 * `{type, created_at, data}`; email events name the email in `data.email_id`.
 */
export interface EmailEvent {
  type?: unknown;
  created_at?: unknown;
  data?: {
    email_id?: unknown;
    email?: unknown;
    origin?: unknown;
    bounce?: { type?: unknown; subType?: unknown; message?: unknown };
    failed?: { reason?: unknown };
    suppressed?: { message?: unknown };
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value.slice(0, MAX_DETAIL_LENGTH) : null;
}

/** The status an email event sets, and the mail server's reason; null for events Fennl ignores. */
export function statusFromEvent(
  event: EmailEvent,
): { status: EmailDeliveryStatus; detail: string | null } | null {
  const data = event.data ?? {};
  switch (event.type) {
    case "email.delivered":
      return { status: "delivered", detail: null };
    case "email.delivery_delayed":
      return { status: "delayed", detail: null };
    case "email.bounced": {
      const bounce = data.bounce ?? {};
      const detail = text(bounce.message);
      // A send to an address on Resend's list can come back as a bounce marked "Suppressed".
      if (bounce.subType === "Suppressed") return { status: "suppressed", detail };
      // "Permanent" is a hard bounce; "Transient" (or "Temporary") and "Undetermined" may pass.
      return { status: bounce.type === "Permanent" ? "bounced" : "soft_bounced", detail };
    }
    case "email.complained":
      return { status: "complained", detail: null };
    case "email.suppressed":
      return { status: "suppressed", detail: text(data.suppressed?.message) };
    case "email.failed":
      return { status: "failed", detail: text(data.failed?.reason) };
    default:
      return null;
  }
}

function eventTime(event: EmailEvent, now: Date): Date {
  const time = typeof event.created_at === "string" ? new Date(event.created_at) : null;
  return time && !Number.isNaN(time.getTime()) ? time : now;
}

/** True when the address is the account's current one, ignoring case. */
const isCurrentAddress = (address: string) => sql`lower(${user.email}) = ${address}`;

/**
 * Applies one verified event. Events can arrive more than once and out of order, so an email's
 * status only moves to an event newer than the one that set it, in one conditional statement.
 * Then the account's notice (`user.email_problem`) follows its current address: raised when an
 * email to it bounced, was marked as spam or was blocked, and cleared when one is delivered,
 * unless a newer email to it says otherwise. Events for emails Fennl doesn't know do nothing.
 */
export async function applyEmailEvent(
  db: Database,
  event: EmailEvent,
  now = new Date(),
): Promise<void> {
  const at = eventTime(event, now);

  if (event.type === "suppression.added") {
    const address = typeof event.data?.email === "string" ? event.data.email : null;
    if (!address) return;
    const problem: EmailProblem =
      event.data?.origin === "bounce"
        ? "bounced"
        : event.data?.origin === "complaint"
          ? "complained"
          : "suppressed";
    await db
      .update(user)
      .set({ emailProblem: problem })
      .where(isCurrentAddress(address.trim().toLowerCase()));
    return;
  }

  const outcome = statusFromEvent(event);
  const providerId = event.data?.email_id;
  if (!outcome || typeof providerId !== "string" || !providerId) return;

  const [updated] = await db
    .update(emailMessage)
    .set({ status: outcome.status, statusAt: at, detail: outcome.detail })
    .where(
      and(
        eq(emailMessage.providerId, providerId),
        // Newer than the event that set the status; the same moment only for another status, so
        // a repeated event changes nothing.
        or(
          lt(emailMessage.statusAt, at),
          and(eq(emailMessage.statusAt, at), ne(emailMessage.status, outcome.status)),
        ),
      ),
    )
    .returning({ userId: emailMessage.userId, toAddress: emailMessage.toAddress })
    .all();
  if (!updated) return;

  const newer = (statuses: readonly string[]) => sql`exists (
    select 1 from ${emailMessage}
    where ${emailMessage.userId} = ${updated.userId}
      and ${emailMessage.toAddress} = ${updated.toAddress}
      and ${emailMessage.status} in ${statuses}
      and ${emailMessage.statusAt} > ${at.getTime()}
  )`;

  if (isEmailProblem(outcome.status)) {
    await db
      .update(user)
      .set({ emailProblem: outcome.status })
      .where(
        and(
          eq(user.id, updated.userId),
          isCurrentAddress(updated.toAddress),
          sql`not ${newer(["delivered"])}`,
        ),
      );
  } else if (outcome.status === "delivered") {
    await db
      .update(user)
      .set({ emailProblem: null })
      .where(
        and(
          eq(user.id, updated.userId),
          isCurrentAddress(updated.toAddress),
          sql`${user.emailProblem} is not null`,
          sql`not ${newer(["bounced", "complained", "suppressed"])}`,
        ),
      );
  }
}
