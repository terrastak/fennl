import { env } from "cloudflare:test";
import { desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { SignUpEmailState } from "../../shared/emailDelivery";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { emailChange, emailMessage, premiumGrant, user } from "../db/schema";
import { devOutbox } from "../email/outbox";
import { emailEvent, postEmailEvent } from "../test/emailEvents";
import {
  PASSWORD,
  linkInLatestEmail,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";
import { SIGN_UP_PROOF_COOKIE, signUpProof } from "./signUpProof";

// Phase U14: "Check your email" asks whether the sign-up link arrived, and fixes a mistyped
// address in place.

const db = () => database(env.DB);
let counter = 0;
const address = (label: string) => `sign-up-${label}-${++counter}@example.com`;
const permanent = { bounce: { type: "Permanent", subType: "General", message: "No such user" } };

beforeAll(async () => {
  await setUpDatabase();
});

const findUser = (email: string) => db().select().from(user).where(eq(user.email, email)).get();

async function signUpVisitor(email: string, v: Visitor = visitor()) {
  const res = await v.request("/api/auth/sign-up/email", {
    body: { name: "Sarah Lee", email, password: PASSWORD, callbackURL: "/" },
  });
  expect(res.status).toBe(200);
  return { v, res };
}

const proofCookie = (res: Response) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${SIGN_UP_PROOF_COOKIE}=`));

async function status(v: Visitor): Promise<SignUpEmailState> {
  const res = await v.request("/api/sign-up/status");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { state: SignUpEmailState };
  expect(Object.keys(body)).toEqual(["state"]);
  return body.state;
}

const fix = (v: Visitor, email: unknown) => v.request("/api/sign-up/address", { body: { email } });

/** The provider id of the newest sign-up link sent to an address. */
function latestLinkId(email: string) {
  return devOutbox.list(email)[0]!.id;
}

describe("the sign-up proof", () => {
  it("comes with a sign-up, only for Fennl's own sign-up routes", async () => {
    const { res } = await signUpVisitor(address("proof"));
    const cookie = proofCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toContain("Path=/api/sign-up");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toMatch(/Max-Age=86\d{3}/);
  });

  it("looks the same for an address that already has an account, and shows nothing", async () => {
    const taken = address("taken");
    await signUpConfirmed(taken);
    const fresh = await signUpVisitor(address("fresh"));
    const again = await signUpVisitor(taken);
    const shape = (c: string | undefined) => c?.replace(/=[^;]+/, "=…").replace(/Max-Age=\d+/, "");
    expect(shape(proofCookie(again.res))).toBe(shape(proofCookie(fresh.res)));
    expect(await status(again.v)).toBe("waiting");
    expect((await fix(again.v, address("elsewhere"))).status).toBe(200);
    expect((await findUser(taken))?.emailVerified).toBe(true);
  });

  it("comes with signing in before verifying, only with the right password", async () => {
    const email = address("sign-in");
    await signUpVisitor(email);
    const wrong = await visitor().request("/api/auth/sign-in/email", {
      body: { email, password: "not the password" },
    });
    expect(wrong.status).toBe(401);
    expect(proofCookie(wrong)).toBeUndefined();

    const v = visitor();
    const right = await v.request("/api/auth/sign-in/email", {
      body: { email: email.toUpperCase(), password: PASSWORD },
    });
    expect(right.status).toBe(403);
    expect(proofCookie(right)).toBeDefined();
    await postEmailEvent(emailEvent("email.bounced", latestLinkId(email), permanent));
    expect(await status(v)).toBe("not_arriving");
  });

  it("isn't given when asking for the link again", async () => {
    const email = address("resend");
    await signUpVisitor(email);
    const res = await visitor().request("/api/auth/send-verification-email", {
      body: { email, callbackURL: "/" },
    });
    expect(proofCookie(res)).toBeUndefined();
  });

  it("is worth nothing forged, or once the account is verified", async () => {
    const email = address("forged");
    const { v } = await signUpVisitor(email);
    const person = (await findUser(email))!;
    await postEmailEvent(emailEvent("email.bounced", latestLinkId(email), permanent));
    expect(await status(v)).toBe("not_arriving");

    const forged = visitor();
    const real = await signUpProof(env.BETTER_AUTH_SECRET, person.id, Date.now() + 60_000);
    forged.addCookie(`${SIGN_UP_PROOF_COOKIE}=${real.slice(0, -2)}xx`);
    expect(await status(forged)).toBe("waiting");
    const otherSecret = visitor();
    otherSecret.addCookie(
      `${SIGN_UP_PROOF_COOKIE}=${await signUpProof("another-secret", person.id, Date.now() + 60_000)}`,
    );
    expect(await status(otherSecret)).toBe("waiting");
    const expired = visitor();
    expired.addCookie(
      `${SIGN_UP_PROOF_COOKIE}=${await signUpProof(env.BETTER_AUTH_SECRET, person.id, Date.now() - 1)}`,
    );
    expect(await status(expired)).toBe("waiting");
    expect(await status(visitor())).toBe("waiting");

    await db().update(user).set({ emailVerified: true }).where(eq(user.id, person.id));
    expect(await status(v)).toBe("waiting");
    expect((await fix(v, address("after-verified"))).status).toBe(200);
    expect((await findUser(email))?.id).toBe(person.id);
  });
});

describe("Check your email's status", () => {
  it("follows the newest sign-up link's events", async () => {
    const email = address("states");
    const { v } = await signUpVisitor(email);
    expect(await status(v)).toBe("waiting");
    const id = latestLinkId(email);
    const at = (s: number) => new Date(Date.now() + s * 1000);
    await postEmailEvent(emailEvent("email.delivery_delayed", id, {}, at(1)));
    expect(await status(v)).toBe("delayed");
    await postEmailEvent(emailEvent("email.bounced", id, { bounce: { type: "Transient" } }, at(2)));
    expect(await status(v)).toBe("delayed");
    await postEmailEvent(emailEvent("email.bounced", id, permanent, at(3)));
    expect(await status(v)).toBe("not_arriving");
  });

  it("says when the link couldn't be sent", async () => {
    const email = address("not-sent");
    const { v } = await signUpVisitor(email);
    await db()
      .update(emailMessage)
      .set({ status: "failed" })
      .where(eq(emailMessage.providerId, latestLinkId(email)));
    expect(await status(v)).toBe("not_sent");
  });
});

describe("fixing a mistyped sign-up address", () => {
  it("changes the address in place, keeping the name and invite code, and the new link signs in", async () => {
    const code = await createCode(
      db(),
      {
        code: `FIX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        label: "Fix test",
        tier: "household",
        access: { forever: true },
        allowsSignUp: true,
        maxUses: 1,
        redeemBy: null,
      },
      null,
    );
    const typo = address("gmial").replace("example.com", "gmial.com");
    const v = visitor();
    expect((await v.request("/api/sign-up/code", { body: { code: code.code } })).status).toBe(200);
    await signUpVisitor(typo, v);
    const person = (await findUser(typo))!;
    await postEmailEvent(emailEvent("email.bounced", latestLinkId(typo), permanent));
    expect(await status(v)).toBe("not_arriving");

    const right = address("Right");
    const res = await fix(v, `  ${right.toUpperCase()} `);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const fixed = (await findUser(right.toLowerCase()))!;
    expect(fixed).toMatchObject({ id: person.id, name: "Sarah Lee", emailVerified: false });
    expect(fixed.createdAt.getTime()).toBe(person.createdAt.getTime());
    expect(await findUser(typo)).toBeUndefined();
    expect(
      await db().select().from(emailChange).where(eq(emailChange.userId, person.id)).all(),
    ).toEqual([]);
    expect(
      await db().select().from(premiumGrant).where(eq(premiumGrant.userId, person.id)).all(),
    ).toHaveLength(1);
    // The new link went to the new address, and nothing is known about it yet.
    const [sent] = await db()
      .select()
      .from(emailMessage)
      .where(eq(emailMessage.userId, person.id))
      .orderBy(desc(emailMessage.sentAt))
      .all();
    expect(sent).toMatchObject({ kind: "verification", toAddress: right.toLowerCase() });
    expect(await status(v)).toBe("waiting");

    const confirm = await v.request(linkInLatestEmail(right.toLowerCase()));
    expect(confirm.status).toBe(302);
    expect((await v.session())?.user.email).toBe(right.toLowerCase());
  });

  it("sends the link again to the same address", async () => {
    const email = address("same");
    const { v } = await signUpVisitor(email);
    const before = devOutbox.list(email).length;
    expect((await fix(v, email)).status).toBe(200);
    expect(devOutbox.list(email).length).toBe(before + 1);
  });

  it("answers the same for an address another account uses, sending nothing", async () => {
    const taken = address("in-use");
    await signUpConfirmed(taken);
    const email = address("wants-taken");
    const { v } = await signUpVisitor(email);
    await postEmailEvent(emailEvent("email.bounced", latestLinkId(email), permanent));
    expect(await status(v)).toBe("not_arriving");
    const before = devOutbox.list(taken).length;
    const res = await fix(v, taken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(devOutbox.list(taken).length).toBe(before);
    expect(await findUser(email)).toBeDefined();
    // Check your email then reads as it does after a fix to a free address, not as the old
    // address's bounce, so it doesn't show that the address has an account.
    expect(await status(v)).toBe("waiting");

    const free = address("wants-free");
    const other = await signUpVisitor(free);
    await postEmailEvent(emailEvent("email.bounced", latestLinkId(free), permanent));
    expect(await status(other.v)).toBe("not_arriving");
    expect((await fix(other.v, address("free-target"))).status).toBe(200);
    expect(await status(other.v)).toBe("waiting");
  });

  it("answers the same without a proof, changing nothing", async () => {
    const email = address("no-proof");
    await signUpVisitor(email);
    const stranger = visitor();
    const target = address("stranger-target");
    const res = await fix(stranger, target);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await findUser(target)).toBeUndefined();
    expect(devOutbox.list(target)).toEqual([]);
  });

  it("refuses something that isn't an address, for everyone alike", async () => {
    const { v } = await signUpVisitor(address("invalid"));
    // "sarah@gmail.c" looks like an address but Better Auth refuses it: kept, the account would
    // be stuck at an address it can't send the link to or sign in with.
    for (const visitorToUse of [v, visitor()]) {
      for (const typed of ["not an address", "sarah@gmail.c"]) {
        const res = await fix(visitorToUse, typed);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid_email" });
      }
    }
  });

  it("allows 5 fixes an hour for each sign-up", async () => {
    const { v } = await signUpVisitor(address("limit"));
    for (let i = 0; i < 5; i++) expect((await fix(v, address(`limit-${i}`))).status).toBe(200);
    const res = await fix(v, address("limit-6"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too_many" });
  });
});
