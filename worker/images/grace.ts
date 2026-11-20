import { lastEndedGrant } from "../codes/codes";
import type { Database } from "../db/client";
import type { SendEmail } from "../email/email";
import {
  photoGraceReminderEmail,
  photoGraceStartedEmail,
  type PremiumEnded,
} from "../email/templates";
import { householdEntitlements } from "../entitlements/entitlements";
import { activeHouseholdFor } from "../household/household";
import { bump, seq } from "../sync/push";

// The 90-day photo grace period (phase D3; CLAUDE.md, "Lapsed subscriptions"), checked by the
// hourly scheduled job. When someone's photos end up in a household whose plan has no photos (a
// code's Premium running out, later a lapsed subscription, or a household split), they stay
// viewable and downloadable for 90 days, with reminder emails, and are then deleted. Photos
// allowed again before then (Premium again, or a new code) end it. Recipe text is never deleted.
//
// Photos are owned per person, so the period is per person, judged by the plan of the household
// they're in now.

const DAY = 24 * 60 * 60 * 1000;

export const PHOTO_GRACE_DAYS = 90;

/** Reminders, in days left, after a notice at the start (decided 2026-10-09, spec.md D3). */
export const REMINDER_DAYS = [30, 7, 1] as const;

/** Photo rows given a new server_seq per batch when photos are deleted. */
const CHUNK = 50;

export interface GraceReport {
  started: number;
  reminded: number;
  /** Photos allowed again. */
  ended: number;
  /** People whose photos were deleted. */
  deleted: number;
}

interface Open {
  id: string;
  userId: string;
  deleteAfter: number;
  remindedDays: number;
}

/** The reminder due with this many days left, if it's later than the last one sent. */
export function reminderDue(daysLeft: number, remindedDays: number): number | null {
  const due = [...REMINDER_DAYS].reverse().find((d) => daysLeft <= d) ?? null;
  return due !== null && due < remindedDays ? due : null;
}

/**
 * Deletes a person's photos: every photo on their recipes is removed, with a new server_seq so
 * their devices drop it, then the images (purgeDeletedImages deletes the R2 objects).
 */
export async function deletePhotosOf(db: Database, userId: string, now = Date.now()) {
  const d1 = db.$client;
  for (;;) {
    const rows = await d1
      .prepare(
        "select id from recipe_photo where owner_user_id = ?1 and deleted_at is null limit 1000",
      )
      .bind(userId)
      .all<{ id: string }>();
    if (rows.results.length === 0) break;
    const ids = rows.results.map((r) => r.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      await d1.batch([
        ...chunk.map((id, k) =>
          d1
            .prepare(
              `update recipe_photo set deleted_at = ?1, updated_at = ?1,
                field_times = json_set(field_times, '$.deleted', ?1), server_seq = ${seq(k + 1)}
              where id = ?2 and deleted_at is null`,
            )
            .bind(now, id),
        ),
        d1.prepare(bump(chunk.length).sql).bind(...bump(chunk.length).params),
      ]);
    }
  }
  await d1
    .prepare("update image set deleted_at = ?1 where owner_user_id = ?2 and deleted_at is null")
    .bind(now, userId)
    .run();
}

/**
 * What a household had before its plan stopped including photos, for the emails: the free
 * Premium (from a code, or given by an admin) that ended most recently. Paid subscriptions
 * arrive in Stage I; until then anything else is "unknown".
 */
export async function premiumEnded(
  db: Database,
  householdId: string,
  now: number,
): Promise<PremiumEnded> {
  const grant = await lastEndedGrant(db, householdId, new Date(now));
  if (!grant) return { kind: "unknown" };
  return { kind: grant.source === "admin_grant" ? "admin" : "code", endedAt: grant.endedAt };
}

/**
 * Starts, reminds, ends and finishes grace periods. Looks at everyone with photos or a grace
 * period under way, which only Premium (now or before) can have. `appOrigin` is the app's own
 * address, for the emails' button to the Account page (none where it isn't known).
 */
