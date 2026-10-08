import { env } from "cloudflare:test";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "../../shared/recipe";
import type { ChangeResult, SyncChange } from "../../shared/sync";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { adminAuditLog, device, session, user } from "../db/schema";
import { devOutbox } from "../email/outbox";
import { app } from "../index";
import { PASSWORD, setUpDatabase, signUpConfirmed, visitor, type Visitor } from "../test/visitor";

// Phase C12: an admin acting as a user. Silent to the person, attributed to the admin, and
// never a way past the console's own checks.

const db = () => database(env.DB);
const id = () => crypto.randomUUID();
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;

let admin: Visitor;
let adminId: string;
let adminAddress: string;

/** The admin's own session, signed in with a passkey just now. */
async function freshAdmin(at = new Date()) {
  await db()
    .update(session)
    .set({ authMethod: "passkey", createdAt: at, lastActiveAt: new Date() })
    .where(eq(session.userId, adminId));
}

beforeAll(async () => {
  await setUpDatabase();
  adminAddress = email("admin");
  admin = await signUpConfirmed(adminAddress, "Ada Admin");
  adminId = (await admin.session())!.user.id;
  await db().update(user).set({ role: "admin" }).where(eq(user.id, adminId));
});

beforeEach(async () => {
  await freshAdmin();
});

interface Person {
  v: Visitor;
  userId: string;
  address: string;
  deviceId: string;
}

async function person(name = "June Lee"): Promise<Person> {
  const address = email(name.split(" ")[0]!.toLowerCase());
  const v = await signUpConfirmed(address, name);
  const deviceId = id();
  expect(await (await v.request("/api/devices/register", { body: { deviceId } })).json()).toEqual({
    status: "ok",
  });
  return { v, userId: (await v.session())!.user.id, address, deviceId };
}

async function push(v: Visitor, deviceId: string, changes: SyncChange[]) {
  return v.request("/api/sync/push", {
    body: { deviceId, schemaVersion: RECIPE_SCHEMA_VERSION, sentAt: Date.now(), changes },
  });
}

const auditRows = (action: string) =>
  db()
    .select()
    .from(adminAuditLog)
    .where(eq(adminAuditLog.action, action))
    .orderBy(desc(adminAuditLog.createdAt))
    .all();

const start = (target: string, reason: unknown = "Recipe missing, checking her sync") =>
  admin.request(`/api/admin/accounts/${target}/impersonate`, { body: { reason } });

async function stop() {
  const res = await admin.request("/api/admin/impersonation/stop", { method: "POST" });
  expect(res.status).toBe(200);
  return (await res.json()) as { accountId: string };
}

