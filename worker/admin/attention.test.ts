import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AccountDetail,
  AccountOverview,
  AttentionOverview,
  UnblockAnswer,
} from "../../shared/adminAccounts";
import type { Entitlements } from "../../shared/entitlements";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { adminAuditLog, adminGrant, emailMessage, premiumGrant, session, user } from "../db/schema";
import { devOutbox } from "../email/outbox";
import { app } from "../index";
import {
  ORIGIN,
  overrideLimit,
  setUpDatabase,
  signUp,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";

// The admin console's account page and Needs attention (U15).

const db = () => database(env.DB);
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;
const DAY = 24 * 60 * 60 * 1000;

let admin: Visitor;
let adminId: string;

async function freshAdmin(at = new Date()) {
  await db()
    .update(session)
    .set({ authMethod: "passkey", createdAt: at, lastActiveAt: new Date() })
    .where(eq(session.userId, adminId));
}

beforeAll(async () => {
  await setUpDatabase();
  admin = await signUpConfirmed(email("admin"), "Brian Admin");
  adminId = (await admin.session())!.user.id;
  await db().update(user).set({ role: "admin" }).where(eq(user.id, adminId));
});

beforeEach(async () => {
  await freshAdmin();
});

const call = async <T = unknown>(path: string, init: { method?: string; body?: unknown } = {}) => {
  const res = await admin.request(path, init);
  return { status: res.status, body: (await res.json()) as T };
};

const auditRows = (action: string) =>
  db()
    .select()
    .from(adminAuditLog)
    .where(eq(adminAuditLog.action, action))
    .orderBy(desc(adminAuditLog.createdAt))
    .all();

async function person(label = "dana", name = "Dana Ortiz") {
  const address = email(label);
  const v = await signUpConfirmed(address, name);
  return { v, address, userId: (await v.session())!.user.id };
}

/** An email to the account, as the email service's events left it. */
async function emailRow(userId: string, to: string, kind: string, status: string, at = Date.now()) {
  const id = crypto.randomUUID();
  await db()
    .insert(emailMessage)
    .values({
      id,
      providerId: `dev-${id}`,
      userId,
      kind,
      toAddress: to.toLowerCase(),
      sentAt: new Date(at),
      status,
      statusAt: new Date(at),
      detail: status === "bounced" ? "Mailbox does not exist" : null,
    });
  return id;
}

const overview = (userId: string) =>
  call<AccountOverview>(`/api/admin/accounts/${userId}/overview`);

describe("the overview", () => {
  it("is for admins only, and isn't recorded as a view", async () => {
    const { v, userId } = await person("private");
    expect((await v.request(`/api/admin/accounts/${userId}/overview`)).status).toBe(403);
    expect((await visitor().request("/api/admin/attention")).status).toBe(401);
    const views = (await auditRows("account.viewed")).length;
    const res = await overview(userId);
    expect(res.status).toBe(200);
    expect(res.body.findings).toEqual([]);
    expect(res.body.fine).toContain("Emails are arriving");
    expect(
      res.body.history.some((h) => h.text.startsWith("Signed up with email and password")),
    ).toBe(true);
    expect(await auditRows("account.viewed")).toHaveLength(views);
    expect((await overview("nobody")).status).toBe(404);
  });

  it("the account page now has usage, photos and the email problem", async () => {
    const { userId } = await person("detail");
    await db().update(user).set({ emailProblem: "bounced" }).where(eq(user.id, userId));
    const res = await call<AccountDetail>(`/api/admin/accounts/${userId}`);
    expect(res.body).toMatchObject({
      usage: { recipes: 0, textBytes: 0, maxRecipes: 100 },
      photos: { enabled: false, count: 0 },
      emailProblem: "bounced",
      adminGrants: [],
      unreadFeedback: 0,
    });
  });
});

describe("Extend Premium", () => {
  const extend = (userId: string, body: Record<string, unknown>) =>
    call<AccountDetail & { error?: string }>(`/api/admin/accounts/${userId}/premium`, { body });
  const until = (days: number) => new Date(Date.now() + days * DAY).toISOString();

  it("needs the passkey again, a reason and a date ahead", async () => {
    const { userId } = await person("checks");
    await freshAdmin(new Date(Date.now() - 10 * 60_000));
    expect(
      await extend(userId, { tier: "individual", until: until(30), reason: "Beta tester" }),
    ).toMatchObject({
      status: 403,
      body: { error: "passkey_reconfirm" },
    });
    await freshAdmin();
    expect(
      (await extend(userId, { tier: "gold", until: until(30), reason: "Beta tester" })).body,
    ).toMatchObject({ error: "invalid_tier" });
    expect(
      (await extend(userId, { tier: "individual", until: until(-1), reason: "Beta tester" })).body,
    ).toMatchObject({ error: "invalid_until" });
    expect(
      (await extend(userId, { tier: "individual", until: until(800), reason: "Beta tester" })).body,
    ).toMatchObject({ error: "invalid_until" });
    expect(
      (await extend(userId, { tier: "individual", until: until(30), reason: "hi" })).body,
    ).toMatchObject({ error: "reason_required" });
    expect(await db().select().from(adminGrant).where(eq(adminGrant.userId, userId)).all()).toEqual(
      [],
    );
  });

  it("gives Premium until the date, recorded first, beating an expired code", async () => {
    const { v, userId } = await person("extend");
    const code = await createCode(
      db(),
      {
        code: `ENDS-${++counter}`,
        label: "Ends",
        tier: "individual",
        access: { days: 30 },
        allowsSignUp: true,
        maxUses: null,
        redeemBy: null,
      },
      null,
    );
    expect((await v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(200);
    // The code's Premium ended yesterday.
    await db()
      .update(premiumGrant)
      .set({ endsAt: new Date(Date.now() - DAY) })
      .where(eq(premiumGrant.userId, userId));
    const plan = async () => (await (await v.request("/api/entitlements")).json()) as Entitlements;
    expect(await plan()).toMatchObject({ tier: "free" });

    const first = await extend(userId, {
      tier: "individual",
      until: until(30),
      reason: "Beta tester, code ended",
    });
    expect(first.status).toBe(200);
    expect(first.body.plan).toMatchObject({ tier: "individual", source: "admin_grant" });
    expect(first.body.adminGrants).toHaveLength(1);
    expect(await plan()).toMatchObject({ tier: "individual", source: "admin_grant" });
    const [audit] = await auditRows("premium.extended");
    expect(audit).toMatchObject({ targetUserId: userId, reason: "Beta tester, code ended" });
    expect(JSON.parse(audit!.details!)).toMatchObject({
      tier: "individual",
      before: { tier: "free", source: "free" },
    });

    // A second replaces the first.
    const second = await extend(userId, {
      tier: "household",
      until: until(60),
      reason: "Moving in together",
    });
    expect(second.body.plan).toMatchObject({ tier: "household" });
    const grants = await db().select().from(adminGrant).where(eq(adminGrant.userId, userId)).all();
    expect(grants).toHaveLength(2);
    expect(grants.filter((g) => g.revokedAt === null)).toHaveLength(1);
  });
});

describe("Unblock", () => {
  it("is recorded first, says what happened, and is once a day", async () => {
    const { userId, address } = await person("unblock");
    await db().update(user).set({ emailProblem: "suppressed" }).where(eq(user.id, userId));
    const res = await call<UnblockAnswer>(`/api/admin/accounts/${userId}/email/unblock`, {
      method: "POST",
    });
    // No Resend key in tests: nothing to take it off, but the notice goes.
    expect(res).toMatchObject({
      status: 200,
      body: { result: "not_configured", detail: { emailProblem: null } },
    });
    const [audit] = await auditRows("email.unblocked");
    expect(JSON.parse(audit!.details!)).toMatchObject({ address, emailProblem: "suppressed" });
    expect(
      (await call(`/api/admin/accounts/${userId}/email/unblock`, { method: "POST" })).status,
    ).toBe(429);
  });
});

describe("fixing a sign-up address", () => {
  it("changes an unverified address in place and sends the link there", async () => {
    const typo = email("sarah").replace("example.com", "gmial.com");
    await signUp(typo, "Sarah Lee");
    const userId = (await db().select().from(user).where(eq(user.email, typo)).get())!.id;
    const right = typo.replace("gmial.com", "gmail.com");
    const res = await call<AccountDetail>(`/api/admin/accounts/${userId}/sign-up-address`, {
      body: { email: right },
    });
    expect(res).toMatchObject({ status: 200, body: { email: right, emailVerified: false } });
    const [sent] = devOutbox.list(right);
    expect(sent?.subject).toBe("Verify your email for Fennl");
    expect(sent?.text).toContain(`${ORIGIN}/api/auth/verify-email`);
    expect(await auditRows("sign_up.address_fixed")).toHaveLength(1);

    // Taken, the same, or a verified account: refused.
    const taken = await person("taken");
    expect(
      (
        await call(`/api/admin/accounts/${userId}/sign-up-address`, {
          body: { email: taken.address },
        })
      ).body,
    ).toMatchObject({ error: "email_in_use" });
    expect(
      (
        await call(`/api/admin/accounts/${taken.userId}/sign-up-address`, {
          body: { email: email("x") },
        })
      ).body,
    ).toMatchObject({ error: "not_waiting" });
    expect(
      (await call(`/api/admin/accounts/${userId}/sign-up-link`, { method: "POST" })).status,
    ).toBe(200);
    expect(devOutbox.list(right)).toHaveLength(2);
  });

  it("links to the app's address when called from the admin address", async () => {
    const address = email("origin");
    await signUp(address, "Olive Origin");
    const userId = (await db().select().from(user).where(eq(user.email, address)).get())!.id;
    const res = await app.request(
      `${ORIGIN}/api/admin/accounts/${userId}/sign-up-link`,
      { method: "POST", headers: { origin: ORIGIN, cookie: admin.cookie() } },
      { ...env, APP_HOSTNAME: "beta.example.test" },
    );
    expect(res.status).toBe(200);
    expect(devOutbox.list(address)[0]?.text).toContain("https://beta.example.test/");
  });
});

describe("Needs attention", () => {
  it("lists an account with a bounced address until it's handled, and again on a new bounce", async () => {
    const { userId, address } = await person("bounce", "Mark Tan");
    await db().update(user).set({ emailProblem: "bounced" }).where(eq(user.id, userId));
    await emailRow(userId, address, "password_reset", "bounced", Date.now() - 60_000);

    const list = async () => (await call<AttentionOverview>("/api/admin/attention")).body;
    const mine = async () => (await list()).items.find((i) => i.userId === userId);
    expect(await mine()).toMatchObject({
      name: "Mark Tan",
      email: address,
      finding: { key: "email_not_arriving", title: `Emails to ${address} aren’t arriving` },
    });
    expect((await list()).emailsThisWeek.bounced).toBeGreaterThanOrEqual(1);

    // A finding that isn't there can't be marked handled.
    expect(
      (await call(`/api/admin/accounts/${userId}/findings/email_spam/handled`, { body: {} })).body,
    ).toMatchObject({ error: "already_fixed" });
    expect(
      (await call(`/api/admin/accounts/${userId}/findings/nonsense/handled`, { body: {} })).status,
    ).toBe(400);

    const handled = await call<AccountOverview>(
      `/api/admin/accounts/${userId}/findings/email_not_arriving/handled`,
      { body: { note: "Wrote from my own email" } },
    );
    expect(handled.status).toBe(200);
    expect(
      handled.body.findings.find((f) => f.key === "email_not_arriving")?.handled,
    ).toMatchObject({
      by: "Brian Admin",
      note: "Wrote from my own email",
    });
    const [audit] = await auditRows("finding.handled");
    expect(audit?.details).not.toContain("Wrote from my own email");
    expect(await mine()).toBeUndefined();

    // A new bounce brings it back.
    await emailRow(userId, address, "photo_grace_reminder", "bounced");
    expect(await mine()).toMatchObject({ finding: { key: "email_not_arriving" } });

    // Un-handling works too.
    await call(`/api/admin/accounts/${userId}/findings/email_not_arriving/handled`, { body: {} });
    expect(await mine()).toBeUndefined();
    const back = await call(`/api/admin/accounts/${userId}/findings/email_not_arriving/handled`, {
      method: "DELETE",
    });
    expect(back.status).toBe(200);
    expect(await mine()).toBeDefined();
  });

  it("skips an account that has been removed", async () => {
    const address = email("gone");
    await signUp(address, "Gone Soon");
    const userId = (await db().select().from(user).where(eq(user.email, address)).get())!.id;
    await emailRow(userId, address, "verification", "bounced");
    const has = async () =>
      (await call<AttentionOverview>("/api/admin/attention")).body.items.some(
        (i) => i.userId === userId,
      );
    expect(await has()).toBe(true);
    await db().delete(user).where(eq(user.id, userId));
    expect(await has()).toBe(false);
  });

  it("reads every account in the same few queries, however many there are", async () => {
    // Counts the database questions one GET /api/admin/attention asks (D1 allows 1,000 per
    // request on Workers Paid), by watching every statement prepared.
    const queries = async () => {
      let count = 0;
      const DB = new Proxy(env.DB, {
        get(target, key) {
          if (key === "prepare") {
            return (query: string) => {
              count += 1;
              return target.prepare(query);
            };
          }
          const value = Reflect.get(target, key) as unknown;
          return typeof value === "function" ? (value as () => unknown).bind(target) : value;
        },
      });
      const res = await app.request(
        `${ORIGIN}/api/admin/attention`,
        { headers: { origin: ORIGIN, cookie: admin.cookie() } },
        { ...env, DB },
      );
      expect(res.status).toBe(200);
      return { count, body: (await res.json()) as AttentionOverview };
    };
    const blocked = async (label: string) => {
      const { v, userId, address } = await person(label, `Lee ${label}`);
      await db().update(user).set({ emailProblem: "bounced" }).where(eq(user.id, userId));
      await emailRow(userId, address, "password_reset", "bounced");
      // Over a limit too, so each account is looked at in full.
      await overrideLimit(v, "max_recipes", 0);
      return userId;
    };
    const first = await Promise.all([1, 2, 3, 4].map((i) => blocked(`many-${i}`)));
    // Once first, so the tier limits are in the Worker's minute-long cache for both counts.
    await queries();
    const before = await queries();
    const more = await Promise.all([5, 6, 7, 8, 9, 10, 11, 12].map((i) => blocked(`many-${i}`)));
    const after = await queries();
    for (const userId of [...first, ...more]) {
      const item = after.body.items.find((i) => i.userId === userId);
      expect(item?.finding.key).toBe("email_not_arriving");
      expect(item?.more).toContain(
        `${item?.name.split(" ")[0]} can’t add recipes: the recipe limit is reached`,
      );
    }
    expect(after.count).toBeGreaterThan(10);
    expect(after.count).toBe(before.count);
    expect(after.count).toBeLessThan(100);
  });

  it("Coming up: free Premium ending soon, grouped by code", async () => {
    const code = await createCode(
      db(),
      {
        code: `BETA-FALL-${++counter}`,
        label: "Fall",
        tier: "individual",
        access: { until: new Date(Date.now() + 3 * DAY).toISOString() },
        allowsSignUp: true,
        maxUses: null,
        redeemBy: null,
      },
      null,
    );
    for (const label of ["a", "b"]) {
      const { v } = await person(`fall-${label}`);
      expect((await v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(
        200,
      );
    }
    const { comingUp } = (await call<AttentionOverview>("/api/admin/attention")).body;
    const item = comingUp.find((c) => c.code === code.code);
    expect(item).toMatchObject({
      kind: "premium_ending",
      title: `Free Premium from code ${code.code} ends for 2 people`,
      overFreeLimits: 0,
    });
    expect(item?.people).toHaveLength(2);
  });
});
