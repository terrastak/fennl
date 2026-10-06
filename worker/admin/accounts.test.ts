import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AccountDetail, AccountMatch, PlanLimitRow } from "../../shared/adminAccounts";
import type { Entitlements } from "../../shared/entitlements";
import { database } from "../db/client";
import { adminAuditLog, session, user } from "../db/schema";
import { devOutbox } from "../email/outbox";
import {
  linkInLatestEmail,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";
import { appOrigin } from "./accountRoutes";

const db = () => database(env.DB);
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;

let admin: Visitor;
let adminId: string;

async function adminSession(v: Visitor) {
  return (await v.session())!.session.id;
}

/** An admin signed in with a passkey just now (fresh enough for sensitive actions). */
async function freshAdmin() {
  await db()
    .update(session)
    .set({ authMethod: "passkey", createdAt: new Date(), lastActiveAt: new Date() })
    .where(eq(session.id, await adminSession(admin)));
}

beforeAll(async () => {
  await setUpDatabase();
  admin = await signUpConfirmed(email("admin"), "Admin");
  adminId = (await admin.session())!.user.id;
  await db().update(user).set({ role: "admin" }).where(eq(user.id, adminId));
});

beforeEach(async () => {
  await freshAdmin();
});

const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const res = await admin.request(path, init);
  return { status: res.status, body: (await res.json()) as unknown };
};

const latestAudit = () =>
  db().select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(1).get();

async function userId(v: Visitor) {
  return (await v.session())!.user.id;
}

describe("the account tools", () => {
  it("are for admins only", async () => {
    const someone = await signUpConfirmed(email("someone"));
    for (const path of ["/api/admin/accounts?q=ex", "/api/admin/limits"]) {
      expect((await someone.request(path)).status).toBe(403);
    }
    expect((await visitor().request("/api/admin/accounts?q=ex")).status).toBe(401);
  });

  it("find accounts by email or name", async () => {
    const address = email("findable");
    await signUpConfirmed(address, "Marisol Quince");
    const byEmail = (await call(`/api/admin/accounts?q=${address.slice(0, 10)}`))
      .body as AccountMatch[];
    expect(byEmail.map((m) => m.email)).toContain(address);
    const byName = (await call("/api/admin/accounts?q=quince")).body as AccountMatch[];
    expect(byName.map((m) => m.email)).toContain(address);
    expect((await call("/api/admin/accounts?q=q")).body).toEqual([]);
    // "%" is searched for literally, not as "anything".
    expect((await call("/api/admin/accounts?q=%25%25")).body).toEqual([]);
  });

  it("show an account's page, and record that it was looked at", async () => {
    const address = email("detail");
    const v = await signUpConfirmed(address, "Rosa Lee");
    const id = await userId(v);
    const res = await call(`/api/admin/accounts/${id}`);
    expect(res.status).toBe(200);
    const detail = res.body as AccountDetail;
    expect(detail).toMatchObject({
      id,
      name: "Rosa Lee",
      email: address,
      emailVerified: true,
      signInMethods: ["credential"],
      mustChangePassword: false,
      grants: [],
      overrides: [],
      usage: null,
    });
    expect(detail.plan?.tier).toBe("free");
    expect(detail.household?.members).toEqual([{ name: "Rosa Lee", email: address }]);
    expect(detail.lastSeenAt).not.toBeNull();
    expect(await latestAudit()).toMatchObject({
      action: "account.viewed",
      adminUserId: adminId,
      targetUserId: id,
    });
    expect((await call("/api/admin/accounts/nope")).status).toBe(404);
  });
});

