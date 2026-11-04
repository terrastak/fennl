import { and, desc, eq, gt, isNull, sql, type AnyColumn } from "drizzle-orm";
import { ACCOUNT_EVENT_DAYS, parseAccountEvent } from "../../shared/accountEvents";
import type { AccountRecords } from "../../shared/accountFindings";
import { EMAIL_RECORD_DAYS, isEmailProblem } from "../../shared/emailDelivery";
import { UNVERIFIED_ACCOUNT_HOURS } from "../account/purge";
import type { Database } from "../db/client";
import {
  account,
  accountEvent,
  adminAuditLog,
  adminGrant,
  adminHandled,
  device,
  emailChange,
  emailMessage,
  feedback,
  limitOverride,
  member,
  photoGrace,
  premiumGrant,
  promoCode,
  session,
  user,
} from "../db/schema";
import { manyHouseholdsEntitlements } from "../entitlements/entitlements";
import { manyHouseholdsPhotos, manyHouseholdsUsage, usageWithLimits } from "../limits/usage";
import { accountHouseholds } from "./accounts";

// Everything the admin console's account page (U15) needs about one account, read once, for
// shared/accountFindings.ts to turn into findings and "What happened". Needs attention reads
// many accounts the same way, in the same number of queries as one.

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many audit rows about an account the page reads (newest first). */
const AUDIT_ROWS = 500;

const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);

/** Everything about one account, for its page. Null when there's no such account. */
export async function gatherAccountRecords(
  db: Database,
  userId: string,
  now = Date.now(),
): Promise<AccountRecords | null> {
  return (await gatherRecords(db, [userId], now, true)).get(userId) ?? null;
}

/**
 * The records of many accounts at once, for Needs attention (U15): the same set of queries
 * whatever the number of accounts (D1 limits how many one request may make), without the admin
 * log (only the account page's history and a "worth knowing" use it). Accounts that no longer
 * exist are left out.
 */
export async function gatherAttentionRecords(
  db: Database,
  userIds: string[],
  now = Date.now(),
): Promise<Map<string, AccountRecords>> {
  return gatherRecords(db, userIds, now, false);
}

/** A condition that a column is one of the ids, with one bound value for the whole list. */
const oneOf = (column: AnyColumn, ids: string[]) =>
  sql`${column} in (select value from json_each(${JSON.stringify(ids)}))`;

/** Rows grouped by whose they are. */
function byKey<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

