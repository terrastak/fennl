import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { FeedbackInbox, FeedbackItem } from "../../shared/feedback";
import { database } from "../db/client";
import { adminAuditLog, feedback, session, user } from "../db/schema";
import { setUpDatabase, signUpConfirmed, visitor, type Visitor } from "../test/visitor";

const db = () => database(env.DB);
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;

let admin: Visitor;
let adminId: string;

beforeAll(async () => {
  await setUpDatabase();
  admin = await signUpConfirmed(email("admin"), "Admin");
  adminId = (await admin.session())!.user.id;
  await db().update(user).set({ role: "admin" }).where(eq(user.id, adminId));
  await db()
    .update(session)
    .set({ authMethod: "passkey", lastActiveAt: new Date() })
    .where(eq(session.userId, adminId));
});

async function send(v: Visitor, body: unknown) {
  const res = await v.request("/api/feedback", { body });
  return { status: res.status, body: (await res.json()) as unknown };
}

async function inbox(status = "all") {
  const res = await admin.request(`/api/admin/feedback?status=${status}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FeedbackInbox;
}

async function change(id: string, body: unknown) {
  const res = await admin.request(`/api/admin/feedback/${id}`, { method: "PATCH", body });
  return { status: res.status, body: (await res.json()) as FeedbackItem };
}

const latestAudit = () =>
  db().select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(1).get();

describe("sending feedback", () => {
  it("is saved with the page, the app version and the browser", async () => {
    const address = email("sender");
    const v = await signUpConfirmed(address, "Rosa Lee");
    expect(
      await send(v, {
        message: "  The import button is hard to find.  ",
        page: "/import",
        appVersion: "abc1234",
      }),
    ).toEqual({ status: 200, body: { ok: true } });
    const row = await db()
      .select()
      .from(feedback)
      .where(eq(feedback.userId, (await v.session())!.user.id))
      .get();
    expect(row).toMatchObject({
      message: "The import button is hard to find.",
      page: "/import",
      appVersion: "abc1234",
      device: "A browser",
      householdId: expect.any(String),
    });
  });

  it("needs a signed-in account and a message of a sensible length", async () => {
    expect((await send(visitor(), { message: "hi" })).status).toBe(401);
    const v = await signUpConfirmed(email("checks"));
    expect(await send(v, { message: "   " })).toEqual({
      status: 400,
      body: { error: "invalid_message" },
    });
    expect((await send(v, { message: "x".repeat(5001) })).status).toBe(400);
    // A page that isn't a path in the app is dropped.
    await send(v, { message: "Hello", page: "https://elsewhere.example" });
    const row = await db()
      .select()
      .from(feedback)
      .where(eq(feedback.userId, (await v.session())!.user.id))
      .get();
    expect(row?.page).toBeNull();
  });

  it("is limited to 10 messages an hour per person", async () => {
    const v = await signUpConfirmed(email("chatty"));
    for (let i = 0; i < 10; i++) expect((await send(v, { message: `Note ${i}` })).status).toBe(200);
    expect(await send(v, { message: "One more" })).toEqual({
      status: 429,
      body: { error: "too_many" },
    });
  });
});

describe("the admin inbox", () => {
  it("is for admins only", async () => {
    const v = await signUpConfirmed(email("curious"));
    expect((await v.request("/api/admin/feedback")).status).toBe(403);
    expect((await admin.request("/api/admin/feedback?status=nonsense")).status).toBe(400);
  });

  it("tracks each message from new to read, replied and done", async () => {
    const address = email("tester");
    const v = await signUpConfirmed(address, "Omar Haddad");
    await send(v, { message: "Love it. Could cook mode keep the screen on?", page: "/" });

    const fresh = await inbox("new");
    const item = fresh.items.find((i) => i.sender?.email === address)!;
    expect(item).toMatchObject({
      sender: { name: "Omar Haddad", email: address },
      readAt: null,
      repliedAt: null,
      doneAt: null,
    });
    expect(fresh.counts.new).toBeGreaterThan(0);

    // Opening it marks it read, once.
    const opened = await admin.request(`/api/admin/feedback/${item.id}/read`, { body: {} });
    const read = (await opened.json()) as FeedbackItem;
    expect(read.readAt).not.toBeNull();
    expect(await latestAudit()).toMatchObject({ action: "feedback.read", adminUserId: adminId });
    await admin.request(`/api/admin/feedback/${item.id}/read`, { body: {} });
    expect((await inbox("read")).items.map((i) => i.id)).toContain(item.id);
    expect((await inbox("new")).items.map((i) => i.id)).not.toContain(item.id);

    // Replied, then undone, then replied again; the note is private to admins.
    const replied = await change(item.id, { replied: true, note: "Emailed about cook mode" });
    expect(replied.body).toMatchObject({ note: "Emailed about cook mode" });
    expect(replied.body.repliedAt).not.toBeNull();
    expect((await inbox("replied")).items.map((i) => i.id)).toContain(item.id);
    const again = await change(item.id, { replied: true });
    expect(again.body.repliedAt).toBe(replied.body.repliedAt);
    expect((await change(item.id, { replied: false })).body.repliedAt).toBeNull();
    await change(item.id, { replied: true });

    const done = await change(item.id, { done: true });
    expect(done.body.doneAt).not.toBeNull();
    expect((await inbox("done")).items.map((i) => i.id)).toContain(item.id);
    expect((await inbox("replied")).items.map((i) => i.id)).not.toContain(item.id);
    expect(await latestAudit()).toMatchObject({
      action: "feedback.updated",
      targetUserId: (await v.session())!.user.id,
    });
    expect((await change(item.id, { done: false })).body.doneAt).toBeNull();
  });

  it("marks a message read when it's replied to or finished without being opened", async () => {
    const v = await signUpConfirmed(email("quiet"));
    await send(v, { message: "Small typo on Settings" });
    const item = (await inbox("new")).items.find((i) => i.message === "Small typo on Settings")!;
    expect((await change(item.id, { done: true })).body.readAt).not.toBeNull();
  });

  it("refuses changes that aren't changes", async () => {
    const v = await signUpConfirmed(email("odd"));
    await send(v, { message: "Odd one" });
    const item = (await inbox("new")).items.find((i) => i.message === "Odd one")!;
    expect((await change(item.id, {})).status).toBe(400);
    expect((await change(item.id, { note: "x".repeat(2001) })).status).toBe(400);
    expect((await change("missing", { done: true })).status).toBe(404);
  });
});
