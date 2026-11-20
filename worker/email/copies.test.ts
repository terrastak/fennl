import { env } from "cloudflare:test";
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { database } from "../db/client";
import { emailMessage, session, user } from "../db/schema";
import {
  linkInLatestEmail,
  ORIGIN,
  setUpDatabase,
  signUp,
  signUpConfirmed,
  visitor,
} from "../test/visitor";
import { linkRefHash } from "./links";

// U26: Fennl keeps a copy of each email it sends for an account (any link that works like a key
// to the account replaced by a note) and records when an email's link did its job.

const db = () => database(env.DB);
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;

beforeAll(async () => {
  await setUpDatabase();
});

const userIdOf = async (address: string) =>
  (await db().select({ id: user.id }).from(user).where(eq(user.email, address)).get())!.id;

const latest = async (userId: string, kind: string) =>
  db()
    .select()
    .from(emailMessage)
    .where(and(eq(emailMessage.userId, userId), eq(emailMessage.kind, kind)))
    .orderBy(desc(emailMessage.sentAt))
    .get();

describe("email copies and links used", () => {
  it("keeps the sign-up email without its link, and marks it used once verified", async () => {
    const address = email("verify");
    await signUp(address);
    const link = linkInLatestEmail(address);
    const token = new URL(`${ORIGIN}${link}`).searchParams.get("token")!;
    const id = await userIdOf(address);

    const before = await latest(id, "verification");
    expect(before?.subject).toBe("Verify your email for Fennl");
    expect(before?.copyHtml).toContain("The button to verify the email address was here.");
    expect(before?.copyHtml).not.toContain(token);
    expect(before?.copyHtml).not.toContain("verify-email");
    expect(before?.linkRef).toBe(await linkRefHash(token));
    expect(before?.linkUsedAt).toBeNull();

    expect((await visitor().request(link)).status).toBe(302);
    expect((await latest(id, "verification"))?.linkUsedAt).not.toBeNull();
  });

  it("marks a password reset email used once its link chose a password", async () => {
    const address = email("reset");
    await signUpConfirmed(address);
    const id = await userIdOf(address);
    const other = visitor();
    await other.request("/api/auth/request-password-reset", {
      body: { email: address, redirectTo: "/reset-password" },
    });
    const sent = await latest(id, "password_reset");
    expect(sent?.copyHtml).toContain("The button to choose a new password was here.");
    expect(sent?.linkUsedAt).toBeNull();

    const open = await other.request(linkInLatestEmail(address));
    const token = new URL(open.headers.get("location")!, ORIGIN).searchParams.get("token");
    expect(sent?.copyHtml).not.toContain(token);
    // A wrong token changes nothing and marks nothing.
    await other.request("/api/auth/reset-password", {
      body: { newPassword: "a much better password", token: "wrong" },
    });
    expect((await latest(id, "password_reset"))?.linkUsedAt).toBeNull();
    const reset = await other.request("/api/auth/reset-password", {
      body: { newPassword: "a much better password", token },
    });
    expect(reset.status).toBe(200);
    expect((await latest(id, "password_reset"))?.linkUsedAt).not.toBeNull();
  });

  it("marks the new-address email used once the change is confirmed", async () => {
    const address = email("change");
    const v = await signUpConfirmed(address);
    const id = await userIdOf(address);
    const newAddress = email("changed");
    await v.request("/api/account/email", { body: { newEmail: newAddress } });
    const sent = await latest(id, "email_change");
    expect(sent?.copyHtml).toContain("The button to verify the new email address was here.");
    const token = new URL(`${ORIGIN}${linkInLatestEmail(newAddress)}`).searchParams.get("token")!;
    expect(sent?.copyHtml).not.toContain(token);
    const res = await visitor().request("/api/account/email/verify", { body: { token } });
    expect(((await res.json()) as { result: string }).result).toBe("done");
    expect((await latest(id, "email_change"))?.linkUsedAt).not.toBeNull();
  });

  it("marks a photo email used when its owner opens the Account page from it, signed in", async () => {
    const address = email("photo");
    const v = await signUpConfirmed(address);
    const id = await userIdOf(address);
    const someoneElse = await signUpConfirmed(email("else"));
    const rowId = crypto.randomUUID();
    await db()
      .insert(emailMessage)
      .values({
        id: rowId,
        providerId: `dev-${rowId}`,
        userId: id,
        kind: "photo_grace_started",
        toAddress: address,
        sentAt: new Date(),
        status: "delivered",
        statusAt: new Date(),
        subject: "Your Fennl Premium trial has ended.",
        copyHtml: "<p>Hi</p>",
        linkRef: await linkRefHash("ref-photo"),
      });
    const used = async () =>
      (await db().select().from(emailMessage).where(eq(emailMessage.id, rowId)).get())
        ?.linkUsedAt ?? null;

    // Not someone else's, and nothing while an admin acts as the person.
    expect(
      (await someoneElse.request("/api/account/email-link", { body: { ref: "ref-photo" } })).status,
    ).toBe(204);
    expect(await used()).toBeNull();
    const own = await db().select().from(session).where(eq(session.userId, id)).all();
    await db().update(session).set({ impersonatedBy: id }).where(eq(session.userId, id));
    await v.request("/api/account/email-link", { body: { ref: "ref-photo" } });
    expect(await used()).toBeNull();
    for (const s of own) {
      await db().update(session).set({ impersonatedBy: null }).where(eq(session.id, s.id));
    }

    await v.request("/api/account/email-link", { body: { ref: "ref-photo" } });
    const first = await used();
    expect(first).not.toBeNull();
    // Only the first time counts.
    await v.request("/api/account/email-link", { body: { ref: "ref-photo" } });
    expect((await used())?.getTime()).toBe(first?.getTime());
  });
});
