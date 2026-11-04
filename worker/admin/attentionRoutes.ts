import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  accountFindings,
  accountOverview,
  dateWords,
  firstName,
  isFindingKey,
} from "../../shared/accountFindings";
import type {
  AccountOverview,
  AttentionItem,
  AttentionOverview,
  ComingUpItem,
  ComingUpPerson,
  EmailsThisWeek,
  UnblockAnswer,
} from "../../shared/adminAccounts";
import { AFTER_VERIFY_PATH } from "../../shared/authPaths";
import { normalizeEmail } from "../../shared/email";
import { addBlockedBy } from "../../shared/limits";
import { emailInUse, isUniqueViolation } from "../account/emailChange";
import { unblockEmail } from "../account/routes";
import { waitingAccount } from "../account/signUpRoutes";
import { createAuth } from "../auth/auth";
import { isPaidTier } from "../codes/codes";
import type { Database } from "../db/client";
import {
  adminGrant,
  adminHandled,
  emailMessage,
  photoGrace,
  premiumGrant,
  promoCode,
  user,
} from "../db/schema";
import { householdEntitlements, manyHouseholdsEntitlements } from "../entitlements/entitlements";
import { REMINDER_DAYS } from "../images/grace";
import { manyHouseholdsUsage, usageWithLimits } from "../limits/usage";
import { withinRateLimit } from "../rateLimit";
import { appOrigin } from "./accountRoutes";
import { gatherAccountRecords, gatherAttentionRecords } from "./accountRecords";
import { accountDetail, accountHousehold, findAccount } from "./accounts";
import { recordAdminAction } from "./audit";
import { REASON_LENGTH } from "./impersonation";
import { freshPasskeyProblem, requireAdmin, type AdminContext } from "./requireAdmin";

// The admin console's account page and Needs attention (U15). Every route is behind requireAdmin;
// every change is recorded in the audit log before it's made; Premium and the sign-up address
// need the passkey again. Reading the overview isn't recorded (opening the account page already
// is, by GET /api/admin/accounts/:id), so reloading it after a change doesn't log another view.

export const adminAttentionRoutes = new Hono<{
  Bindings: Env;
  Variables: { admin: AdminContext };
}>();

