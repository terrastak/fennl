import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { database } from "../db/client";
import { limitOverride, promoCode } from "../db/schema";
import { app } from "../index";
import { readSetting } from "../settings/settings";
import { setUpDatabase } from "../test/visitor";

// The browser tests' setup route (worker/dev/testSetup.ts): local test servers only.

const db = () => database(env.DB);

beforeAll(async () => {
  await setUpDatabase();
});

function setup(body: unknown, options: { host?: string; env?: Partial<Env> } = {}) {
  return app.request(
    `http://${options.host ?? "localhost"}/api/dev/test-setup`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    { ...env, ...options.env },
  );
}

describe("the browser tests' setup route", () => {
  it("makes a code", async () => {
    const res = await setup({
      kind: "code",
      tier: "individual",
      accessDays: 30,
      accessUntil: null,
      allowsSignUp: false,
    });
    expect(res.status).toBe(200);
    const { code } = (await res.json()) as { code: string };
    const row = await db().select().from(promoCode).where(eq(promoCode.code, code)).get();
    expect(row).toMatchObject({
      tier: "individual",
      accessDays: 30,
      allowsSignUp: false,
      label: "Browser test",
    });
  });

  it("switches invite-only sign-up", async () => {
    expect((await setup({ kind: "inviteOnly", on: true })).status).toBe(200);
    expect(await readSetting(db(), "sign_up_requires_code")).toBe(true);
    expect((await setup({ kind: "inviteOnly", on: false })).status).toBe(200);
    expect(await readSetting(db(), "sign_up_requires_code")).toBe(false);
  });

  it("sets a household's limit, and changes it", async () => {
    const householdId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO organization (id, name, slug, created_at) VALUES (?1, 'Test', ?2, ?3)",
    )
      .bind(householdId, `test-${householdId}`, Date.now())
      .run();
    for (const value of [3, null]) {
      const res = await setup({ kind: "limitOverride", householdId, key: "max_recipes", value });
      expect(res.status).toBe(200);
    }
    const rows = await db()
      .select()
      .from(limitOverride)
      .where(eq(limitOverride.householdId, householdId))
      .all();
    expect(rows.map((r) => [r.key, r.value])).toEqual([["max_recipes", null]]);
  });

  it("refuses anything else, and never grants the admin role", async () => {
    expect((await setup({ kind: "admin", email: "a@example.com" })).status).toBe(400);
    expect((await setup({ kind: "code", tier: "free", allowsSignUp: true })).status).toBe(400);
    expect(
      (await setup({ kind: "limitOverride", householdId: "x", key: "nope", value: 1 })).status,
    ).toBe(400);
    expect((await setup(null)).status).toBe(400);
  });

  it("is closed anywhere but a local test server", async () => {
    // Addressed to anything but localhost (a real deployment's own address).
    expect(
      (await setup({ kind: "inviteOnly", on: false }, { host: "beta.example.com" })).status,
    ).toBe(404);
    // Without the dev email outbox, or with real email set up.
    expect(
      (await setup({ kind: "inviteOnly", on: false }, { env: { DEV_EMAIL_OUTBOX: "false" } }))
        .status,
    ).toBe(404);
    expect(
      (await setup({ kind: "inviteOnly", on: false }, { env: { RESEND_API_KEY: "re_test" } }))
        .status,
    ).toBe(404);
  });
});
