import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { database } from "../db/client";
import { emailMessage, user } from "../db/schema";
import { emailEvent, postEmailEvent } from "../test/emailEvents";
import { setUpDatabase, signUp, signUpConfirmed, visitor } from "../test/visitor";
import { removeOldEmailMessages } from "./delivery";
import { createEmailSender } from "./email";
import { devOutbox } from "./outbox";

// Phase U14: every email to an account is recorded, and Resend's events say what became of it.

const db = () => database(env.DB);
const DAY = 24 * 60 * 60 * 1000;
let counter = 0;
const address = (label: string) => `delivery-${label}-${++counter}@example.com`;

beforeAll(async () => {
  await setUpDatabase();
});

async function userIdOf(email: string) {
  return (await db().select({ id: user.id }).from(user).where(eq(user.email, email)).get())!.id;
}

const messagesOf = (userId: string) =>
  db()
    .select()
    .from(emailMessage)
    .where(eq(emailMessage.userId, userId))
    .orderBy(desc(emailMessage.sentAt))
    .all();

const problemOf = async (userId: string) =>
  (await db().select({ p: user.emailProblem }).from(user).where(eq(user.id, userId)).get())?.p;

/** A confirmed person and the provider id of their sign-up link. */
async function confirmed(label: string) {
  const email = address(label);
  const v = await signUpConfirmed(email);
  const userId = await userIdOf(email);
  const [sent] = await messagesOf(userId);
  return { v, email, userId, providerId: sent!.providerId! };
}

describe("recording emails", () => {
  it("records each email with its kind, person and the email service's id, never its words", async () => {
    const email = address("Recorded").replace("Recorded", "recorded");
    await signUp(email.toUpperCase());
    const userId = await userIdOf(email);
    const [row] = await messagesOf(userId);
    const [outboxed] = devOutbox.list(email);
    expect(row).toMatchObject({
      kind: "verification",
      toAddress: email,
      status: "sent",
      providerId: outboxed!.id,
      detail: null,
    });
    expect(outboxed).toMatchObject({ kind: "verification", userId });
    expect(Object.keys(row!)).not.toContain("text");
  });

  it("records an email the service refused as not sent, and still reports the refusal", async () => {
    const send = createEmailSender({ ...env, DEV_EMAIL_OUTBOX: "false" });
    const userId = crypto.randomUUID();
    await expect(
      send({
        to: "a@example.com",
        subject: "s",
        text: "t",
        html: "h",
        kind: "password_reset",
        userId,
      }),
    ).rejects.toThrow("not configured");
    const [row] = await messagesOf(userId);
    expect(row).toMatchObject({ kind: "password_reset", status: "failed", providerId: null });
    expect(row!.detail).toContain("not configured");
  });

  it("doesn't record notices to Fennl's owner", async () => {
    const before = (await db().select().from(emailMessage).all()).length;
    await createEmailSender(env)({
      to: "owner@example.com",
      subject: "s",
      text: "t",
      html: "h",
      kind: "owner_notice",
      userId: null,
    });
    expect((await db().select().from(emailMessage).all()).length).toBe(before);
  });

  it("lists each outbox email's id, kind and person for local tests", async () => {
    const email = address("outbox");
    await signUp(email);
    const res = await visitor().request(`/api/dev/outbox?to=${encodeURIComponent(email)}`);
    const [listed] = (await res.json()) as { id: string; kind: string; userId: string }[];
    expect(listed).toMatchObject({ kind: "verification", userId: await userIdOf(email) });
    expect(listed!.id).toMatch(/^dev-/);
  });

  it("removes records 90 days after sending", async () => {
    const { userId } = await confirmed("old");
    const now = Date.now();
    expect(await removeOldEmailMessages(db(), now + 89 * DAY)).toBe(0);
    expect(await removeOldEmailMessages(db(), now + 91 * DAY)).toBeGreaterThan(0);
    expect(await messagesOf(userId)).toEqual([]);
  });
});

