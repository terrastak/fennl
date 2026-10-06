import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AccountDetail, AccountMatch } from "../../shared/adminAccounts";
import type { EmailStatus } from "../../shared/email";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import {
  account,
  adminAuditLog,
  emailChange,
  organization,
  promoCode,
  session,
  user,
} from "../db/schema";
import { devOutbox } from "../email/outbox";
import { personalSlug } from "../household/household";
import {
  PASSWORD,
  linkInLatestEmail,
  setUpDatabase,
  signUp,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";
import { completeEmailChange, startEmailChange } from "./emailChange";
import { removeUnverifiedAccounts } from "./purge";

const db = () => database(env.DB);
const HOUR = 60 * 60 * 1000;
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;

async function userId(v: Visitor) {
  return (await v.session())!.user.id;
}

async function findUser(id: string) {
  return db().select().from(user).where(eq(user.id, id)).get();
}

/** The secret in the newest email-change link sent to an address. */
function tokenInLatestEmail(to: string): string {
  const link = linkInLatestEmail(to);
  expect(link).toMatch(/^\/verify-email-change\?token=/);
  return new URL(`http://x${link}`).searchParams.get("token")!;
}

async function verify(token: string) {
  const res = await visitor().request("/api/account/email/verify", { body: { token } });
  return ((await res.json()) as { result: string }).result;
}

async function signIn(address: string) {
  const v = visitor();
  const res = await v.request("/api/auth/sign-in/email", {
    body: { email: address, password: PASSWORD },
  });
  return res.status;
}

beforeAll(async () => {
  await setUpDatabase();
});

describe("verified dates", () => {
  it("are recorded when the email link is opened", async () => {
    const before = Date.now();
    const v = await signUpConfirmed(email("dated"));
    const row = await findUser(await userId(v));
    expect(row?.emailVerified).toBe(true);
    expect(row?.emailVerifiedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("stay empty for an address that isn't verified", async () => {
    const address = email("undated");
    await signUp(address);
    const row = await db().select().from(user).where(eq(user.email, address)).get();
    expect(row?.emailVerifiedAt).toBeNull();
  });
});

describe("changing your own email", () => {
  it("waits for the new address's link, then switches and tells the old address", async () => {
    const oldAddress = email("old");
    const newAddress = email("NEW").toUpperCase();
    const v = await signUpConfirmed(oldAddress, "Rosa Lee");
    const id = await userId(v);

    const started = await v.request("/api/account/email", { body: { newEmail: newAddress } });
    expect(started.status).toBe(200);
    const lower = newAddress.toLowerCase();
    expect(await started.json()).toMatchObject({ pending: { email: lower } });
    const [mail] = devOutbox.list(lower);
    expect(mail?.subject).toBe("Verify your new email for Fennl");

    // Nothing changes until the link is opened.
    expect((await findUser(id))?.email).toBe(oldAddress);
    const status = (await (await v.request("/api/account/email")).json()) as EmailStatus;
    expect(status).toMatchObject({ email: oldAddress, pending: { email: lower } });

    const token = tokenInLatestEmail(lower);
    expect(await verify(token)).toBe("done");
    const after = await findUser(id);
    expect(after).toMatchObject({ email: lower, emailVerified: true });
    expect(after?.emailVerifiedAt).not.toBeNull();

    const [notice] = devOutbox.list(oldAddress);
    expect(notice?.subject).toBe("Your Fennl email address was changed");
    expect(notice?.text).toContain(`n•••@example.com`);
    expect(notice?.text).not.toContain(lower);

    // The link works once. Sign-in uses the new address, and this browser stays signed in.
    expect(await verify(token)).toBe("invalid");
    expect(await signIn(lower)).toBe(200);
    expect(await signIn(oldAddress)).toBe(401);
    expect((await v.session())?.user.email).toBe(lower);
    expect(
      ((await (await v.request("/api/account/email")).json()) as EmailStatus).pending,
    ).toBeNull();
  });

  it("checks the address", async () => {
    const address = email("checks");
    const v = await signUpConfirmed(address);
    const start = async (newEmail: unknown) =>
      (await (await v.request("/api/account/email", { body: { newEmail } })).json()) as unknown;
    expect(await start("not an email")).toEqual({ error: "invalid_email" });
    expect(await start(` ${address.toUpperCase()} `)).toEqual({ error: "same_email" });
    expect(
      (await visitor().request("/api/account/email", { body: { newEmail: "a@b.co" } })).status,
    ).toBe(401);
  });

  it("answers the same for an address another account has, but sends nothing", async () => {
    const taken = email("taken");
    await signUpConfirmed(taken);
    const v = await signUpConfirmed(email("wants"));
    const before = devOutbox.list(taken).length;
    const res = await v.request("/api/account/email", { body: { newEmail: taken } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pending: { email: taken } });
    expect(devOutbox.list(taken)).toHaveLength(before);
  });

  it("refuses an address taken while the link was waiting", async () => {
    const v = await signUpConfirmed(email("slow"));
    const person = (await findUser(await userId(v)))!;
    const wanted = email("wanted");
    const { token } = await startEmailChange(db(), person, wanted, null);
    await signUpConfirmed(wanted);
    expect((await completeEmailChange(db(), token)).result).toBe("in_use");
    expect((await findUser(person.id))?.email).toBe(person.email);
  });

  it("expires after 24 hours, keeping the old address", async () => {
    const v = await signUpConfirmed(email("late"));
    const person = (await findUser(await userId(v)))!;
    const { token } = await startEmailChange(db(), person, email("never"), null);
    const later = new Date(Date.now() + 24 * HOUR + 1000);
    expect((await completeEmailChange(db(), token, later)).result).toBe("expired");
    expect((await findUser(person.id))?.email).toBe(person.email);
  });

  it("uses only the newest request, and can be cancelled", async () => {
    const v = await signUpConfirmed(email("twice"));
    const first = email("first");
    const second = email("second");
    await v.request("/api/account/email", { body: { newEmail: first } });
    await v.request("/api/account/email", { body: { newEmail: second } });
    expect(await verify(tokenInLatestEmail(first))).toBe("invalid");

    const res = await v.request("/api/account/email/pending", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await verify(tokenInLatestEmail(second))).toBe("invalid");
    expect((await v.request("/api/account/email/pending", { method: "DELETE" })).status).toBe(404);
  });

  it("asks for a fresh sign-in after a day", async () => {
    const v = await signUpConfirmed(email("stale"));
    await db()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 25 * HOUR) })
      .where(eq(session.userId, await userId(v)));
    const res = await v.request("/api/account/email", { body: { newEmail: email("fresh") } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "sign_in_again" });
  });

  it("refuses links that were never sent", async () => {
    expect(await verify("nonsense")).toBe("invalid");
    expect(await verify("a".repeat(64))).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------------------------

describe("the admin console", () => {
  let admin: Visitor;
  let adminId: string;

  beforeAll(async () => {
    admin = await signUpConfirmed(email("admin"), "Admin");
    adminId = await userId(admin);
    await db().update(user).set({ role: "admin" }).where(eq(user.id, adminId));
  });

  beforeEach(async () => {
    // A passkey sign-in just now: fresh enough for sensitive actions.
    await db()
      .update(session)
      .set({ authMethod: "passkey", createdAt: new Date(), lastActiveAt: new Date() })
      .where(eq(session.userId, adminId));
  });

  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await admin.request(path, init);
    return { status: res.status, body: (await res.json()) as unknown };
  };

  const latestAudit = () =>
    db().select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(1).get();

  it("shows in search whether each address is verified, and when", async () => {
    const verified = email("searchv");
    await signUpConfirmed(verified);
    const unverified = email("searchu");
    await signUp(unverified);
    const matches = (await call("/api/admin/accounts?q=search")).body as AccountMatch[];
    const v = matches.find((m) => m.email === verified);
    const u = matches.find((m) => m.email === unverified);
    expect(v?.emailVerified).toBe(true);
    expect(v?.emailVerifiedAt).not.toBeNull();
    expect(u).toMatchObject({ emailVerified: false, emailVerifiedAt: null });
  });

  it("changes someone's email through the same link, then can put the old one back", async () => {
    const original = email("original");
    const person = await signUpConfirmed(original, "Petra Ng");
    const id = await userId(person);
    const originalVerifiedAt = (await findUser(id))?.emailVerifiedAt;

    // Their own change, as if someone took the account over.
    const thief = email("thief");
    await person.request("/api/account/email", { body: { newEmail: thief } });
    expect(await verify(tokenInLatestEmail(thief))).toBe("done");

    // Support puts the original address back: at once, signed out, with a reset email.
    const restored = await call(`/api/admin/accounts/${id}/email/restore`, {
      body: { email: original },
    });
    expect(restored.status).toBe(200);
    const { detail, sessionsEnded } = restored.body as {
      detail: AccountDetail;
      sessionsEnded: number;
    };
    expect(detail.email).toBe(original);
    expect(sessionsEnded).toBeGreaterThan(0);
    expect(await person.session()).toBeNull();
    expect(linkInLatestEmail(original)).toMatch(/^\/api\/auth\/reset-password\//);
    expect((await findUser(id))?.emailVerifiedAt?.getTime()).toBe(originalVerifiedAt?.getTime());
    expect(await latestAudit()).toMatchObject({
      action: "account.email_restored",
      adminUserId: adminId,
      targetUserId: id,
    });
    expect(detail.emailHistory.map((h) => [h.kind, h.oldEmail, h.newEmail])).toEqual([
      ["restore", thief, original],
      ["change", original, thief],
    ]);
    expect(detail.previousEmails).toEqual([thief]);

    // Only addresses the account used before.
    expect(
      (await call(`/api/admin/accounts/${id}/email/restore`, { body: { email: email("other") } }))
        .body,
    ).toEqual({ error: "not_previous" });

    // An admin's change waits for the link too.
    const fixed = email("fixed");
    const started = await call(`/api/admin/accounts/${id}/email`, { body: { newEmail: fixed } });
    expect(started.status).toBe(200);
    expect((started.body as AccountDetail).pendingEmailChange).toMatchObject({
      email: fixed,
      bySupport: true,
    });
    expect(devOutbox.list(fixed)[0]?.text).toContain("Fennl support is changing");
    expect((await findUser(id))?.email).toBe(original);
    expect(await latestAudit()).toMatchObject({ action: "account.email_change_started" });

    const cancelled = await call(`/api/admin/accounts/${id}/email-change`, { method: "DELETE" });
    expect((cancelled.body as AccountDetail).pendingEmailChange).toBeNull();
    expect(await verify(tokenInLatestEmail(fixed))).toBe("invalid");
  });

  it("refuses taken addresses and admin accounts, and asks for the passkey", async () => {
    const taken = email("taken-admin");
    await signUpConfirmed(taken);
    const person = await signUpConfirmed(email("someone"));
    const id = await userId(person);
    expect(await call(`/api/admin/accounts/${id}/email`, { body: { newEmail: taken } })).toEqual({
      status: 409,
      body: { error: "email_in_use" },
    });
    expect(
      (await call(`/api/admin/accounts/${adminId}/email`, { body: { newEmail: email("x") } })).body,
    ).toEqual({ error: "target_is_admin" });

    await db()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(session.userId, adminId));
    expect(
      (await call(`/api/admin/accounts/${id}/email`, { body: { newEmail: email("y") } })).body,
    ).toEqual({ error: "passkey_reconfirm" });
  });
});

// ---------------------------------------------------------------------------------------------

describe("accounts never verified", () => {
  const exists = async (address: string) =>
    (await db().select().from(user).where(eq(user.email, address)).get()) !== undefined;

  it("are removed after 24 hours, giving back their invite code's use", async () => {
    const code = await createCode(
      db(),
      {
        code: `PURGE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        label: "Purge test",
        tier: "household",
        access: { forever: true },
        allowsSignUp: true,
        maxUses: 1,
        redeemBy: null,
      },
      null,
    );
    const typo = email("typo");
    const v = visitor();
    expect((await v.request("/api/sign-up/code", { body: { code: code.code } })).status).toBe(200);
    expect(
      (
        await v.request("/api/auth/sign-up/email", {
          body: { name: "Typo", email: typo, password: PASSWORD, callbackURL: "/" },
        })
      ).status,
    ).toBe(200);
    const typoId = (await db().select().from(user).where(eq(user.email, typo)).get())!.id;
    const usesOf = async () =>
      (await db().select().from(promoCode).where(eq(promoCode.id, code.id)).get())?.uses;
    expect(await usesOf()).toBe(1);

    const recent = email("recent");
    await signUp(recent);
    const verified = email("verified");
    await signUpConfirmed(verified);

    // Not yet 24 hours: nothing goes.
    expect(await removeUnverifiedAccounts(db())).not.toContain(typo);

    const later = new Date(Date.now() + 24 * HOUR + 60_000);
    const removed = await removeUnverifiedAccounts(db(), later);
    expect(removed).toEqual(expect.arrayContaining([typo, recent]));
    expect(removed).not.toContain(verified);
    expect(await exists(typo)).toBe(false);
    expect(await exists(verified)).toBe(true);
    expect(await usesOf()).toBe(0);
    expect(
      await db()
        .select()
        .from(organization)
        .where(eq(organization.slug, personalSlug(typoId)))
        .get(),
    ).toBeUndefined();

    // The address is free again, and so is the code.
    const again = visitor();
    expect((await again.request("/api/sign-up/code", { body: { code: code.code } })).status).toBe(
      200,
    );
  });

  it("leaves Google and Apple accounts, admins, and accounts support is fixing", async () => {
    const google = email("google");
    await signUp(google);
    const googleId = (await db().select().from(user).where(eq(user.email, google)).get())!.id;
    await db().insert(account).values({
      id: crypto.randomUUID(),
      accountId: "google-123",
      providerId: "google",
      userId: googleId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const adminAddress = email("unverified-admin");
    await signUp(adminAddress);
    await db().update(user).set({ role: "admin" }).where(eq(user.email, adminAddress));

    const fixing = email("fixing");
    await signUp(fixing);
    const person = (await db().select().from(user).where(eq(user.email, fixing)).get())!;
    const later = new Date(Date.now() + 24 * HOUR + 60_000);
    // Support started a change shortly before the cutoff; it's still waiting.
    await startEmailChange(db(), person, email("right"), null, new Date(later.getTime() - HOUR));

    const removed = await removeUnverifiedAccounts(db(), later);
    expect(removed).not.toContain(google);
    expect(removed).not.toContain(adminAddress);
    expect(removed).not.toContain(fixing);
    expect(
      await db().select().from(emailChange).where(eq(emailChange.userId, person.id)).get(),
    ).toBeDefined();
  });
});