export async function photoGracePeriods(
  db: Database,
  send: SendEmail,
  now = Date.now(),
  appOrigin: string | null = null,
): Promise<GraceReport> {
  // Each email's button carries a ref of its own, so its record shows when the person opened
  // the Account page from it, signed in (U26, POST /api/account/email-link).
  const button = () => {
    const ref = crypto.randomUUID();
    return { ref, url: appOrigin ? `${appOrigin}/account?email=${ref}` : null };
  };
  const d1 = db.$client;
  const report: GraceReport = { started: 0, reminded: 0, ended: 0, deleted: 0 };
  const [owners, opened] = await Promise.all([
    d1
      .prepare("select distinct owner_user_id as userId from image where deleted_at is null")
      .all<{ userId: string }>(),
    d1
      .prepare(
        `select id, user_id as userId, delete_after as deleteAfter, reminded_days as remindedDays
        from photo_grace where ended_at is null`,
      )
      .all<Open>(),
  ]);
  const withPhotos = new Set(owners.results.map((r) => r.userId));
  const open = new Map(opened.results.map((r) => [r.userId, r]));
  const people = [...new Set([...withPhotos, ...open.keys()])];
  const plans = new Map<string, boolean>();

  const end = (grace: Open, reason: "premium" | "deleted" | "no_photos") =>
    d1
      .prepare(
        "update photo_grace set ended_at = ?1, ended_reason = ?2 where id = ?3 and ended_at is null",
      )
      .bind(now, reason, grace.id)
      .run();

  const email = async (
    userId: string,
    message: (to: { email: string; name: string }) => Promise<unknown>,
  ) => {
    const to = await d1
      .prepare("select email, name from user where id = ?1")
      .bind(userId)
      .first<{ email: string; name: string }>();
    if (to) await message(to);
  };

  for (const userId of people) {
    try {
      const householdId = await activeHouseholdFor(db, userId);
      let allowed = plans.get(householdId);
      if (allowed === undefined) {
        allowed = (await householdEntitlements(db, householdId, new Date(now))).images_enabled;
        plans.set(householdId, allowed);
      }
      const grace = open.get(userId);

      if (allowed) {
        if (grace) {
          await end(grace, "premium");
          report.ended += 1;
        }
        continue;
      }

      if (!grace) {
        if (!withPhotos.has(userId)) continue;
        const deleteAfter = now + PHOTO_GRACE_DAYS * DAY;
        const started = await d1
          .prepare(
            `insert into photo_grace (id, user_id, started_at, delete_after, reminded_days)
            values (?1, ?2, ?3, ?4, ?5)
            on conflict do nothing
            returning id`,
          )
          .bind(crypto.randomUUID(), userId, now, deleteAfter, PHOTO_GRACE_DAYS)
          .all();
        if (started.results.length > 0) {
          report.started += 1;
          const ended = await premiumEnded(db, householdId, now);
          const link = button();
          await email(userId, (to) =>
            send({
              ...photoGraceStartedEmail(to, new Date(deleteAfter), ended, link.url),
              kind: "photo_grace_started",
              userId,
              linkRef: link.url ? link.ref : undefined,
            }),
          );
        }
        continue;
      }

      if (!withPhotos.has(userId)) {
        // They removed every photo themselves: nothing left to keep or delete.
        await end(grace, "no_photos");
        continue;
      }

      if (now >= grace.deleteAfter) {
        await deletePhotosOf(db, userId, now);
        await end(grace, "deleted");
        report.deleted += 1;
        continue;
      }

      const daysLeft = Math.ceil((grace.deleteAfter - now) / DAY);
      const due = reminderDue(daysLeft, grace.remindedDays);
      if (due === null) continue;
      // Recorded first, so a reminder is never sent twice (one that fails isn't retried).
      const marked = await d1
        .prepare(
          `update photo_grace set reminded_days = ?1
          where id = ?2 and ended_at is null and reminded_days > ?1 returning id`,
        )
        .bind(due, grace.id)
        .all();
      if (marked.results.length > 0) {
        report.reminded += 1;
        const ended = await premiumEnded(db, householdId, now);
        const link = button();
        await email(userId, (to) =>
          send({
            ...photoGraceReminderEmail(to, new Date(grace.deleteAfter), daysLeft, ended, link.url),
            kind: "photo_grace_reminder",
            userId,
            linkRef: link.url ? link.ref : undefined,
          }),
        );
      }
    } catch (error) {
      // One person's trouble (an email that won't send) doesn't stop the others.
      console.error(`Photo grace period for ${userId} failed`, error);
    }
  }
  return report;
}