describe("Resend's events", () => {
  const permanent = { bounce: { type: "Permanent", subType: "General", message: "No such user" } };

  it("are refused unsigned, wrongly signed, or when Fennl has no secret", async () => {
    const event = emailEvent("email.delivered", "dev-x");
    expect((await postEmailEvent(event, { signed: false })).status).toBe(401);
    expect((await postEmailEvent(event, { secret: "whsec_b3RoZXJzZWNyZXQ=" })).status).toBe(401);
    expect((await postEmailEvent(event, { timestamp: Date.now() - 10 * 60_000 })).status).toBe(401);
    const unset = { ...env, RESEND_WEBHOOK_SECRET: "" };
    const res = await postEmailEvent(event, { env: unset });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });

  it("answer 200 for emails Fennl doesn't know and events it ignores", async () => {
    const unknown = await postEmailEvent(emailEvent("email.bounced", "dev-unknown", permanent));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ok: true });
    expect((await postEmailEvent({ type: "email.opened", data: {} })).status).toBe(200);
    expect((await postEmailEvent({ type: "suppression.removed", data: {} })).status).toBe(200);
  });

  it("mark an email delivered", async () => {
    const { userId, providerId } = await confirmed("delivered");
    const at = new Date(Date.now() + 1000);
    expect((await postEmailEvent(emailEvent("email.delivered", providerId, {}, at))).status).toBe(
      200,
    );
    const [row] = await messagesOf(userId);
    expect(row).toMatchObject({ status: "delivered" });
    expect(row!.statusAt.getTime()).toBe(at.getTime());
    expect(await problemOf(userId)).toBeNull();
  });

  it("raise the notice when the account's email bounces for good, with the mail server's reason", async () => {
    const { v, userId, providerId } = await confirmed("bounced");
    await postEmailEvent(emailEvent("email.bounced", providerId, permanent));
    expect((await messagesOf(userId))[0]).toMatchObject({
      status: "bounced",
      detail: "No such user",
    });
    expect(await problemOf(userId)).toBe("bounced");
    expect((await v.session())?.user.emailProblem).toBe("bounced");
  });

  it("don't raise it for a temporary bounce, but do when Resend blocked the address", async () => {
    const soft = await confirmed("soft");
    await postEmailEvent(
      emailEvent("email.bounced", soft.providerId, { bounce: { type: "Transient" } }),
    );
    expect((await messagesOf(soft.userId))[0]?.status).toBe("soft_bounced");
    expect(await problemOf(soft.userId)).toBeNull();

    const blocked = await confirmed("blocked");
    await postEmailEvent(
      emailEvent("email.bounced", blocked.providerId, {
        bounce: { type: "Permanent", subType: "Suppressed", message: "On the list" },
      }),
    );
    expect((await messagesOf(blocked.userId))[0]?.status).toBe("suppressed");
    expect(await problemOf(blocked.userId)).toBe("suppressed");

    const spam = await confirmed("spam");
    await postEmailEvent(emailEvent("email.complained", spam.providerId));
    expect(await problemOf(spam.userId)).toBe("complained");

    const failed = await confirmed("failed");
    await postEmailEvent(
      emailEvent("email.failed", failed.providerId, { failed: { reason: "reached_daily_quota" } }),
    );
    expect((await messagesOf(failed.userId))[0]).toMatchObject({
      status: "failed",
      detail: "reached_daily_quota",
    });
    expect(await problemOf(failed.userId)).toBeNull();
  });

  it("ignore an older event arriving after a newer one", async () => {
    const { userId, providerId } = await confirmed("order");
    const now = Date.now();
    await postEmailEvent(emailEvent("email.delivered", providerId, {}, new Date(now + 2000)));
    await postEmailEvent(emailEvent("email.bounced", providerId, permanent, new Date(now + 1000)));
    expect((await messagesOf(userId))[0]?.status).toBe("delivered");
    expect(await problemOf(userId)).toBeNull();
  });

  it("change nothing when the same event comes again", async () => {
    const { userId, providerId } = await confirmed("again");
    const event = emailEvent("email.bounced", providerId, permanent);
    await postEmailEvent(event);
    expect(await problemOf(userId)).toBe("bounced");
    // The person said the address is right; Resend sends the same event again.
    await db().update(user).set({ emailProblem: null }).where(eq(user.id, userId));
    expect((await postEmailEvent(event)).status).toBe(200);
    expect(await problemOf(userId)).toBeNull();
  });

  it("clear the notice once an email to the address is delivered", async () => {
    const { userId, providerId } = await confirmed("works-again");
    const now = Date.now();
    await postEmailEvent(emailEvent("email.bounced", providerId, permanent, new Date(now + 1000)));
    expect(await problemOf(userId)).toBe("bounced");
    const later = `dev-${crypto.randomUUID()}`;
    await db()
      .insert(emailMessage)
      .values({
        id: crypto.randomUUID(),
        providerId: later,
        userId,
        kind: "password_reset",
        toAddress: (await db().select().from(user).where(eq(user.id, userId)).get())!.email,
        sentAt: new Date(now + 1500),
        status: "sent",
        statusAt: new Date(now + 1500),
      });
    await postEmailEvent(emailEvent("email.delivered", later, {}, new Date(now + 2000)));
    expect(await problemOf(userId)).toBeNull();
  });

  it("leave the notice alone for an address the account no longer has", async () => {
    const { userId } = await confirmed("old-address");
    const old = `dev-${crypto.randomUUID()}`;
    await db().insert(emailMessage).values({
      id: crypto.randomUUID(),
      providerId: old,
      userId,
      kind: "email_changed",
      toAddress: "an-old-address@example.com",
      sentAt: new Date(),
      status: "sent",
      statusAt: new Date(),
    });
    await postEmailEvent(emailEvent("email.bounced", old, permanent));
    expect(await problemOf(userId)).toBeNull();
  });

  it("raise the notice when Resend adds the account's address to its list", async () => {
    const { email, userId } = await confirmed("listed");
    await postEmailEvent({
      type: "suppression.added",
      created_at: new Date().toISOString(),
      data: { id: crypto.randomUUID(), email: email.toUpperCase(), origin: "complaint" },
    });
    expect(await problemOf(userId)).toBe("complained");
  });
});