describe("starting", () => {
  it("needs a reason, the passkey again, and never acts as another admin", async () => {
    const june = await person();
    expect((await start(june.userId, "")).status).toBe(400);
    expect(await (await start(june.userId, "  hi ")).json()).toEqual({ error: "reason_required" });

    await freshAdmin(new Date(Date.now() - 10 * 60 * 1000));
    const stale = await start(june.userId);
    expect(stale.status).toBe(403);
    expect(await stale.json()).toEqual({ error: "passkey_reconfirm" });
    await freshAdmin();

    const other = await signUpConfirmed(email("otheradmin"), "Other Admin");
    const otherId = (await other.session())!.user.id;
    await db().update(user).set({ role: "admin" }).where(eq(user.id, otherId));
    expect(await (await start(otherId)).json()).toEqual({ error: "target_is_admin" });

    // Not for anyone but admins, and not through Better Auth's own endpoint.
    expect(
      (
        await june.v.request(`/api/admin/accounts/${otherId}/impersonate`, {
          body: { reason: "Just looking around" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await june.v.request("/api/auth/admin/impersonate-user", { body: { userId: otherId } }))
        .status,
    ).toBe(404);
    expect(await auditRows("impersonation.started")).toEqual([]);
  });
});

describe("acting as someone", () => {
  it("is silent to them, saves straight to their account, and logs every change", async () => {
    const june = await person();
    const recipeId = id();
    const created = await push(june.v, june.deviceId, [
      {
        kind: "recipe",
        id: recipeId,
        create: { createdAt: new Date().toISOString(), import: null },
        fields: { ...emptyRecipeContent(), title: "Green chile stew" },
        changedAt: Date.now(),
      },
    ]);
    expect(created.status).toBe(200);
    const emailsBefore = devOutbox.list(june.address).length;
    const ownerEmailsBefore = devOutbox.list("owner@example.com").length;

    const started = await start(june.userId);
    expect(started.status).toBe(200);
    const [startRow] = await auditRows("impersonation.started");
    expect(startRow).toMatchObject({
      adminUserId: adminId,
      targetUserId: june.userId,
      reason: "Recipe missing, checking her sync",
    });
    // The owner is told; June isn't.
    expect(devOutbox.list("owner@example.com").length).toBe(ownerEmailsBefore + 1);
    expect(devOutbox.list("owner@example.com").at(-1)?.text).toContain(june.address);

    // The admin's browser is now June, in a session marked as the admin's, for 30 minutes.
    const acting = await db()
      .select()
      .from(session)
      .where(and(eq(session.userId, june.userId), isNotNull(session.impersonatedBy)))
      .get();
    expect(acting?.impersonatedBy).toBe(adminId);
    const minutes = (acting!.expiresAt.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    expect((await admin.session())!.user.id).toBe(june.userId);

    // Never a device: registering does nothing, and June's list is as it was.
    const adminDevice = id();
    expect(
      await (
        await admin.request("/api/devices/register", { body: { deviceId: adminDevice } })
      ).json(),
    ).toEqual({ status: "ok" });
    const devices = await db().select().from(device).where(eq(device.userId, june.userId)).all();
    expect(devices.map((d) => d.id)).toEqual([june.deviceId]);

    // A change goes straight to June's account, logged under the admin first.
    const edited = await push(admin, adminDevice, [
      { kind: "recipe", id: recipeId, fields: { title: "Red chile stew" }, changedAt: Date.now() },
    ]);
    expect(((await edited.json()) as { results: ChangeResult[] }).results).toEqual([
      { status: "applied" },
    ]);
    const [change] = await auditRows("impersonation.change");
    expect(change).toMatchObject({ adminUserId: adminId, targetUserId: june.userId });
    expect(JSON.parse(change!.details!)).toMatchObject({
      request: "POST /api/sync/push",
      changes: [`recipe ${recipeId.slice(0, 8)} edited: title`],
    });
    const pulled = await june.v.request(
      `/api/sync/pull?deviceId=${june.deviceId}&schemaVersion=${RECIPE_SCHEMA_VERSION}&since=`,
    );
    const { recipes } = (await pulled.json()) as { recipes: { title: string }[] };
    expect(recipes.map((r) => r.title)).toEqual(["Red chile stew"]);

    // Nothing in June's own session list, and no email to June.
    const listed = (await (await june.v.request("/api/auth/list-sessions")).json()) as unknown[];
    expect(listed).toHaveLength(1);
    expect(devOutbox.list(june.address).length).toBe(emailsBefore);

    // The console waits until it's stopped.
    expect(await (await admin.request("/api/admin/me")).json()).toEqual({
      error: "impersonating",
    });

    // Back to the admin, logged.
    expect(await stop()).toEqual({ ok: true, accountId: june.userId });
    expect((await auditRows("impersonation.ended"))[0]).toMatchObject({
      adminUserId: adminId,
      targetUserId: june.userId,
    });
    expect((await admin.session())!.user.id).toBe(adminId);
    expect((await admin.request("/api/admin/me")).status).toBe(200);
    // June's session list never showed it, and it's gone now.
    expect(
      await db()
        .select()
        .from(session)
        .where(and(eq(session.userId, june.userId), isNotNull(session.impersonatedBy)))
        .all(),
    ).toEqual([]);
  });

  it("leaves passwords, email and feedback to the console, and logs nothing for them", async () => {
    const june = await person();
    expect((await start(june.userId)).status).toBe(200);
    const changesBefore = (await auditRows("impersonation.change")).length;
    const refused = [
      ["/api/feedback", { message: "Hello" }],
      ["/api/account/email", { newEmail: "new@example.com" }],
      ["/api/account/password", { currentPassword: "a", newPassword: "b" }],
      ["/api/auth/change-password", { currentPassword: "a", newPassword: "bbbbbbbbbb" }],
      ["/api/auth/update-user", { name: "Not June" }],
      ["/api/devices/takeover", { deviceId: id() }],
    ] as const;
    for (const [path, body] of refused) {
      const res = await admin.request(path, { body });
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({ error: "not_while_impersonating" });
    }
    expect((await auditRows("impersonation.change")).length).toBe(changesBefore);
    expect((await db().select().from(user).where(eq(user.id, june.userId)).get())?.name).toBe(
      "June Lee",
    );
    await stop();
  });

  it("never queues changes, even on Premium", async () => {
    const june = await person();
    const code = await createCode(
      db(),
      {
        code: `ACT-${++counter}`,
        label: "Impersonation tests",
        tier: "individual",
        access: { forever: true },
        allowsSignUp: true,
        maxUses: null,
        redeemBy: null,
      },
      null,
    );
    expect((await june.v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(
      200,
    );
    const old = (recipeId: string): SyncChange => ({
      kind: "recipe",
      id: recipeId,
      create: { createdAt: new Date().toISOString(), import: null },
      fields: { ...emptyRecipeContent(), title: "Made offline" },
      changedAt: Date.now() - 10 * 60 * 1000,
    });
    // June's own Premium device may send a change made offline.
    expect((await push(june.v, june.deviceId, [old(id())])).status).toBe(200);
    expect((await start(june.userId)).status).toBe(200);
    const res = await push(admin, id(), [old(id())]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "offline_not_allowed" });
    await stop();
  });

  it("ends by itself after 30 minutes", async () => {
    const june = await person();
    expect((await start(june.userId)).status).toBe(200);
    expect((await admin.request("/api/household")).status).toBe(200);
    await db()
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(session.userId, june.userId), isNotNull(session.impersonatedBy)));
    expect((await admin.request("/api/household")).status).toBe(401);
    // The admin's own session waits behind it; signing in again (with the passkey) gets back.
    admin = visitor();
    const signedIn = await admin.request("/api/auth/sign-in/email", {
      body: { email: adminAddress, password: PASSWORD },
    });
    expect(signedIn.status).toBe(200);
    await freshAdmin();
    expect((await admin.request("/api/admin/me")).status).toBe(200);
  });

  it("the app opens on the admin address only while acting as someone", async () => {
    const ASSETS = {
      fetch: async (input: RequestInfo | URL) =>
        new Response(`asset ${new URL(input instanceof Request ? input.url : input).pathname}`),
    } as unknown as Fetcher;
    // Plain http, so the test's sign-in cookies (made on http://localhost) still count there.
    const prod = { ...env, ASSETS, ADMIN_HOSTNAME: "admin.example.test" };
    const get = (v: Visitor, path: string) =>
      app.request(
        `http://admin.example.test${path}`,
        { headers: { cookie: v.cookie() }, redirect: "manual" },
        prod,
      );

    const june = await person();
    // June herself (or the admin as themselves) gets only the console there.
    expect((await get(june.v, "/api/household")).status).toBe(404);
    expect((await get(admin, "/recipes")).headers.get("location")).toBe("/admin");

    expect((await start(june.userId)).status).toBe(200);
    expect((await get(admin, "/api/household")).status).toBe(200);
    const page = await get(admin, "/recipes");
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("asset /recipes");
    await stop();
    expect((await get(admin, "/api/household")).status).toBe(404);
  });

  it("is attributed to the admin even for other changes, like a color scheme", async () => {
    const june = await person();
    expect((await start(june.userId)).status).toBe(200);
    const res = await admin.request("/api/account/appearance", {
      method: "PUT",
      body: { colorScheme: "heirloom" },
    });
    expect(res.status).toBe(200);
    const [row] = await auditRows("impersonation.change");
    expect(JSON.parse(row!.details!)).toMatchObject({ request: "PUT /api/account/appearance" });
    expect(row).toMatchObject({ adminUserId: adminId, targetUserId: june.userId });
    await stop();
  });
});
