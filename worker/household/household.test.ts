import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { database } from "../db/client";
import { organization, session, user } from "../db/schema";
import { signUp, signUpConfirmed, visitor, setUpDatabase } from "../test/visitor";
import { ensurePersonalHousehold, householdName, personalSlug } from "./household";

const db = () => database(env.DB);

beforeAll(async () => {
  await setUpDatabase();
});

interface Summary {
  id: string;
  name: string;
  role: string;
  members: { name: string; isYou: boolean }[];
}

async function household(v: Awaited<ReturnType<typeof signUpConfirmed>>) {
  const res = await v.request("/api/household");
  expect(res.status).toBe(200);
  return (await res.json()) as Summary;
}

describe("personal household", () => {
  it("is created on the first sign-in and is the session's active household", async () => {
    const v = await signUpConfirmed("june.household@example.com", "June Lee");
    const summary = await household(v);
    expect(summary).toMatchObject({
      name: "June's kitchen",
      role: "owner",
      members: [{ name: "June Lee", isYou: true }],
    });
    expect((await v.session())?.session.activeOrganizationId).toBe(summary.id);
  });

  it("isn't created for an address that was never confirmed", async () => {
    const v = await signUp("never.confirmed@example.com");
    expect(await v.session()).toBeNull();
    const row = await db()
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "never.confirmed@example.com"))
      .get();
    const org = await db()
      .select()
      .from(organization)
      .where(eq(organization.slug, personalSlug(row!.id)))
      .get();
    expect(org).toBeUndefined();
  });

  it("is named after the person's first name", () => {
    expect(householdName("June Lee")).toBe("June's kitchen");
    expect(householdName("  Nana  ")).toBe("Nana's kitchen");
    expect(householdName("")).toBe("My kitchen");
  });

  it("is only ever created once, even when two requests race", async () => {
    const v = await signUpConfirmed("racer@example.com");
    const userId = (await v.session())!.user.id;
    await db()
      .delete(organization)
      .where(eq(organization.slug, personalSlug(userId)));

    const [a, b] = await Promise.all([
      ensurePersonalHousehold(db(), userId),
      ensurePersonalHousehold(db(), userId),
    ]);
    expect(a).toBe(b);
    const rows = await db()
      .select()
      .from(organization)
      .where(eq(organization.slug, personalSlug(userId)))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("is created for accounts made before households existed", async () => {
    const v = await signUpConfirmed("early.bird@example.com", "Rose");
    const before = await household(v);
    // Simulate an account from before B3: no household, and a session that points nowhere.
    await db().delete(organization).where(eq(organization.id, before.id));
    const after = await household(v);
    expect(after.id).not.toBe(before.id);
    expect(after).toMatchObject({ name: "Rose's kitchen", role: "owner" });
  });
});

describe("household access", () => {
  it("never reaches another person's household, even if the session points there", async () => {
    const june = await signUpConfirmed("june.access@example.com", "June");
    const rose = await signUpConfirmed("rose.access@example.com", "Rose");
    const junes = await household(june);
    const roses = await household(rose);

    // Point June's session at Rose's household directly in the database.
    const juneSession = (await june.session())!.session.id;
    await db()
      .update(session)
      .set({ activeOrganizationId: roses.id })
      .where(eq(session.id, juneSession));

    const seen = await household(june);
    expect(seen.id).toBe(junes.id);
    expect(seen.members.map((m) => m.name)).toEqual(["June"]);
    // ...and the session is put back to June's own household.
    expect((await june.session())?.session.activeOrganizationId).toBe(junes.id);
  });

  it("refuses signed-out requests", async () => {
    const res = await visitor().request("/api/household");
    expect(res.status).toBe(401);
  });

  it("keeps Better Auth's household endpoints closed", async () => {
    const v = await signUpConfirmed("closed.doors@example.com");
    const own = await household(v);
    for (const [path, body] of [
      ["/api/auth/organization/create", { name: "Mine", slug: "mine" }],
      ["/api/auth/organization/delete", { organizationId: own.id }],
      ["/api/auth/organization/update", { organizationId: own.id, data: { name: "Hacked" } }],
      ["/api/auth/organization/set-active", { organizationId: null }],
      ["/api/auth/organization/invite-member", { email: "x@example.com", role: "member" }],
    ] as const) {
      const res = await v.request(path, { body });
      expect(res.status, path).toBe(404);
    }
    expect((await household(v)).name).toBe(own.name);
  });
});

describe("account color scheme", () => {
  it("is saved to the account and comes back with the session", async () => {
    const v = await signUpConfirmed("colors@example.com");
    expect((await v.session())?.user.colorScheme ?? null).toBeNull();

    const res = await v.request("/api/account/appearance", {
      method: "PUT",
      body: { colorScheme: "heirloom" },
    });
    expect(res.status).toBe(200);
    expect((await v.session())?.user.colorScheme).toBe("heirloom");
  });

  it("only accepts real color schemes", async () => {
    const v = await signUpConfirmed("bad.colors@example.com");
    const res = await v.request("/api/account/appearance", {
      method: "PUT",
      body: { colorScheme: "neon" },
    });
    expect(res.status).toBe(400);
    expect((await v.session())?.user.colorScheme ?? null).toBeNull();
  });

  it("can't be set through Better Auth's own update-user endpoint", async () => {
    const v = await signUpConfirmed("sneaky.colors@example.com");
    await v.request("/api/auth/update-user", { body: { colorScheme: "<script>" } });
    expect((await v.session())?.user.colorScheme ?? null).toBeNull();
  });

  it("needs a signed-in account", async () => {
    const res = await visitor().request("/api/account/appearance", {
      method: "PUT",
      body: { colorScheme: "harbor" },
    });
    expect(res.status).toBe(401);
  });
});