adminAttentionRoutes.use("*", requireAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Premium given by an admin ends at most this far ahead. */
const MAX_PREMIUM_MS = 2 * 366 * DAY_MS;
/** How far ahead Coming up looks. */
const PREMIUM_AHEAD_MS = 14 * DAY_MS;
const PHOTOS_AHEAD_MS = 30 * DAY_MS;
/** At most this many accounts are looked at for Needs attention (the newest first). */
const MAX_CANDIDATES = 200;
const NOTE_MAX = 500;

async function body(request: Request): Promise<Record<string, unknown>> {
  return ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

/** The admin's time zone (?tz=Europe/London), for the dates in the words; UTC otherwise. */
function timeZoneOf(value: string | undefined): string {
  if (!value || value.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

async function overview(db: Database, userId: string, timeZone: string, now = Date.now()) {
  const records = await gatherAccountRecords(db, userId, now);
  return records ? (accountOverview(records, now, timeZone) satisfies AccountOverview) : null;
}

/** GET /api/admin/accounts/:id/overview[?tz=]: What's going on and What happened. */
adminAttentionRoutes.get("/accounts/:id/overview", async (c) => {
  const result = await overview(c.var.admin.db, c.req.param("id"), timeZoneOf(c.req.query("tz")));
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json(result);
});

/**
 * "Extend Premium…": gives the person's household Premium until a date, without a code. The
 * passkey again and a reason; the admin's earlier grants for the person are replaced.
 */
adminAttentionRoutes.post("/accounts/:id/premium", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  const input = await body(c.req.raw);
  if (!isPaidTier(input.tier)) return c.json({ error: "invalid_tier" }, 400);
  const tier = input.tier;
  const now = new Date();
  const until = typeof input.until === "string" ? new Date(input.until) : null;
  if (
    !until ||
    Number.isNaN(until.getTime()) ||
    until <= now ||
    until.getTime() - now.getTime() > MAX_PREMIUM_MS
  ) {
    return c.json({ error: "invalid_until" }, 400);
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < REASON_LENGTH.min || reason.length > REASON_LENGTH.max) {
    return c.json({ error: "reason_required" }, 400);
  }
  const household = await accountHousehold(admin.db, person.id);
  if (!household) return c.json({ error: "no_household" }, 409);
  const before = await householdEntitlements(admin.db, household.id, now);

  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "premium.extended",
      targetUserId: person.id,
      reason,
      details: {
        householdId: household.id,
        tier,
        until: until.toISOString(),
        before: { source: before.source, tier: before.tier, ends_at: before.ends_at },
      },
    },
    c.req.raw,
  );
  await admin.db.batch([
    admin.db
      .update(adminGrant)
      .set({ revokedAt: now })
      .where(and(eq(adminGrant.userId, person.id), isNull(adminGrant.revokedAt))),
    admin.db.insert(adminGrant).values({
      id: crypto.randomUUID(),
      householdId: household.id,
      userId: person.id,
      tier,
      startsAt: now,
      endsAt: until,
      createdBy: admin.userId,
      createdAt: now,
    }),
  ]);
  return c.json(await accountDetail(admin.db, person.id));
});

/**
 * Unblock: clears the account's email problem and takes the address off Resend's blocked list,
 * so the next email is tried again. Once a day per account from the console (separately from the
 * person's own "This address is right"). No passkey: it changes no address or password.
 */
adminAttentionRoutes.post("/accounts/:id/email/unblock", async (c) => {
  const admin = c.var.admin;
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  if (
    !(await withinRateLimit(admin.db, `admin-email-unblock:${person.id}`, {
      max: 1,
      windowMs: DAY_MS,
    }))
  ) {
    return c.json({ error: "too_many" }, 429);
  }
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "email.unblocked",
      targetUserId: person.id,
      details: { address: person.email, emailProblem: person.emailProblem ?? null },
    },
    c.req.raw,
  );
  const result = await unblockEmail(c.env, admin.db, person.id, person.email);
  if (result === null) return c.json({ error: "email_changed" }, 409);
  const detail = await accountDetail(admin.db, person.id);
  if (!detail) return c.json({ error: "not_found" }, 404);
  const answer: UnblockAnswer = { result, detail };
  return c.json(answer);
});

/** Sends the sign-up link through Better Auth, linking to the app (not the admin address). */
async function sendSignUpLink(env: Env, request: Request, email: string) {
  const auth = await createAuth(env, new Request(appOrigin(env, request)));
  await auth.api.sendVerificationEmail({ body: { email, callbackURL: AFTER_VERIFY_PATH } });
}

/**
 * Fixes a mistyped sign-up address and sends the link to it: only an account signed up with email
 * and password and not verified yet. The address changes in place, as when the person fixes it
 * on "Check your email" (no email change is recorded). The passkey again.
 */
adminAttentionRoutes.post("/accounts/:id/sign-up-address", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  if (person.role === "admin") return c.json({ error: "target_is_admin" }, 403);
  const waiting = await waitingAccount(admin.db, person.id);
  if (!waiting) return c.json({ error: "not_waiting" }, 409);
  const email = normalizeEmail((await body(c.req.raw)).email);
  if (!email) return c.json({ error: "invalid_email" }, 400);
  if (email === waiting.email) return c.json({ error: "same_email" }, 400);
  if (await emailInUse(admin.db, email, person.id)) return c.json({ error: "email_in_use" }, 409);

  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "sign_up.address_fixed",
      targetUserId: person.id,
      details: { from: waiting.email, to: email },
    },
    c.req.raw,
  );
  try {
    const [changed] = await admin.db
      .update(user)
      .set({ email, emailProblem: null, updatedAt: new Date() })
      .where(
        and(eq(user.id, person.id), eq(user.email, waiting.email), eq(user.emailVerified, false)),
      )
      .returning({ id: user.id })
      .all();
    if (!changed) return c.json({ error: "not_waiting" }, 409);
  } catch (error) {
    if (isUniqueViolation(error)) return c.json({ error: "email_in_use" }, 409);
    throw error;
  }
  try {
    await sendSignUpLink(c.env, c.req.raw, email);
  } catch (error) {
    // Recorded as not sent (worker/email/email.ts), which the account page then shows.
    console.error("Sign-up link from the admin console not sent", error);
  }
  return c.json(await accountDetail(admin.db, person.id));
});

