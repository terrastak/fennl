import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { database } from "../db/client";
import { adminAuditLog, passkey, session, user } from "../db/schema";
import { devOutbox } from "../email/outbox";
import app from "../index";
import { PASSWORD, signUpConfirmed, visitor, type Visitor, setUpDatabase } from "../test/visitor";
import { ADMIN_IDLE_MS, ADMIN_MAX_MS, hasFreshPasskey, type AdminContext } from "./requireAdmin";

const db = () => database(env.DB);

beforeAll(async () => {
  await setUpDatabase();
});

/** A stand-in for the built files: answers with the path it was asked for. */
const ASSETS = {
  fetch: async (input: RequestInfo | URL) =>
    new Response(`asset ${new URL(input instanceof Request ? input.url : input).pathname}`),
} as unknown as Fetcher;

async function makeAdmin(v: Visitor) {
  const userId = (await v.session())!.user.id;
  await db().update(user).set({ role: "admin" }).where(eq(user.id, userId));
  return userId;
}

async function sessionId(v: Visitor) {
  return (await v.session())!.session.id;
}

async function usePasskeySession(v: Visitor) {
  await db()
    .update(session)
    .set({ authMethod: "passkey", lastActiveAt: new Date() })
    .where(eq(session.id, await sessionId(v)));
}

async function addPasskey(userId: string) {
  await db().insert(passkey).values({
    id: crypto.randomUUID(),
    name: "Test key",
    publicKey: "test",
    userId,
    credentialID: crypto.randomUUID(),
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    createdAt: new Date(),
  });
}

