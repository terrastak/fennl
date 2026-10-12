import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  ExtensionLinkCreated,
  ExtensionLinkSummary,
  ExtensionMe,
} from "../../shared/extension";
import { database } from "../db/client";
import { extensionLink } from "../db/schema";
import {
  ORIGIN,
  PASSWORD,
  overrideLimit,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";
import { app } from "../index";

// Phase E5: connecting the Chrome extension once, from Fennl, and what its key can do.

const db = () => database(env.DB);
let counter = 0;

beforeAll(async () => {
  await setUpDatabase();
});

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

async function person(name = "June Lee") {
  const email = `extension-${++counter}@example.com`;
  const v = await signUpConfirmed(email, name);
  return { v, email };
}

async function connect(v: Visitor) {
  const res = await v.request("/api/extension/links", {
    method: "POST",
    headers: { "user-agent": CHROME_MAC },
  });
  return {
    status: res.status,
    body: (await res.json()) as ExtensionLinkCreated & { error?: string },
  };
}

/** A request as the extension makes it: its key, no cookies. */
function asExtension(key: string | null, path: string, method = "GET") {
  return app.request(
    `${ORIGIN}${path}`,
    { method, headers: key ? { authorization: `Bearer ${key}` } : {} },
    env,
  );
}

async function me(key: string) {
  const res = await asExtension(key, "/api/extension/me");
  return { status: res.status, body: (await res.json()) as ExtensionMe & { error?: string } };
}

async function links(v: Visitor) {
  const res = await v.request("/api/extension/links");
  return ((await res.json()) as { links: ExtensionLinkSummary[] }).links;
}

describe("connecting", () => {
  it("gives the extension a key that says who it's connected to", async () => {
    const { v, email } = await person();
    const { status, body } = await connect(v);
    expect(status).toBe(201);
    expect(body.key).toMatch(/^fnx_[A-Za-z0-9_-]{43}$/);
    expect(await me(body.key)).toEqual({
      status: 200,
      body: {
        name: "June Lee",
        email,
        tier: "free",
        importPages: true,
        importWithAi: false,
        photos: false,
      },
    });
    // Only a hash of the key is kept.
    const row = await db().select().from(extensionLink).where(eq(extensionLink.id, body.id)).get();
    expect(row?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(body.key);
    expect(await links(v)).toEqual([
      expect.objectContaining({ id: body.id, label: "Chrome on Mac" }),
    ]);
  });

  it("says when the plan doesn't include importing pages", async () => {
    const { v } = await person();
    await overrideLimit(v, "structured_imports_per_day", 0);
    const { body } = await connect(v);
    expect((await me(body.key)).body.importPages).toBe(false);
  });

  it("needs a signed-in person, and has a limit per account", async () => {
    const res = await visitor().request("/api/extension/links", { method: "POST" });
    expect(res.status).toBe(401);
    const { v } = await person();
    for (let i = 0; i < 10; i++) expect((await connect(v)).status).toBe(201);
    expect(await connect(v)).toEqual({ status: 409, body: { error: "too_many" } });
  });
});

describe("a key", () => {
  it("is refused when missing, malformed or unknown", async () => {
    expect((await asExtension(null, "/api/extension/me")).status).toBe(401);
    expect((await asExtension("abc", "/api/extension/me")).status).toBe(401);
    expect((await me(`fnx_${"A".repeat(43)}`)).status).toBe(401);
  });

  it("never works as a sign-in for anything else", async () => {
    const { v } = await person();
    const { body } = await connect(v);
    for (const path of [
      "/api/household",
      "/api/sync/pull?deviceId=x&schemaVersion=2&since=",
      "/api/extension/links",
      "/api/import/jobs",
    ]) {
      expect((await asExtension(body.key, path)).status, path).toBe(401);
    }
  });

  it("stops working when removed on the Account page, or disconnected by the extension", async () => {
    const { v } = await person();
    const first = (await connect(v)).body;
    const second = (await connect(v)).body;
    const removed = await v.request(`/api/extension/links/${first.id}/remove`, { method: "POST" });
    expect(removed.status).toBe(200);
    expect((await me(first.key)).status).toBe(401);
    expect((await me(second.key)).status).toBe(200);

    expect((await asExtension(second.key, "/api/extension/disconnect", "POST")).status).toBe(200);
    expect((await me(second.key)).status).toBe(401);
    expect(await links(v)).toEqual([]);
  });

  it("can only be removed by its own person", async () => {
    const june = await person();
    const sam = await person("Sam Park");
    const { body } = await connect(june.v);
    const res = await sam.v.request(`/api/extension/links/${body.id}/remove`, { method: "POST" });
    expect(res.status).toBe(404);
    expect((await me(body.key)).status).toBe(200);
  });

  it("stops working after 90 days unused", async () => {
    const { v } = await person();
    const { body } = await connect(v);
    await db()
      .update(extensionLink)
      .set({ lastUsedAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(eq(extensionLink.id, body.id));
    expect(await links(v)).toEqual([]);
    expect((await me(body.key)).status).toBe(401);
    const row = await db().select().from(extensionLink).where(eq(extensionLink.id, body.id)).get();
    expect(row?.revokedReason).toBe("unused");
  });

  it("stops working when the account's password changes", async () => {
    const { v } = await person();
    const { body } = await connect(v);
    const changed = await v.request("/api/auth/change-password", {
      body: { currentPassword: PASSWORD, newPassword: "another long password" },
    });
    expect(changed.status).toBe(200);
    expect((await me(body.key)).status).toBe(401);
    const row = await db().select().from(extensionLink).where(eq(extensionLink.id, body.id)).get();
    expect(row?.revokedReason).toBe("password_changed");
  });
});