describe("password help", () => {
  it("sends Better Auth's reset email, and can sign the account out everywhere", async () => {
    const address = email("reset");
    const v = await signUpConfirmed(address);
    const res = await call(`/api/admin/accounts/${await userId(v)}/password-reset`, {
      body: { signOutEverywhere: true },
    });
    expect(res).toMatchObject({ status: 200, body: { ok: true, sessionsEnded: 1 } });
    expect(linkInLatestEmail(address)).toMatch(/^\/api\/auth\/reset-password\//);
    expect(await v.session()).toBeNull();
    expect(await latestAudit()).toMatchObject({ action: "account.password_reset_sent" });
  });

  it("links to the app's address from the admin address", () => {
    const fromAdmin = new Request("https://admin.example.test/api/admin/accounts/x/password-reset");
    expect(appOrigin({ ...env, APP_HOSTNAME: "beta.example.test" }, fromAdmin)).toBe(
      "https://beta.example.test",
    );
    expect(appOrigin(env, new Request("http://localhost/api/admin/x"))).toBe("http://localhost");
  });

  it("sets a temporary password that must be changed at the next sign-in", async () => {
    const address = email("temporary");
    const v = await signUpConfirmed(address);
    const id = await userId(v);

    const res = await call(`/api/admin/accounts/${id}/temporary-password`, { body: {} });
    expect(res.status).toBe(200);
    const { password, sessionsEnded } = res.body as { password: string; sessionsEnded: number };
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(sessionsEnded).toBe(1);
    expect(await v.session()).toBeNull();

    // The audit log and the notice email never contain the password.
    const audit = await latestAudit();
    expect(audit?.action).toBe("account.temporary_password_set");
    expect(JSON.stringify(audit)).not.toContain(password);
    const [notice] = devOutbox.list(address);
    expect(notice?.subject).toBe("Your Fennl password was reset by support");
    expect(notice?.text).not.toContain(password);

    // The person signs in with it, and must choose a new one before anything else.
    const back = visitor();
    const signIn = await back.request("/api/auth/sign-in/email", {
      body: { email: address, password },
    });
    expect(signIn.status).toBe(200);
    expect((await back.request("/api/household")).status).toBe(403);
    const wrong = await back.request("/api/account/password", {
      body: { currentPassword: "not it at all", newPassword: "a brand new password" },
    });
    expect(wrong.status).toBe(400);
    const same = await back.request("/api/account/password", {
      body: { currentPassword: password, newPassword: password },
    });
    expect(await same.json()).toEqual({ error: "SAME_PASSWORD" });
    const changed = await back.request("/api/account/password", {
      body: { currentPassword: password, newPassword: "a brand new password" },
    });
    expect(changed.status).toBe(200);
    expect((await back.request("/api/household")).status).toBe(200);
  });

  it("asks for the passkey again when the admin's passkey sign-in is older than 5 minutes", async () => {
    const v = await signUpConfirmed(email("stale"));
    await db()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(session.id, await adminSession(admin)));
    expect(
      await call(`/api/admin/accounts/${await userId(v)}/temporary-password`, { body: {} }),
    ).toEqual({ status: 403, body: { error: "passkey_reconfirm" } });
  });

  it("never sets a temporary password on an admin account", async () => {
    const other = await signUpConfirmed(email("otheradmin"));
    const id = await userId(other);
    await db().update(user).set({ role: "admin" }).where(eq(user.id, id));
    expect(await call(`/api/admin/accounts/${id}/temporary-password`, { body: {} })).toEqual({
      status: 403,
      body: { error: "target_is_admin" },
    });
  });

  it("lets a reset email replace a temporary password", async () => {
    const address = email("both");
    const v = await signUpConfirmed(address);
    const id = await userId(v);
    await call(`/api/admin/accounts/${id}/temporary-password`, { body: {} });
    const reset = visitor();
    await reset.request("/api/auth/request-password-reset", {
      body: { email: address, redirectTo: "/reset-password" },
    });
    const token = new URL(`http://x${linkInLatestEmail(address)}`).pathname.split("/").pop()!;
    const done = await reset.request("/api/auth/reset-password", {
      body: { newPassword: "chosen by the person", token },
    });
    expect(done.status).toBe(200);
    const row = await db().select().from(user).where(eq(user.id, id)).get();
    expect(row?.mustChangePassword).toBe(false);
  });
});

describe("limits", () => {
  it("set and remove an exception for one account", async () => {
    const v = await signUpConfirmed(email("override"));
    const id = await userId(v);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const set = await call(`/api/admin/accounts/${id}/overrides/max_recipes`, {
      method: "PUT",
      body: { value: 500, expiresAt, note: "Big Paprika library" },
    });
    expect(set.status).toBe(200);
    expect((set.body as AccountDetail).overrides).toEqual([
      expect.objectContaining({ key: "max_recipes", value: 500, note: "Big Paprika library" }),
    ]);
    const plan = (await (await v.request("/api/entitlements")).json()) as Entitlements;
    expect(plan.max_recipes).toBe(500);
    expect(await latestAudit()).toMatchObject({ action: "limit.override_set", targetUserId: id });

    const bad = async (key: string, body: unknown) =>
      (await call(`/api/admin/accounts/${id}/overrides/${key}`, { method: "PUT", body })).body;
    expect(await bad("nonsense", { value: 1 })).toEqual({ error: "invalid_key" });
    expect(await bad("max_recipes", { value: -1 })).toEqual({ error: "invalid_value" });
    expect(await bad("max_recipes", { value: 1, expiresAt: "2001-01-01T00:00:00Z" })).toEqual({
      error: "invalid_expiry",
    });

    const removed = await call(`/api/admin/accounts/${id}/overrides/max_recipes`, {
      method: "DELETE",
    });
    expect((removed.body as AccountDetail).overrides).toEqual([]);
    expect(
      (await call(`/api/admin/accounts/${id}/overrides/max_recipes`, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("change a plan's limit for everyone on it", async () => {
    const rows = (await call("/api/admin/limits")).body as PlanLimitRow[];
    expect(rows).toContainEqual(
      expect.objectContaining({ tier: "free", key: "max_recipes", value: 100 }),
    );
    const changed = await call("/api/admin/limits/free/max_recipes", {
      method: "PUT",
      body: { value: 150 },
    });
    expect(changed.body).toContainEqual(
      expect.objectContaining({ tier: "free", key: "max_recipes", value: 150 }),
    );
    const v = await signUpConfirmed(email("freelimit"));
    expect(
      ((await (await v.request("/api/entitlements")).json()) as Entitlements).max_recipes,
    ).toBe(150);
    const audit = await latestAudit();
    expect(audit?.action).toBe("limit.tier_changed");
    expect(JSON.parse(audit!.details!)).toMatchObject({
      tier: "free",
      key: "max_recipes",
      from: 100,
      to: 150,
    });
    expect(
      (await call("/api/admin/limits/gold/max_recipes", { method: "PUT", body: { value: 1 } }))
        .status,
    ).toBe(400);
    await call("/api/admin/limits/free/max_recipes", { method: "PUT", body: { value: 100 } });
  });
});

describe("the activity log", () => {
  it("can show only what was done to one account, with names", async () => {
    const address = email("logged");
    const v = await signUpConfirmed(address);
    const id = await userId(v);
    await call(`/api/admin/accounts/${id}`);
    const rows = (await call(`/api/admin/audit?account=${id}`)).body as {
      targetUserId: string | null;
      adminUserId: string;
      targetEmail: string | null;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.targetUserId === id || r.adminUserId === id)).toBe(true);
    expect(rows[0]?.targetEmail).toBe(address);
  });
});