/** Sends the sign-up link again, to the account's address as it is. */
adminAttentionRoutes.post("/accounts/:id/sign-up-link", async (c) => {
  const admin = c.var.admin;
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  const waiting = await waitingAccount(admin.db, person.id);
  if (!waiting) return c.json({ error: "not_waiting" }, 409);
  if (
    !(await withinRateLimit(admin.db, `admin-sign-up-link:${person.id}`, {
      max: 5,
      windowMs: 60 * 60 * 1000,
    }))
  ) {
    return c.json({ error: "too_many" }, 429);
  }
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "sign_up.link_sent",
      targetUserId: person.id,
      details: { to: waiting.email },
    },
    c.req.raw,
  );
  try {
    await sendSignUpLink(c.env, c.req.raw, waiting.email);
  } catch (error) {
    console.error("Sign-up link from the admin console not sent", error);
  }
  return c.json(await accountDetail(admin.db, person.id));
});

/**
 * Marks a finding handled (with an optional note), so it leaves Needs attention until something
 * new happens (its fingerprint changes). The server works out the finding itself: one that has
 * gone is "already_fixed". Answers the account's overview.
 */
adminAttentionRoutes.post("/accounts/:id/findings/:key/handled", async (c) => {
  const admin = c.var.admin;
  const key = c.req.param("key");
  if (!isFindingKey(key)) return c.json({ error: "invalid_finding" }, 400);
  const userId = c.req.param("id");
  const timeZone = timeZoneOf(c.req.query("tz"));
  const now = Date.now();
  const records = await gatherAccountRecords(admin.db, userId, now);
  if (!records) return c.json({ error: "not_found" }, 404);
  const finding = accountFindings(records, now, timeZone).findings.find((f) => f.key === key);
  if (!finding) return c.json({ error: "already_fixed" }, 409);
  const raw = (await body(c.req.raw)).note;
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return c.json({ error: "invalid_note" }, 400);
  }
  const note = typeof raw === "string" ? raw.trim() || null : null;
  if (note && note.length > NOTE_MAX) return c.json({ error: "note_too_long" }, 400);

  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "finding.handled",
      targetUserId: userId,
      // Never the note's words in the log: the note is kept with the mark.
      details: {
        finding: key,
        title: finding.title,
        fingerprint: finding.fingerprint,
        note: !!note,
      },
    },
    c.req.raw,
  );
  const row = {
    userId,
    finding: key,
    fingerprint: finding.fingerprint,
    adminUserId: admin.userId,
    note,
    handledAt: new Date(now),
  };
  await admin.db
    .insert(adminHandled)
    .values(row)
    .onConflictDoUpdate({
      target: [adminHandled.userId, adminHandled.finding],
      set: {
        fingerprint: row.fingerprint,
        adminUserId: row.adminUserId,
        note: row.note,
        handledAt: row.handledAt,
      },
    });
  return c.json(await overview(admin.db, userId, timeZone));
});

