import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EmailStatus } from "../../shared/email";
import { database } from "../db/client";
import { user } from "../db/schema";
import { app } from "../index";
import {
  ORIGIN,
  linkInLatestEmail,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";

// Phase U14: an account whose emails aren't arriving, and "This address is right".

const db = () => database(env.DB);
let counter = 0;
const address = (label: string) => `problem-${label}-${++counter}@example.com`;
const MANAGE_KEY = "re_manage_test_key";

beforeAll(async () => {
  await setUpDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function person(label: string) {
  const email = address(label);
  const v = await signUpConfirmed(email);
  const id = (await v.session())!.user.id;
  await db().update(user).set({ emailProblem: "bounced" }).where(eq(user.id, id));
  return { v, id, email };
}

const problemOf = async (id: string) =>
  (await db().select({ p: user.emailProblem }).from(user).where(eq(user.id, id)).get())?.p;

/** "This address is right", with the unblocking key set (it never is in tests otherwise). */
function addressIsRight(v: Visitor) {
  return app.request(
    `${ORIGIN}/api/account/email/address-is-right`,
    {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: v.cookie(),
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: "{}",
    },
    { ...env, RESEND_MANAGE_KEY: MANAGE_KEY },
  );
}

describe("an address that isn't getting emails", () => {
  it("shows in Settings › Email and in the session", async () => {
    const { v } = await person("shows");
    const status = (await (await v.request("/api/account/email")).json()) as EmailStatus;
    expect(status.problem).toBe("bounced");
    expect((await v.session())?.user.emailProblem).toBe("bounced");
  });

  it("is cleared by 'This address is right', which takes it off Resend’s list, once a day", async () => {
    const { v, id, email } = await person("right");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"deleted":true}', { status: 200 }));
    const res = await addressIsRight(v);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await problemOf(id)).toBeNull();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`https://api.resend.com/suppressions/${encodeURIComponent(email)}`);
    expect(init?.method).toBe("DELETE");

    await db().update(user).set({ emailProblem: "bounced" }).where(eq(user.id, id));
    const again = await addressIsRight(v);
    expect(again.status).toBe(429);
    expect(await again.json()).toEqual({ error: "too_many" });
    expect(await problemOf(id)).toBe("bounced");
  });

  it("needs a sign-in", async () => {
    const res = await addressIsRight(visitor());
    expect(res.status).toBe(401);
  });

  it("is cleared when the address changes", async () => {
    const { v, id } = await person("changes");
    const newAddress = address("new");
    expect((await v.request("/api/account/email", { body: { newEmail: newAddress } })).status).toBe(
      200,
    );
    expect(await problemOf(id)).toBe("bounced");
    const token = new URL(`http://x${linkInLatestEmail(newAddress)}`).searchParams.get("token");
    const verified = await visitor().request("/api/account/email/verify", { body: { token } });
    expect(await verified.json()).toEqual({ result: "done" });
    expect(await problemOf(id)).toBeNull();
  });
});