async function gatherRecords(
  db: Database,
  requested: string[],
  now: number,
  withAdminLog: boolean,
): Promise<Map<string, AccountRecords>> {
  const answer = new Map<string, AccountRecords>();
  const wanted = [...new Set(requested)];
  if (wanted.length === 0) return answer;
  const people = await db.select().from(user).where(oneOf(user.id, wanted)).all();
  if (people.length === 0) return answer;
  const userIds = people.map((p) => p.id);
  const households = await accountHouseholds(db, userIds);
  const householdIds = [...new Set([...households.values()].map((h) => h.id))];
  const emailsSince = new Date(now - EMAIL_RECORD_DAYS * DAY_MS);
  const eventsSince = new Date(now - ACCOUNT_EVENT_DAYS * DAY_MS);
  const at = new Date(now);

  const [
    methodRows,
    memberRows,
    codeGrantRows,
    adminGrantRows,
    deviceRows,
    sessionRows,
    emailRows,
    eventRows,
    changeRows,
    messageRows,
    graceRows,
    overrideRows,
    logRows,
    handledRows,
    plans,
    counts,
    photos,
  ] = await Promise.all([
    db
      .select({ userId: account.userId, providerId: account.providerId })
      .from(account)
      .where(oneOf(account.userId, userIds))
      .all(),
    householdIds.length > 0
      ? db
          .select({ householdId: member.organizationId, userId: user.id, name: user.name })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(oneOf(member.organizationId, householdIds))
          .all()
      : Promise.resolve([]),
    db
      .select({
        userId: premiumGrant.userId,
        id: premiumGrant.id,
        code: promoCode.code,
        tier: premiumGrant.tier,
        startsAt: premiumGrant.startsAt,
        endsAt: premiumGrant.endsAt,
        accessUntil: promoCode.accessUntil,
        revokedAt: premiumGrant.revokedAt,
        createdAt: premiumGrant.createdAt,
      })
      .from(premiumGrant)
      .innerJoin(promoCode, eq(premiumGrant.promoCodeId, promoCode.id))
      .where(oneOf(premiumGrant.userId, userIds))
      .orderBy(desc(premiumGrant.createdAt))
      .all(),
    db
      .select()
      .from(adminGrant)
      .where(oneOf(adminGrant.userId, userIds))
      .orderBy(desc(adminGrant.createdAt))
      .all(),
    db.select().from(device).where(oneOf(device.userId, userIds)).all(),
    db
      .select({ userId: session.userId, createdAt: session.createdAt })
      .from(session)
      .where(and(oneOf(session.userId, userIds), isNull(session.impersonatedBy)))
      .all(),
    db
      .select()
      .from(emailMessage)
      .where(and(oneOf(emailMessage.userId, userIds), gt(emailMessage.sentAt, emailsSince)))
      .orderBy(desc(emailMessage.sentAt))
      .all(),
    db
      .select()
      .from(accountEvent)
      .where(and(oneOf(accountEvent.userId, userIds), gt(accountEvent.createdAt, eventsSince)))
      .orderBy(desc(accountEvent.createdAt))
      .all(),
    db.select().from(emailChange).where(oneOf(emailChange.userId, userIds)).all(),
    db
      .select()
      .from(feedback)
      .where(oneOf(feedback.userId, userIds))
      .orderBy(desc(feedback.createdAt))
      .all(),
    db.select().from(photoGrace).where(oneOf(photoGrace.userId, userIds)).all(),
    householdIds.length > 0
      ? db.select().from(limitOverride).where(oneOf(limitOverride.householdId, householdIds)).all()
      : Promise.resolve([]),
    withAdminLog
      ? db
          .select()
          .from(adminAuditLog)
          .where(oneOf(adminAuditLog.targetUserId, userIds))
          .orderBy(desc(adminAuditLog.createdAt))
          .limit(AUDIT_ROWS * userIds.length)
          .all()
      : Promise.resolve([]),
    db.select().from(adminHandled).where(oneOf(adminHandled.userId, userIds)).all(),
    manyHouseholdsEntitlements(db, householdIds, at),
    manyHouseholdsUsage(db, householdIds),
    manyHouseholdsPhotos(db, householdIds),
  ]);

  // Admins' names, for "Brian gave Individual until Dec 31".
  const adminIds = [
    ...new Set([
      ...logRows.map((row) => row.adminUserId),
      ...handledRows.flatMap((row) => (row.adminUserId ? [row.adminUserId] : [])),
    ]),
  ];
  const admins = new Map(
    adminIds.length > 0
      ? (
          await db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(oneOf(user.id, adminIds))
            .all()
        ).map((row) => [row.id, row.name])
      : [],
  );

  const methodsOf = byKey(methodRows, (r) => r.userId);
  const membersOf = byKey(memberRows, (r) => r.householdId);
  const codeGrantsOf = byKey(codeGrantRows, (r) => r.userId);
  const adminGrantsOf = byKey(adminGrantRows, (r) => r.userId);
  const devicesOf = byKey(deviceRows, (r) => r.userId);
  const sessionsOf = byKey(sessionRows, (r) => r.userId);
  const emailsOf = byKey(emailRows, (r) => r.userId);
  const eventsOf = byKey(eventRows, (r) => r.userId);
  const changesOf = byKey(changeRows, (r) => r.userId);
  const feedbackOf = byKey(messageRows, (r) => r.userId);
  const graceOf = byKey(graceRows, (r) => r.userId);
  const overridesOf = byKey(overrideRows, (r) => r.householdId);
  const logOf = byKey(logRows, (r) => r.targetUserId ?? "");
  const handledOf = byKey(handledRows, (r) => r.userId);

  for (const person of people) {
    const userId = person.id;
    const household = households.get(userId) ?? null;
    const methods = methodsOf.get(userId) ?? [];
    const members = household
      ? (membersOf.get(household.id) ?? []).map((m) => ({ userId: m.userId, name: m.name }))
      : [];
    const codeGrants = codeGrantsOf.get(userId) ?? [];
    const adminGrants = adminGrantsOf.get(userId) ?? [];
    const devices = devicesOf.get(userId) ?? [];
    const sessions = sessionsOf.get(userId) ?? [];
    const emails = emailsOf.get(userId) ?? [];
    const events = eventsOf.get(userId) ?? [];
    const changes = changesOf.get(userId) ?? [];
    const messages = feedbackOf.get(userId) ?? [];
    const grace = graceOf.get(userId) ?? [];
    const overrides = household ? (overridesOf.get(household.id) ?? []) : [];
    const log = (logOf.get(userId) ?? []).slice(0, AUDIT_ROWS);
    const handled = handledOf.get(userId) ?? [];
    const entitled = household ? plans.get(household.id) : undefined;
    const plan = entitled?.plan ?? null;
    const freePlan = entitled?.free ?? null;
    const usageCounts = household ? (counts.get(household.id) ?? null) : null;
    const householdPhotos = household ? (photos.get(household.id) ?? []) : [];

    const signInMethods = [...new Set(methods.map((m) => m.providerId))];
    const waitingChange = changes.some(
      (c) => c.completedAt === null && c.cancelledAt === null && (ms(c.expiresAt) ?? 0) > now,
    );
    // As worker/account/purge.ts decides which unverified accounts to remove.
    const removable =
      !person.emailVerified &&
      person.role !== "admin" &&
      !signInMethods.some((m) => m !== "credential") &&
      !waitingChange;

    answer.set(userId, {
      person: {
        id: person.id,
        name: person.name,
        email: person.email,
        emailVerified: person.emailVerified,
        emailProblem: isEmailProblem(person.emailProblem) ? person.emailProblem : null,
        createdAt: person.createdAt.getTime(),
        mustChangePassword: person.mustChangePassword ?? false,
        role: person.role ?? null,
      },
      signInMethods,
      household: household ? { id: household.id, name: household.name, members } : null,
      plan,
      freePlan,
      usage: plan && usageCounts ? usageWithLimits(usageCounts, plan, householdPhotos) : null,
      codeGrants: codeGrants.map((g) => ({
        id: g.id,
        code: g.code,
        tier: g.tier,
        startsAt: g.startsAt.getTime(),
        endsAt: ms(g.endsAt ?? g.accessUntil),
        revokedAt: ms(g.revokedAt),
        createdAt: g.createdAt.getTime(),
      })),
      adminGrants: adminGrants.map((g) => ({
        id: g.id,
        tier: g.tier,
        startsAt: g.startsAt.getTime(),
        endsAt: g.endsAt.getTime(),
        revokedAt: ms(g.revokedAt),
        createdAt: g.createdAt.getTime(),
      })),
      devices: devices.map((dv) => ({
        id: dv.id,
        label: dv.label,
        firstSeenAt: dv.firstSeenAt.getTime(),
        lastSeenAt: dv.lastSeenAt.getTime(),
        revokedAt: ms(dv.revokedAt),
        revokedReason: dv.revokedReason,
        lastChangeTime: dv.lastChangeTime,
      })),
      sessions: sessions.map((s) => ({ createdAt: s.createdAt.getTime() })),
      emails: emails.map((e) => ({
        id: e.id,
        kind: e.kind,
        toAddress: e.toAddress,
        sentAt: e.sentAt.getTime(),
        status: e.status,
        statusAt: e.statusAt.getTime(),
        detail: e.detail,
      })),
      events: events.flatMap((e) => {
        const parsed = parseAccountEvent({
          id: e.id,
          kind: e.kind,
          details: e.details,
          at: e.createdAt.getTime(),
        });
        return parsed ? [parsed] : [];
      }),
      emailChanges: changes
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          oldEmail: c.oldEmail,
          newEmail: c.newEmail,
          byAdmin: c.adminUserId !== null,
          createdAt: c.createdAt.getTime(),
          expiresAt: ms(c.expiresAt),
          completedAt: ms(c.completedAt),
          cancelledAt: ms(c.cancelledAt),
        }))
        .sort((a, b) => b.createdAt - a.createdAt),
      feedback: messages.map((f) => ({
        id: f.id,
        message: f.message,
        createdAt: f.createdAt.getTime(),
        readAt: ms(f.readAt),
        repliedAt: ms(f.repliedAt),
        doneAt: ms(f.doneAt),
      })),
      photoGrace: grace.map((g) => ({
        id: g.id,
        startedAt: g.startedAt.getTime(),
        deleteAfter: g.deleteAfter.getTime(),
        remindedDays: g.remindedDays,
        endedAt: ms(g.endedAt),
        endedReason: g.endedReason,
      })),
      overrides: overrides
        .filter((o) => o.expiresAt === null || o.expiresAt.getTime() > now)
        .map((o) => ({ key: o.key, value: o.value, expiresAt: ms(o.expiresAt) })),
      adminLog: log.map((row) => {
        let details: Record<string, unknown> | null;
        try {
          details = row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null;
        } catch {
          details = null;
        }
        return {
          id: row.id,
          action: row.action,
          adminName: admins.get(row.adminUserId) ?? null,
          reason: row.reason,
          details,
          createdAt: row.createdAt.getTime(),
        };
      }),
      handled: handled.map((row) => ({
        finding: row.finding,
        fingerprint: row.fingerprint,
        adminName: row.adminUserId ? (admins.get(row.adminUserId) ?? null) : null,
        note: row.note,
        handledAt: row.handledAt.getTime(),
      })),
      removalAt: removable
        ? person.createdAt.getTime() + UNVERIFIED_ACCOUNT_HOURS * 60 * 60 * 1000
        : null,
    });
  }
  return answer;
}