/** Takes back "handled": the finding is on Needs attention again. */
adminAttentionRoutes.delete("/accounts/:id/findings/:key/handled", async (c) => {
  const admin = c.var.admin;
  const key = c.req.param("key");
  if (!isFindingKey(key)) return c.json({ error: "invalid_finding" }, 400);
  const userId = c.req.param("id");
  const person = await findAccount(admin.db, userId);
  if (!person) return c.json({ error: "not_found" }, 404);
  const mark = await admin.db
    .select({ fingerprint: adminHandled.fingerprint })
    .from(adminHandled)
    .where(and(eq(adminHandled.userId, userId), eq(adminHandled.finding, key)))
    .get();
  if (!mark) return c.json({ error: "not_found" }, 404);
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "finding.unhandled",
      targetUserId: userId,
      details: { finding: key, fingerprint: mark.fingerprint },
    },
    c.req.raw,
  );
  await admin.db
    .delete(adminHandled)
    .where(and(eq(adminHandled.userId, userId), eq(adminHandled.finding, key)));
  return c.json(await overview(admin.db, userId, timeZoneOf(c.req.query("tz"))));
});

// ---------------------------------------------------------------------------------------------
// Needs attention.
// ---------------------------------------------------------------------------------------------

/**
 * Accounts that may have something that needs the admin, found cheaply: an email problem, a
 * sign-up link that bounced, recent refusals, a run of failed sign-ins, unread feedback, or
 * Premium that ended in the last 30 days. Each is then looked at properly.
 */
async function candidates(db: Database, now: number): Promise<string[]> {
  const month = now - 30 * DAY_MS;
  const quarter = now - 90 * DAY_MS;
  const week = now - 7 * DAY_MS;
  // One small query each (D1 limits how many can be joined into one), merged here.
  const lists = await Promise.all([
    db.all<{ id: string; at: number }>(sql`
      select id, updated_at as at from user where email_problem is not null`),
    db.all<{ id: string; at: number }>(sql`
      select m.user_id as id, max(m.sent_at) as at from email_message m
        join user u on u.id = m.user_id
        where m.kind = 'verification' and u.email_verified = 0 and m.sent_at > ${quarter}
          and m.status in ('bounced', 'complained', 'suppressed')
        group by m.user_id`),
    db.all<{ id: string; at: number }>(sql`
      select user_id as id, max(created_at) as at from account_event
        where kind = 'limit_refused' and created_at > ${month}
        group by user_id`),
    db.all<{ id: string; at: number }>(sql`
      select user_id as id, max(created_at) as at from account_event
        where kind = 'sign_in_failed' and created_at > ${week}
        group by user_id having count(*) >= 5`),
    db.all<{ id: string; at: number }>(sql`
      select user_id as id, max(created_at) as at from feedback where read_at is null
        group by user_id`),
    db.all<{ id: string; at: number }>(sql`
      select g.user_id as id, max(coalesce(g.revoked_at, g.ends_at, p.access_until)) as at
        from premium_grant g join promo_code p on p.id = g.promo_code_id
        where coalesce(g.revoked_at, g.ends_at, p.access_until) between ${month} and ${now}
        group by g.user_id`),
    db.all<{ id: string; at: number }>(sql`
      select user_id as id, max(coalesce(revoked_at, ends_at)) as at from admin_grant
        where coalesce(revoked_at, ends_at) between ${month} and ${now}
        group by user_id`),
  ]);
  const latest = new Map<string, number>();
  for (const row of lists.flat()) {
    latest.set(row.id, Math.max(latest.get(row.id) ?? 0, Number(row.at ?? 0)));
  }
  return [...latest.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CANDIDATES)
    .map(([id]) => id);
}

async function attentionItems(db: Database, now: number, timeZone: string) {
  const items: AttentionItem[] = [];
  const ids = await candidates(db, now);
  // Every candidate's records in one set of queries (D1 limits how many one request may make).
  const all = await gatherAttentionRecords(db, ids, now);
  for (const userId of ids) {
    const records = all.get(userId);
    // An account removed meanwhile (an unverified one, after 24 hours) has no page to open.
    if (!records) continue;
    const needs = accountFindings(records, now, timeZone).findings.filter(
      (f) => f.level === "needs_you",
    );
    const open = needs.filter((f) => f.handled === null);
    const first = open[0];
    if (!first) continue;
    items.push({
      userId,
      name: records.person.name,
      email: records.person.email,
      finding: { key: first.key, title: first.title },
      more: needs.filter((f) => f !== first).map((f) => f.title),
      since: first.since,
    });
  }
  // Newest first; those without a start date last.
  const time = (item: AttentionItem) => (item.since ? Date.parse(item.since) : -Infinity);
  return items.sort((a, b) => time(b) - time(a));
}

