import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminCode, AdminCodeUse } from "../../shared/codes";
import type { Entitlements } from "../../shared/entitlements";
import { database } from "../db/client";
import { adminAuditLog, premiumGrant, promoCode, session, user } from "../db/schema";
import { writeSetting } from "../settings/settings";
import {
  PASSWORD,
  linkInLatestEmail,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";
import { createCode } from "./admin";
import { activeGrant, generateCode, normalizeCode, redeemCode } from "./codes";
import { SIGN_UP_CODE_COOKIE, checkSignUp, grantSignUpCode } from "./signUp";

const db = () => database(env.DB);
const DAY = 24 * 60 * 60 * 1000;
let emailCounter = 0;
const email = (label: string) => `${label}-${++emailCounter}@example.com`;

beforeAll(async () => {
  await setUpDatabase();
});

async function inviteOnly(on: boolean) {
  await writeSetting(db(), "sign_up_requires_code", on, null);
}

let codeCounter = 0;
/** A code made straight in the database. By default: an invite, Household until 90 days away. */
async function makeCode(
  options: {
    tier?: "individual" | "household";
    until?: Date;
    days?: number;
    forever?: boolean;
    allowsSignUp?: boolean;
    maxUses?: number | null;
    redeemBy?: Date | null;
  } = {},
) {
  const code = `TEST-${++codeCounter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return createCode(
    db(),
    {
      code,
      label: "Test code",
      tier: options.tier ?? "household",
      access: options.forever
        ? { forever: true }
        : options.days !== undefined
          ? { days: options.days }
          : { until: (options.until ?? new Date(Date.now() + 90 * DAY)).toISOString() },
      allowsSignUp: options.allowsSignUp ?? true,
      maxUses: options.maxUses ?? null,
      redeemBy: options.redeemBy?.toISOString() ?? null,
    },
    null,
  );
}

async function uses(codeId: string) {
  const row = await db()
    .select({ uses: promoCode.uses })
    .from(promoCode)
    .where(eq(promoCode.id, codeId))
    .get();
  return row?.uses;
}

/** Signs up through the API, entering a code first if given. Returns the response and visitor. */
async function signUpWith(address: string, code?: string) {
  const v = visitor();
  if (code !== undefined) {
    const checked = await v.request("/api/sign-up/code", { body: { code } });
    if (checked.status !== 200) return { v, res: checked };
  }
  const res = await v.request("/api/auth/sign-up/email", {
    body: { name: "June Lee", email: address, password: PASSWORD, callbackURL: "/" },
  });
  return { v, res };
}

async function confirm(v: Visitor, address: string) {
  const res = await v.request(linkInLatestEmail(address));
  expect(res.status).toBe(302);
}

async function entitlements(v: Visitor) {
  const res = await v.request("/api/entitlements");
  expect(res.status).toBe(200);
  return (await res.json()) as Entitlements;
}

async function userExists(address: string) {
  return (await db().select().from(user).where(eq(user.email, address)).get()) !== undefined;
}

describe("codes", () => {
  it("are random, readable, and compared without case or spaces", () => {
    const code = generateCode();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(generateCode()).not.toBe(code);
    expect(normalizeCode(" k7qx-m4tr 9waz ")).toBe("K7QX-M4TR9WAZ");
    expect(normalizeCode("ab")).toBeNull();
    expect(normalizeCode("no good!")).toBeNull();
    expect(normalizeCode(42)).toBeNull();
  });
});

describe("invite-only sign-up", () => {
  beforeEach(async () => {
    await inviteOnly(true);
  });

  it("refuses to make an account without a code", async () => {
    const address = email("nocode");
    const { res } = await signUpWith(address);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVITE_CODE_REQUIRED" });
    expect(await userExists(address)).toBe(false);
  });

  it("tells the sign-up page when a code won't do", async () => {
    const v = visitor();
    const check = async (code: string) => {
      const res = await v.request("/api/sign-up/code", { body: { code } });
      return { status: res.status, body: await res.json() };
    };
    expect(await check("NOPE-NOPE")).toEqual({ status: 400, body: { error: "not_found" } });
    expect(await check("!!")).toEqual({ status: 400, body: { error: "invalid" } });

    const promo = await makeCode({ allowsSignUp: false });
    expect((await check(promo.code)).body).toEqual({ error: "no_sign_up" });

    const past = await makeCode({ redeemBy: new Date(Date.now() + 1000) });
    await db()
      .update(promoCode)
      .set({ redeemBy: new Date(Date.now() - 1000) })
      .where(eq(promoCode.id, past.id));
    expect((await check(past.code)).body).toEqual({ error: "expired" });

    const full = await makeCode({ maxUses: 1 });
    await db().update(promoCode).set({ uses: 1 }).where(eq(promoCode.id, full.id));
    expect((await check(full.code)).body).toEqual({ error: "used_up" });

    const off = await makeCode();
    await db().update(promoCode).set({ disabledAt: new Date() }).where(eq(promoCode.id, off.id));
    expect((await check(off.code)).body).toEqual({ error: "disabled" });
  });

  it("makes the account with an invite, and gives its household Premium", async () => {
    const until = new Date(Date.now() + 120 * DAY);
    const invite = await makeCode({ until });
    const address = email("invited");
    const { v, res } = await signUpWith(address, invite.code.toLowerCase());
    expect(res.status).toBe(200);
    expect(await uses(invite.id)).toBe(1);
    // The code has done its job: its cookie is cleared.
    expect(v.cookie()).not.toContain(SIGN_UP_CODE_COOKIE);

    await confirm(v, address);
    const plan = await entitlements(v);
    expect(plan).toMatchObject({ tier: "household", source: "promo_code", images_enabled: true });
    expect(plan.ends_at).toBe(until.toISOString());
  });

  it("checks the code again when the account is made, not just on the sign-up page", async () => {
    // A cookie set by hand, skipping the check: a promo code that can't make accounts.
    const promo = await makeCode({ allowsSignUp: false });
    const v = visitor();
    v.addCookie(`${SIGN_UP_CODE_COOKIE}=${promo.code}`);
    const address = email("forged");
    const res = await v.request("/api/auth/sign-up/email", {
      body: { name: "June Lee", email: address, password: PASSWORD, callbackURL: "/" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVITE_CODE_INVALID" });
    expect(await userExists(address)).toBe(false);
    expect(await uses(promo.id)).toBe(0);
  });

  it("lets only as many people in as the code allows", async () => {
    const invite = await makeCode({ maxUses: 1 });
    // Both pass the sign-up page's check before either makes an account.
    const first = visitor();
    const second = visitor();
    expect((await first.request("/api/sign-up/code", { body: { code: invite.code } })).status).toBe(
      200,
    );
    expect(
      (await second.request("/api/sign-up/code", { body: { code: invite.code } })).status,
    ).toBe(200);
    const body = (address: string) => ({
      body: { name: "June Lee", email: address, password: PASSWORD, callbackURL: "/" },
    });
    expect((await first.request("/api/auth/sign-up/email", body(email("first")))).status).toBe(200);
    const late = await second.request("/api/auth/sign-up/email", body(email("second")));
    expect(late.status).toBe(400);
    expect(await late.json()).toMatchObject({ code: "INVITE_CODE_INVALID" });
    expect(await uses(invite.id)).toBe(1);
  });

  it("guards every way of making an account, including Google and Apple", async () => {
    // Better Auth runs the same hook for accounts made after Google or Apple; this calls it the
    // way the callback does, with the request's headers.
    await expect(checkSignUp(db(), { headers: new Headers() })).rejects.toMatchObject({
      body: { code: "INVITE_CODE_REQUIRED" },
    });

    const invite = await makeCode();
    const ctx = { headers: new Headers({ cookie: `${SIGN_UP_CODE_COOKIE}=${invite.code}` }) };
    await checkSignUp(db(), ctx);
    expect(await uses(invite.id)).toBe(1);

    // The account now exists (made here by hand); the after-hook gives the Premium.
    const userId = crypto.randomUUID();
    await db()
      .insert(user)
      .values({ id: userId, name: "Apple Person", email: email("apple"), emailVerified: true });
    await grantSignUpCode(db(), userId, ctx);
    const grant = await db()
      .select()
      .from(premiumGrant)
      .where(eq(premiumGrant.userId, userId))
      .get();
    expect(grant).toMatchObject({ promoCodeId: invite.id, tier: "household" });
  });

  it("can be switched off, and the sign-up page is told", async () => {
    expect(await (await visitor().request("/api/sign-in-methods")).json()).toMatchObject({
      signUpCodeRequired: true,
    });
    await inviteOnly(false);
    expect(await (await visitor().request("/api/sign-in-methods")).json()).toMatchObject({
      signUpCodeRequired: false,
    });
  });

  it("limits how fast codes can be tried", async () => {
    const v = visitor();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await v.request("/api/sign-up/code", { body: { code: "GUESS-1234" } })).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("open sign-up", () => {
  beforeEach(async () => {
    await inviteOnly(false);
  });

  it("makes Free accounts without a code", async () => {
    const address = email("open");
    const { v, res } = await signUpWith(address);
    expect(res.status).toBe(200);
    await confirm(v, address);
    expect(await entitlements(v)).toMatchObject({ tier: "free", source: "free" });
  });

  it("takes promo codes, including ones that aren't invites", async () => {
    const promo = await makeCode({ allowsSignUp: false, tier: "individual", days: 30 });
    const address = email("promo");
    const { v, res } = await signUpWith(address, promo.code);
    expect(res.status).toBe(200);
    await confirm(v, address);
    const plan = await entitlements(v);
    expect(plan).toMatchObject({ tier: "individual", source: "promo_code" });
    const endsIn = new Date(plan.ends_at!).getTime() - Date.now();
    expect(endsIn).toBeGreaterThan(29 * DAY);
    expect(endsIn).toBeLessThanOrEqual(30 * DAY);
  });

  it("still makes the account if a code stopped working in between", async () => {
    const promo = await makeCode();
    const v = visitor();
    expect((await v.request("/api/sign-up/code", { body: { code: promo.code } })).status).toBe(200);
    await db().update(promoCode).set({ disabledAt: new Date() }).where(eq(promoCode.id, promo.id));
    const address = email("lateoff");
    const res = await v.request("/api/auth/sign-up/email", {
      body: { name: "June Lee", email: address, password: PASSWORD, callbackURL: "/" },
    });
    expect(res.status).toBe(200);
    await confirm(v, address);
    expect(await entitlements(v)).toMatchObject({ tier: "free" });
  });
});

describe("using a code from the Account page", () => {
  beforeAll(async () => {
    await inviteOnly(false);
  });

  const redeem = async (v: Visitor, code: string) => {
    const res = await v.request("/api/codes/redeem", { body: { code } });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("needs a signed-in person", async () => {
    expect((await redeem(visitor(), "ANY-CODE")).status).toBe(401);
  });

  it("gives Premium for the code's number of days, once per person", async () => {
    await inviteOnly(false);
    const v = await signUpConfirmed(email("days"));
    const promo = await makeCode({ days: 14, tier: "individual", allowsSignUp: false });
    const used = await redeem(v, promo.code);
    expect(used.status).toBe(200);
    expect(used.body).toMatchObject({ tier: "individual", source: "promo_code" });
    expect(await uses(promo.id)).toBe(1);

    expect(await redeem(v, promo.code)).toEqual({ status: 400, body: { error: "already_used" } });
    expect(await uses(promo.id)).toBe(1);
  });

  it("explains codes that can't be used", async () => {
    await inviteOnly(false);
    const v = await signUpConfirmed(email("bad"));
    expect(await redeem(v, "NOT-A-CODE")).toEqual({ status: 400, body: { error: "not_found" } });
    const gone = await makeCode({ until: new Date(Date.now() + 1000) });
    await db()
      .update(promoCode)
      .set({ accessUntil: new Date(Date.now() - 1000) })
      .where(eq(promoCode.id, gone.id));
    expect(await redeem(v, gone.code)).toEqual({ status: 400, body: { error: "expired" } });
  });

  it("keeps the best Premium when there's more than one code", async () => {
    await inviteOnly(false);
    const v = await signUpConfirmed(email("best"));
    const far = new Date(Date.now() + 300 * DAY);
    const near = new Date(Date.now() + 10 * DAY);
    await redeem(v, (await makeCode({ tier: "individual", until: far })).code);
    await redeem(v, (await makeCode({ tier: "household", until: near })).code);
    expect(await entitlements(v)).toMatchObject({
      tier: "household",
      ends_at: near.toISOString(),
    });
  });

  it("gives Premium with no end date, which beats any date", async () => {
    await inviteOnly(false);
    const v = await signUpConfirmed(email("forever"));
    await redeem(
      v,
      (await makeCode({ tier: "household", until: new Date(Date.now() + 9 * DAY) })).code,
    );
    const forever = await makeCode({ tier: "household", forever: true });
    expect((await redeem(v, forever.code)).status).toBe(200);
    expect(await entitlements(v)).toMatchObject({
      tier: "household",
      source: "promo_code",
      ends_at: null,
    });
    const householdId = (await v.session())!.session.activeOrganizationId!;
    // Still there in a hundred years.
    expect(await activeGrant(db(), householdId, new Date(Date.now() + 36500 * DAY))).toEqual({
      tier: "household",
      endsAt: null,
    });
  });

  it("goes back to Free when the Premium ends", async () => {
    await inviteOnly(false);
    const v = await signUpConfirmed(email("ends"));
    const promo = await makeCode({ days: 5 });
    await redeem(v, promo.code);
    const householdId = (await v.session())!.session.activeOrganizationId!;
    expect(await activeGrant(db(), householdId)).not.toBeNull();
    expect(await activeGrant(db(), householdId, new Date(Date.now() + 6 * DAY))).toBeNull();
  });

  it("is limited in how fast codes can be tried", async () => {
    await inviteOnly(false);
    const v = await signUpConfirmed(email("fast"));
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await redeem(v, "GUESS-5678")).status;
    expect(last).toBe(429);
  });

  it("can't take a code's last use twice", async () => {
    await inviteOnly(false);
    const a = await signUpConfirmed(email("racea"));
    const b = await signUpConfirmed(email("raceb"));
    const promo = await makeCode({ maxUses: 1 });
    const [ra, rb] = await Promise.all([redeem(a, promo.code), redeem(b, promo.code)]);
    expect([ra.status, rb.status].sort()).toEqual([200, 400]);
    expect(await uses(promo.id)).toBe(1);
  });

  it("works through redeemCode for the same person only once, even at the same moment", async () => {
    await inviteOnly(false);
    const v = await signUpConfirmed(email("twice"));
    const s = (await v.session())!;
    const promo = await makeCode();
    const who = { userId: s.user.id, householdId: s.session.activeOrganizationId! };
    const results = await Promise.all([
      redeemCode(db(), promo.code, who),
      redeemCode(db(), promo.code, who),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await uses(promo.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the admin console's code tools", () => {
  let admin: Visitor;
  let adminId: string;

  beforeAll(async () => {
    await inviteOnly(false);
    admin = await signUpConfirmed(email("admin"), "Admin");
    const s = (await admin.session())!;
    adminId = s.user.id;
    await db().update(user).set({ role: "admin" }).where(eq(user.id, adminId));
    await db()
      .update(session)
      .set({ authMethod: "passkey", lastActiveAt: new Date() })
      .where(eq(session.id, s.session.id));
  });

  beforeEach(async () => {
    await db().update(session).set({ lastActiveAt: new Date() }).where(eq(session.userId, adminId));
  });

  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await admin.request(path, init);
    return { status: res.status, body: (await res.json()) as unknown };
  };

  const latestAudit = () =>
    db().select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(1).get();

  it("are for admins only", async () => {
    await inviteOnly(false);
    const someone = await signUpConfirmed(email("notadmin"));
    for (const path of ["/api/admin/codes", "/api/admin/settings"]) {
      expect((await someone.request(path)).status).toBe(403);
    }
    expect((await visitor().request("/api/admin/codes")).status).toBe(401);
  });

  it("make a random invite code, recorded in the audit log", async () => {
    const until = new Date(Date.now() + 60 * DAY).toISOString();
    const made = await call("/api/admin/codes", {
      body: {
        label: "Beta testers",
        tier: "household",
        access: { until },
        allowsSignUp: true,
        maxUses: 25,
        redeemBy: null,
      },
    });
    expect(made.status).toBe(201);
    const code = made.body as AdminCode;
    expect(code).toMatchObject({
      label: "Beta testers",
      tier: "household",
      access: { until },
      allowsSignUp: true,
      maxUses: 25,
      uses: 0,
      status: "active",
    });
    expect(code.code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);

    const audit = await latestAudit();
    expect(audit).toMatchObject({ adminUserId: adminId, action: "code.created" });
    expect(JSON.parse(audit!.details!)).toMatchObject({ code: code.code, label: "Beta testers" });

    const list = (await call("/api/admin/codes")).body as AdminCode[];
    expect(list.map((c) => c.code)).toContain(code.code);
  });

  it("make a code with no end date, and end it by turning the code off", async () => {
    const made = await call("/api/admin/codes", {
      body: {
        label: "Family",
        tier: "household",
        access: { forever: true },
        allowsSignUp: true,
        maxUses: 1,
        redeemBy: null,
      },
    });
    expect(made.status).toBe(201);
    const code = made.body as AdminCode;
    expect(code).toMatchObject({ access: { forever: true }, status: "active" });

    const friend = await signUpConfirmed(email("friend"));
    await friend.request("/api/codes/redeem", { body: { code: code.code } });
    expect(await entitlements(friend)).toMatchObject({ tier: "household", ends_at: null });
    const detail = (await call(`/api/admin/codes/${code.id}`)).body as { uses: AdminCodeUse[] };
    expect(detail.uses[0]).toMatchObject({ endsAt: null, ended: false });
    // There's no date to move.
    expect(
      (
        await call(`/api/admin/codes/${code.id}`, {
          method: "PATCH",
          body: { accessUntil: new Date(Date.now() + DAY).toISOString() },
        })
      ).body,
    ).toEqual({ error: "not_a_date_code" });

    await call(`/api/admin/codes/${code.id}/disable`, { body: { endAccess: true } });
    expect(await entitlements(friend)).toMatchObject({ tier: "free" });
  });

  it("take a chosen code, once", async () => {
    const body = {
      code: "spring-2027",
      label: "Spring promo",
      tier: "individual",
      access: { days: 30 },
      allowsSignUp: false,
      maxUses: null,
      redeemBy: null,
    };
    const made = await call("/api/admin/codes", { body });
    expect(made.status).toBe(201);
    expect((made.body as AdminCode).code).toBe("SPRING-2027");
    expect(await call("/api/admin/codes", { body })).toEqual({
      status: 409,
      body: { error: "code_taken" },
    });
  });

  it("refuse codes that don't make sense", async () => {
    const good = {
      label: "Fine",
      tier: "household",
      access: { days: 30 },
      allowsSignUp: true,
      maxUses: null,
      redeemBy: null,
    };
    const errorFor = async (changes: Record<string, unknown>) =>
      (
        (await call("/api/admin/codes", { body: { ...good, ...changes } })).body as {
          error: string;
        }
      ).error;
    expect(await errorFor({ label: " " })).toBe("invalid_label");
    expect(await errorFor({ tier: "free" })).toBe("invalid_tier");
    expect(await errorFor({ access: { days: 0 } })).toBe("invalid_access");
    expect(await errorFor({ access: { until: "2001-01-01T00:00:00.000Z" } })).toBe(
      "invalid_access",
    );
    expect(await errorFor({ access: {} })).toBe("invalid_access");
    expect(await errorFor({ access: { forever: "yes" } })).toBe("invalid_access");
    expect(await errorFor({ maxUses: 0 })).toBe("invalid_max_uses");
    expect(await errorFor({ redeemBy: "yesterday" })).toBe("invalid_redeem_by");
    expect(await errorFor({ code: "x" })).toBe("invalid_code");
  });

  it("move a date code's end for everyone who used it", async () => {
    const until = new Date(Date.now() + 30 * DAY);
    const code = await makeCode({ until });
    const tester = await signUpConfirmed(email("tester"));
    await tester.request("/api/codes/redeem", { body: { code: code.code } });
    expect((await entitlements(tester)).ends_at).toBe(until.toISOString());

    const later = new Date(Date.now() + 200 * DAY).toISOString();
    const moved = await call(`/api/admin/codes/${code.id}`, {
      method: "PATCH",
      body: { accessUntil: later },
    });
    expect(moved.status).toBe(200);
    expect((await entitlements(tester)).ends_at).toBe(later);

    const audit = await latestAudit();
    expect(audit?.action).toBe("code.updated");
    expect(JSON.parse(audit!.details!)).toMatchObject({ changes: { accessUntil: later } });

    const detail = (await call(`/api/admin/codes/${code.id}`)).body as {
      code: AdminCode;
      uses: AdminCodeUse[];
    };
    expect(detail.uses).toHaveLength(1);
    expect(detail.uses[0]).toMatchObject({ name: "June Lee", endsAt: later, ended: false });
  });

  it("only move dates on date codes", async () => {
    const code = await makeCode({ days: 10 });
    expect(
      await call(`/api/admin/codes/${code.id}`, {
        method: "PATCH",
        body: { accessUntil: new Date(Date.now() + DAY).toISOString() },
      }),
    ).toEqual({ status: 400, body: { error: "not_a_date_code" } });
    expect(await call(`/api/admin/codes/${code.id}`, { method: "PATCH", body: {} })).toEqual({
      status: 400,
      body: { error: "no_changes" },
    });
    expect((await call("/api/admin/codes/nope")).status).toBe(404);
  });

  it("turn a code off, keeping what people already have", async () => {
    const code = await makeCode();
    const tester = await signUpConfirmed(email("keeps"));
    await tester.request("/api/codes/redeem", { body: { code: code.code } });
    const off = await call(`/api/admin/codes/${code.id}/disable`, {
      body: { endAccess: false },
    });
    expect((off.body as AdminCode).status).toBe("disabled");
    expect((await entitlements(tester)).tier).toBe("household");

    const late = await signUpConfirmed(email("late"));
    expect((await late.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(
      400,
    );
    expect(
      (await call(`/api/admin/codes/${code.id}/disable`, { body: { endAccess: true } })).status,
    ).toBe(409);
  });

  it("turn a code off and end its Premium for everyone", async () => {
    const code = await makeCode();
    const tester = await signUpConfirmed(email("ended"));
    await tester.request("/api/codes/redeem", { body: { code: code.code } });
    await call(`/api/admin/codes/${code.id}/disable`, { body: { endAccess: true } });
    expect(await entitlements(tester)).toMatchObject({ tier: "free", source: "free" });

    const audit = await latestAudit();
    expect(audit?.action).toBe("code.disabled");
    expect(JSON.parse(audit!.details!)).toMatchObject({ code: code.code, endAccess: true });
    const detail = (await call(`/api/admin/codes/${code.id}`)).body as { uses: AdminCodeUse[] };
    expect(detail.uses[0]?.ended).toBe(true);
  });

  it("switch invite-only sign-up, recorded in the audit log", async () => {
    expect(await call("/api/admin/settings")).toEqual({
      status: 200,
      body: { signUpRequiresCode: false },
    });
    expect(
      await call("/api/admin/settings", { method: "PUT", body: { signUpRequiresCode: true } }),
    ).toEqual({ status: 200, body: { signUpRequiresCode: true } });
    const audit = await latestAudit();
    expect(audit?.action).toBe("setting.changed");
    expect(JSON.parse(audit!.details!)).toMatchObject({
      key: "sign_up_requires_code",
      from: false,
      to: true,
    });
    expect((await signUpWith(email("closed"))).res.status).toBe(400);
    expect(
      (await call("/api/admin/settings", { method: "PUT", body: { signUpRequiresCode: "no" } }))
        .status,
    ).toBe(400);
    await inviteOnly(false);
  });
});