async function me(v: Visitor, options: { withoutAccess?: boolean } = {}) {
  const { ACCESS_DEV_BYPASS, ...rest } = env;
  const testEnv: Env = options.withoutAccess
    ? { ...rest, ASSETS }
    : { ...rest, ASSETS, ...(ACCESS_DEV_BYPASS ? { ACCESS_DEV_BYPASS } : {}) };
  const res = await app.request(
    "http://localhost/api/admin/me",
    { headers: { cookie: v.cookie(), origin: "http://localhost" } },
    testEnv,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("the admin area's address", () => {
  const prod = { ...env, ASSETS, ADMIN_HOSTNAME: "admin.example.test" };
  const get = (url: string) => app.request(url, {}, prod);

  it("doesn't exist on the app's own address", async () => {
    expect((await get("https://beta.example.test/api/admin/me")).status).toBe(404);
    expect((await get("https://beta.example.test/admin")).status).toBe(404);
    expect(
      (await get("https://beta.example.test/api/auth/passkey/generate-authenticate-options"))
        .status,
    ).toBe(404);
  });

  it("serves only the admin console on the admin address", async () => {
    const page = await get("https://admin.example.test/settings");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/admin");
    expect((await get("https://admin.example.test/api/household")).status).toBe(404);
    expect(await (await get("https://admin.example.test/assets/admin.js")).text()).toBe(
      "asset /assets/admin.js",
    );
  });

  it("keeps the admin page itself behind Access", async () => {
    // No Access configuration and not localhost: closed.
    expect((await get("https://admin.example.test/admin")).status).toBe(403);
    const local = await app.request("http://localhost/admin", {}, { ...env, ASSETS });
    expect(await local.text()).toBe("asset /admin");
  });

  it("never exposes Better Auth's admin endpoints, so nobody can grant themselves the role", async () => {
    const v = await signUpConfirmed("role.grab@example.com");
    for (const path of ["/api/auth/admin/set-role", "/api/auth/admin/update-user"]) {
      const res = await v.request(path, { body: { userId: "x", role: "admin" } });
      expect(res.status, path).toBe(404);
    }
    await v.request("/api/auth/update-user", { body: { role: "admin" } });
    const row = await db()
      .select({ role: user.role })
      .from(user)
      .where(eq(user.email, "role.grab@example.com"))
      .get();
    expect(row?.role ?? "user").toBe("user");
  });
});

describe("admin checks", () => {
  it("refuse anyone signed out, and accounts without the admin role", async () => {
    expect((await me(visitor())).body).toEqual({ error: "signed_out" });
    const v = await signUpConfirmed("not.admin@example.com");
    expect(await me(v)).toEqual({ status: 403, body: { error: "not_admin" } });
  });

  it("refuse password sessions, offering to set up a first passkey only if there is none", async () => {
    const v = await signUpConfirmed("new.admin@example.com", "Owner");
    const userId = await makeAdmin(v);
    expect(await me(v)).toEqual({
      status: 403,
      body: { error: "passkey_required", canRegister: true },
    });
    const register = await v.request("/api/auth/passkey/generate-register-options");
    expect(register.status).toBe(200);

    await addPasskey(userId);
    expect((await me(v)).body).toEqual({ error: "passkey_required", canRegister: false });
    const again = await v.request("/api/auth/passkey/generate-register-options");
    expect(again.status).toBe(403);
  });

  it("let an admin signed in with a passkey add a backup passkey", async () => {
    const v = await signUpConfirmed("backup.admin@example.com");
    const userId = await makeAdmin(v);
    await addPasskey(userId);
    await usePasskeySession(v);
    const res = await v.request("/api/auth/passkey/generate-register-options");
    expect(res.status).toBe(200);
  });

  it("don't let non-admins register passkeys", async () => {
    const v = await signUpConfirmed("passkey.curious@example.com");
    const res = await v.request("/api/auth/passkey/generate-register-options");
    expect(res.status).toBe(403);
  });

  it("let an admin with a passkey session in", async () => {
    const v = await signUpConfirmed("real.admin@example.com", "Owner");
    const userId = await makeAdmin(v);
    await addPasskey(userId);
    await usePasskeySession(v);
    const res = await me(v);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Owner", email: "real.admin@example.com" });
    expect(res.body.passkeys).toHaveLength(1);
  });

  it("refuse everything without Cloudflare Access, even a valid admin session", async () => {
    const v = await signUpConfirmed("no.access@example.com");
    await makeAdmin(v);
    await usePasskeySession(v);
    expect(await me(v, { withoutAccess: true })).toEqual({
      status: 403,
      body: { error: "access_required" },
    });
  });

  it("end admin sessions after 30 idle minutes", async () => {
    const v = await signUpConfirmed("idle.admin@example.com");
    await makeAdmin(v);
    await usePasskeySession(v);
    const id = await sessionId(v);
    await db()
      .update(session)
      .set({ lastActiveAt: new Date(Date.now() - ADMIN_IDLE_MS - 1000) })
      .where(eq(session.id, id));
    expect((await me(v)).body).toEqual({ error: "session_expired" });
    expect(await db().select().from(session).where(eq(session.id, id)).get()).toBeUndefined();
  });

  it("end admin sessions 8 hours after signing in, however busy", async () => {
    const v = await signUpConfirmed("long.admin@example.com");
    await makeAdmin(v);
    await usePasskeySession(v);
    await db()
      .update(session)
      .set({ createdAt: new Date(Date.now() - ADMIN_MAX_MS - 1000) })
      .where(eq(session.id, await sessionId(v)));
    expect((await me(v)).body).toEqual({ error: "session_expired" });
  });

  it("treat only a passkey sign-in from the last 5 minutes as fresh", () => {
    const admin = { signedInAt: new Date() } as AdminContext;
    expect(hasFreshPasskey(admin)).toBe(true);
    expect(hasFreshPasskey(admin, new Date(Date.now() + 6 * 60 * 1000))).toBe(false);
  });
});

describe("admin audit log", () => {
  it("records every admin sign-in, keeps a write-once copy, and emails the owner", async () => {
    const v = await signUpConfirmed("logged.admin@example.com", "Owner");
    const userId = await makeAdmin(v);
    const before = devOutbox.list("owner@example.com").length;

    const signIn = await visitor().request("/api/auth/sign-in/email", {
      body: { email: "logged.admin@example.com", password: PASSWORD },
    });
    expect(signIn.status).toBe(200);

    const [row] = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.adminUserId, userId))
      .orderBy(desc(adminAuditLog.createdAt))
      .all();
    expect(row).toMatchObject({ action: "admin.sign_in" });
    expect(JSON.parse(row!.details!)).toMatchObject({ method: "password" });

    const copies = await env.AUDIT_LOG.list({ prefix: "audit/" });
    const copy = copies.objects.find((o) => o.key.endsWith(`${row!.id}.json`));
    expect(copy).toBeDefined();

    const alerts = devOutbox.list("owner@example.com");
    expect(alerts.length).toBe(before + 1);
    expect(alerts[0]?.subject).toBe("Fennl admin sign-in");
    expect(alerts[0]?.text).toContain("logged.admin@example.com");
  });

  it("ignores ordinary accounts", async () => {
    await signUpConfirmed("ordinary@example.com");
    const before = devOutbox.list("owner@example.com").length;
    await visitor().request("/api/auth/sign-in/email", {
      body: { email: "ordinary@example.com", password: PASSWORD },
    });
    expect(devOutbox.list("owner@example.com").length).toBe(before);
  });

  it("can't be changed or deleted, by anyone", async () => {
    const [row] = await db().select().from(adminAuditLog).limit(1).all();
    expect(row).toBeDefined();
    const refusal = (error: unknown) => String((error as Error).cause ?? error);
    const update = await db()
      .update(adminAuditLog)
      .set({ action: "nothing" })
      .where(eq(adminAuditLog.id, row!.id))
      .catch(refusal);
    const remove = await db()
      .delete(adminAuditLog)
      .where(eq(adminAuditLog.id, row!.id))
      .catch(refusal);
    expect(update).toMatch(/append-only/);
    expect(remove).toMatch(/append-only/);
    const after = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.id, row!.id))
      .get();
    expect(after).toEqual(row);
  });

  it("records role changes and passkey removals made directly in the database", async () => {
    const v = await signUpConfirmed("db.audited@example.com");
    const userId = await makeAdmin(v);
    await addPasskey(userId);
    await db().delete(passkey).where(eq(passkey.userId, userId));
    const rows = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetUserId, userId))
      .all();
    expect(rows.map((r) => r.action).sort()).toEqual([
      "admin.passkey_removed",
      "admin.role_changed",
    ]);
    const roleChange = rows.find((r) => r.action === "admin.role_changed")!;
    expect(JSON.parse(roleChange.details!)).toMatchObject({
      to: "admin",
      email: "db.audited@example.com",
    });
  });

  it("is listed for admins in the console", async () => {
    const v = await signUpConfirmed("reader.admin@example.com");
    await makeAdmin(v);
    await usePasskeySession(v);
    const res = await app.request(
      "http://localhost/api/admin/audit",
      { headers: { cookie: v.cookie(), origin: "http://localhost" } },
      { ...env, ASSETS },
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { action: string }[];
    expect(rows.some((r) => r.action === "admin.sign_in")).toBe(true);
  });
});