async function comingUp(db: Database, now: number, timeZone: string): Promise<ComingUpItem[]> {
  const d = dateWords(now, timeZone);
  const until = now + PREMIUM_AHEAD_MS;
  const [codeRows, adminRows, graceRows] = await Promise.all([
    db
      .select({
        userId: premiumGrant.userId,
        householdId: premiumGrant.householdId,
        code: promoCode.code,
        endsAt: sql<number>`coalesce(${premiumGrant.endsAt}, ${promoCode.accessUntil})`,
        name: user.name,
        email: user.email,
      })
      .from(premiumGrant)
      .innerJoin(promoCode, eq(premiumGrant.promoCodeId, promoCode.id))
      .innerJoin(user, eq(premiumGrant.userId, user.id))
      .where(
        and(
          isNull(premiumGrant.revokedAt),
          sql`coalesce(${premiumGrant.endsAt}, ${promoCode.accessUntil}) > ${now}`,
          sql`coalesce(${premiumGrant.endsAt}, ${promoCode.accessUntil}) <= ${until}`,
        ),
      )
      .all(),
    db
      .select({
        userId: adminGrant.userId,
        householdId: adminGrant.householdId,
        endsAt: adminGrant.endsAt,
        name: user.name,
        email: user.email,
      })
      .from(adminGrant)
      .innerJoin(user, eq(adminGrant.userId, user.id))
      .where(
        and(
          isNull(adminGrant.revokedAt),
          gt(adminGrant.endsAt, new Date(now)),
          lte(adminGrant.endsAt, new Date(until)),
        ),
      )
      .all(),
    db
      .select({
        userId: photoGrace.userId,
        deleteAfter: photoGrace.deleteAfter,
        remindedDays: photoGrace.remindedDays,
        name: user.name,
        email: user.email,
        emailProblem: user.emailProblem,
      })
      .from(photoGrace)
      .innerJoin(user, eq(photoGrace.userId, user.id))
      .where(
        and(
          isNull(photoGrace.endedAt),
          lte(photoGrace.deleteAfter, new Date(now + PHOTOS_AHEAD_MS)),
        ),
      )
      .all(),
  ]);

  // Free Premium ending, grouped by code (or "given by support") and day. Only people whose
  // household's Premium really ends then (a later grant keeps them on Premium).
  const groups = new Map<
    string,
    { code: string | null; at: number; people: ComingUpPerson[]; over: number }
  >();
  const rows = [
    ...codeRows.map((r) => ({ ...r, endsAt: Number(r.endsAt) })),
    ...adminRows.map((r) => ({ ...r, code: null as string | null, endsAt: r.endsAt.getTime() })),
  ];
  // Each household's plan and usage, read once for all of them.
  const householdIds = [...new Set(rows.map((r) => r.householdId))];
  const [plans, counts] = await Promise.all([
    manyHouseholdsEntitlements(db, householdIds, new Date(now)),
    manyHouseholdsUsage(db, householdIds),
  ]);
  for (const row of rows) {
    const entitled = plans.get(row.householdId);
    if (!entitled) continue;
    const plan = entitled.plan;
    if (plan.ends_at === null || Date.parse(plan.ends_at) > row.endsAt) continue;
    const day = new Date(row.endsAt).toISOString().slice(0, 10);
    const key = `${row.code ?? ""}|${day}`;
    const group = groups.get(key) ?? { code: row.code, at: row.endsAt, people: [], over: 0 };
    if (group.people.some((p) => p.userId === row.userId)) continue;
    group.people.push({ userId: row.userId, name: row.name, email: row.email });
    const usage = usageWithLimits(
      counts.get(row.householdId) ?? { recipes: 0, textBytes: 0 },
      entitled.free,
    );
    if (addBlockedBy(usage)) group.over += 1;
    group.at = Math.min(group.at, row.endsAt);
    groups.set(key, group);
  }
  const items: ComingUpItem[] = [...groups.values()].map((g) => ({
    kind: "premium_ending",
    at: new Date(g.at).toISOString(),
    title: `${g.code ? `Free Premium from code ${g.code}` : "Premium given by support"} ends for ${g.people.length === 1 ? (g.people[0]?.name ?? "1 person") : `${g.people.length} people`}`,
    body:
      g.over === 0
        ? g.people.length === 1
          ? "They’re within Free’s limits, so nothing will be blocked."
          : "They’re all within Free’s limits, so nothing will be blocked."
        : g.people.length === 1
          ? "They’re over Free’s recipe limits and will stop being able to add recipes."
          : `${g.over} of them ${g.over === 1 ? "is" : "are"} over Free’s recipe limits and will stop being able to add recipes.`,
    code: g.code,
    people: g.people,
    overFreeLimits: g.over,
  }));

  // Photos to be deleted, and the reminders before it.
  for (const g of graceRows) {
    const person = { userId: g.userId, name: g.name, email: g.email };
    const name = firstName(g.name);
    const notArriving = g.emailProblem !== null;
    const deleteAt = g.deleteAfter.getTime();
    if (deleteAt > now) {
      items.push({
        kind: "photos_deleted",
        at: g.deleteAfter.toISOString(),
        title: `${g.name}’s photos will be deleted`,
        body: `Unless ${name}’s plan includes photos again by ${d.day(deleteAt)}. Extending their Premium stops it.`,
        code: null,
        people: [person],
        overFreeLimits: 0,
      });
    }
    const next = [...REMINDER_DAYS]
      .filter((days) => days < g.remindedDays)
      .map((days) => ({ days, at: deleteAt - days * DAY_MS }))
      .filter((r) => r.at > now)
      .sort((a, b) => a.at - b.at)[0];
    if (next) {
      items.push({
        kind: "photo_reminder",
        at: new Date(next.at).toISOString(),
        title: `${g.name}’s ${next.days === 1 ? "1-day" : `${next.days}-days`}-left photo reminder`,
        body: notArriving
          ? "Their email isn’t arriving, so it won’t reach them."
          : "Sent by email, with the date the photos will be deleted.",
        code: null,
        people: [person],
        overFreeLimits: 0,
      });
    }
  }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

async function emailsThisWeek(db: Database, now: number): Promise<EmailsThisWeek> {
  const rows = await db
    .select({ status: emailMessage.status, count: sql<number>`count(*)` })
    .from(emailMessage)
    .where(gt(emailMessage.sentAt, new Date(now - 7 * DAY_MS)))
    .groupBy(emailMessage.status)
    .all();
  const of = (status: string) => Number(rows.find((r) => r.status === status)?.count ?? 0);
  return {
    sent: rows.reduce((sum, r) => sum + Number(r.count), 0),
    delivered: of("delivered"),
    bounced: of("bounced"),
    spam: of("complained"),
  };
}

/** GET /api/admin/attention[?tz=]: the console's opening page. */
adminAttentionRoutes.get("/attention", async (c) => {
  const db = c.var.admin.db;
  const now = Date.now();
  const timeZone = timeZoneOf(c.req.query("tz"));
  const [items, coming, emails] = await Promise.all([
    attentionItems(db, now, timeZone),
    comingUp(db, now, timeZone),
    emailsThisWeek(db, now),
  ]);
  const answer: AttentionOverview = { items, comingUp: coming, emailsThisWeek: emails };
  return c.json(answer);
});
