import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { emptyRecipeContent, RECIPE_SCHEMA_VERSION } from "../../shared/recipe";
import { database } from "../db/client";
import { accountEvent, user } from "../db/schema";
import {
  PASSWORD,
  overrideLimit,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";
import {
  EVENTS_PER_HOUR,
  recordFailedSignIn,
  recordLimitRefusals,
  removeOldAccountEvents,
} from "./events";

// What the admin console's account page keeps that no other table does (U15).

const db = () => database(env.DB);
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;
const id = () => crypto.randomUUID();
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await setUpDatabase();
});

const events = (userId: string, kind?: string) =>
  db()
    .select()
    .from(accountEvent)
    .where(
      kind
        ? and(eq(accountEvent.userId, userId), eq(accountEvent.kind, kind))
        : eq(accountEvent.userId, userId),
    )
    .all();

async function person(label = "june") {
  const address = email(label);
  const v = await signUpConfirmed(address);
  const userId = (await v.session())!.user.id;
  return { v, userId, address };
}

/** Moves a person's account events back in time, as if they happened that long ago. */
async function moveEventsBack(userId: string, ms: number) {
  await env.DB.prepare("update account_event set created_at = created_at - ?1 where user_id = ?2")
    .bind(ms, userId)
    .run();
}

async function register(v: Visitor) {
  const deviceId = id();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  return { deviceId, body: (await res.json()) as { status: string } };
}

const signIn = (address: string, password: string, ua = "Mozilla/5.0 (iPhone) Safari/605.1") =>
  visitor().request("/api/auth/sign-in/email", {
    body: { email: address, password },
    headers: { "user-agent": ua },
  });

describe("failed sign-ins", () => {
  it("are kept against the account typed, and answer the same as an unknown address", async () => {
    const { userId, address } = await person("typo");
    const known = await signIn(address.toUpperCase(), "wrong password!");
    const unknown = await signIn(email("nobody"), "wrong password!");
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await known.json()).toEqual(await unknown.json());
    expect([...known.headers.keys()].sort()).toEqual([...unknown.headers.keys()].sort());

    const rows = await events(userId, "sign_in_failed");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.details)).toEqual({
      browser: "Safari on iPhone",
      hasPassword: true,
    });
    // Never what was typed.
    expect(rows[0]!.details).not.toContain("wrong");
    expect(rows[0]!.details).not.toContain("@");
  });

  it("a right password isn't one, and a sign-in is kept", async () => {
    const { userId, address } = await person("right");
    expect((await signIn(address, PASSWORD)).status).toBe(200);
    expect(await events(userId, "sign_in_failed")).toHaveLength(0);
    const signedIn = await events(userId, "signed_in");
    expect(signedIn.length).toBeGreaterThanOrEqual(1);
    expect(signedIn.map((e) => JSON.parse(e.details) as unknown)).toContainEqual({
      browser: "Safari on iPhone",
      method: "password",
    });
  });

  it("at most 50 an hour per person", async () => {
    const { userId, address } = await person("flood");
    const now = Date.now();
    for (let i = 0; i < EVENTS_PER_HOUR + 5; i++) {
      await recordFailedSignIn(db(), address, "Chrome on Mac", now + i);
    }
    expect(await events(userId, "sign_in_failed")).toHaveLength(EVENTS_PER_HOUR);
  });
});

describe("limit refusals", () => {
  it("one line per limit per hour", async () => {
    const { userId } = await person("refused");
    const now = Date.now();
    const refusal = {
      limit: "max_recipes" as const,
      what: "recipe" as const,
      origin: "server" as const,
    };
    await recordLimitRefusals(db(), userId, [refusal, refusal], now);
    await recordLimitRefusals(db(), userId, [refusal], now + 60_000);
    await recordLimitRefusals(
      db(),
      userId,
      [{ limit: "max_text_bytes", what: "recipe", origin: "server" }],
      now,
    );
    expect(await events(userId, "limit_refused")).toHaveLength(2);
    await recordLimitRefusals(db(), userId, [refusal], now + 61 * 60_000);
    expect(await events(userId, "limit_refused")).toHaveLength(3);
  });

  it("a new recipe refused by sync is kept, with the numbers", async () => {
    const { v, userId } = await person("full");
    await overrideLimit(v, "max_recipes", 0);
    const { deviceId } = await register(v);
    const recipeId = id();
    const res = await v.request("/api/sync/push", {
      body: {
        deviceId,
        schemaVersion: RECIPE_SCHEMA_VERSION,
        sentAt: Date.now(),
        changes: [
          {
            kind: "recipe",
            id: recipeId,
            create: { createdAt: new Date().toISOString(), import: null },
            fields: { ...emptyRecipeContent(), title: "Soup" },
            changedAt: Date.now(),
          },
        ],
      },
    });
    expect(((await res.json()) as { results: unknown[] }).results[0]).toMatchObject({
      reason: "limit",
      limit: "max_recipes",
    });
    const rows = await events(userId, "limit_refused");
    expect(rows.map((r) => JSON.parse(r.details) as unknown)).toEqual([
      {
        limit: "max_recipes",
        what: "recipe",
        used: 0,
        max: 0,
        origin: "server",
        recipeIds: [recipeId],
      },
    ]);
  });

  it("the same refused recipe sent again later isn't another refusal", async () => {
    const { v, userId } = await person("resent");
    await overrideLimit(v, "max_recipes", 0);
    const { deviceId } = await register(v);
    const held = id();
    const push = (recipeIds: string[]) =>
      v.request("/api/sync/push", {
        body: {
          deviceId,
          schemaVersion: RECIPE_SCHEMA_VERSION,
          sentAt: Date.now(),
          changes: recipeIds.map((recipeId) => ({
            kind: "recipe",
            id: recipeId,
            create: { createdAt: new Date().toISOString(), import: null },
            fields: { ...emptyRecipeContent(), title: "Soup" },
            changedAt: Date.now(),
          })),
        },
      });
    await push([held]);
    expect(await events(userId, "limit_refused")).toHaveLength(1);
    // The next morning, the app starts and sends the held recipe again.
    await moveEventsBack(userId, 20 * 60 * 60 * 1000);
    await push([held]);
    expect(await events(userId, "limit_refused")).toHaveLength(1);
    // A recipe never refused before is a new refusal.
    await push([held, id()]);
    expect(await events(userId, "limit_refused")).toHaveLength(2);
  });

  it("a recipe refused within the hour of another is remembered for later", async () => {
    const { userId } = await person("same-hour");
    const now = Date.now();
    const refused = (recipeId: string) => ({
      limit: "max_recipes" as const,
      what: "recipe" as const,
      origin: "server" as const,
      recipeIds: [recipeId],
    });
    const [a, b] = [id(), id()];
    await recordLimitRefusals(db(), userId, [refused(a)], now);
    // Within the hour: no new line, but b is kept with the first.
    await recordLimitRefusals(db(), userId, [refused(b)], now + 60_000);
    const rows = await events(userId, "limit_refused");
    expect(rows).toHaveLength(1);
    expect((JSON.parse(rows[0]!.details) as { recipeIds: string[] }).recipeIds.sort()).toEqual(
      [a, b].sort(),
    );
    // Both sent again the next day: nothing new.
    await recordLimitRefusals(db(), userId, [refused(a), refused(b)], now + DAY);
    expect(await events(userId, "limit_refused")).toHaveLength(1);
    // The person pressing the blocked button is new every time (an hour apart).
    await recordLimitRefusals(
      db(),
      userId,
      [{ limit: "max_recipes", what: "recipe", origin: "app" }],
      now + DAY,
    );
    expect(await events(userId, "limit_refused")).toHaveLength(2);
  });

  it("a second browser turned away by Free's one device", async () => {
    const { v, userId, address } = await person("devices");
    await register(v);
    const other = visitor();
    await other.request("/api/auth/sign-in/email", {
      body: { email: address, password: PASSWORD },
    });
    expect((await register(other)).body.status).toBe("over_limit");
    const rows = await events(userId, "limit_refused");
    expect(JSON.parse(rows[0]!.details)).toMatchObject({ limit: "max_devices", what: "device" });

    // Taking over is kept too: which browser was signed out, by which.
    const take = await other.request("/api/devices/takeover", { body: { deviceId: id() } });
    expect(take.status).toBe(200);
    const taken = await events(userId, "device_taken_over");
    expect(taken).toHaveLength(1);
    expect(JSON.parse(taken[0]!.details)).toEqual({ browser: "A browser", by: "A browser" });
  });

  it("what the app stopped is kept only when the server agrees", async () => {
    const { v, userId } = await person("app");
    const report = (body: unknown) =>
      v.request("/api/limits/refused", { body }).then((res) => res.status);
    expect(await report({ limit: "max_recipes", what: "nonsense" })).toBe(400);
    expect(await report({ limit: "max_devices", what: "recipe" })).toBe(400);
    // Room to spare: nothing kept.
    expect(await report({ limit: "max_recipes", what: "recipe" })).toBe(204);
    expect(await events(userId, "limit_refused")).toHaveLength(0);

    await overrideLimit(v, "max_recipes", 0);
    expect(await report({ limit: "max_recipes", what: "restore" })).toBe(204);
    // Photos aren't part of Free.
    expect(await report({ limit: "images_enabled", what: "photo" })).toBe(204);
    const rows = (await events(userId, "limit_refused")).map(
      (r) => JSON.parse(r.details) as unknown,
    );
    expect(rows).toContainEqual({
      limit: "max_recipes",
      what: "restore",
      used: 0,
      max: 0,
      origin: "app",
    });
    expect(rows).toContainEqual({ limit: "images_enabled", what: "photo", origin: "app" });
    expect(rows).toHaveLength(2);
  });
});

describe("imports", () => {
  it("a refusal for the plan is a limit; anything else that fails is a failed import", async () => {
    const { v, userId } = await person("imports");
    // Too short to be a recipe.
    expect((await v.request("/api/import/text", { body: { text: "Soup" } })).status).toBe(422);
    const failed = await events(userId, "import_failed");
    expect(failed.map((r) => JSON.parse(r.details) as unknown)).toEqual([
      { source: "text", reason: "no_recipe" },
    ]);
    // A wrong request isn't an import failing.
    expect((await v.request("/api/import/text", { body: { text: 4 } })).status).toBe(400);
    expect(await events(userId, "import_failed")).toHaveLength(1);

    // Not laid out as a recipe, so it needs the AI, which Free doesn't have.
    const prose = "My grandmother made this every winter with whatever was in the garden. ".repeat(
      4,
    );
    expect((await v.request("/api/import/text", { body: { text: prose } })).status).toBe(403);
    expect(
      (await events(userId, "limit_refused")).map((r) => JSON.parse(r.details) as unknown),
    ).toEqual([{ limit: "import_ai_enabled", what: "ai_import", origin: "server" }]);
  });
});

describe("keeping", () => {
  it("removes events over 90 days old, and with the account", async () => {
    const { userId } = await person("old");
    const now = Date.now();
    await recordFailedSignIn(
      db(),
      (await db().select().from(user).where(eq(user.id, userId)).get())!.email,
      "Safari on Mac",
      now - 91 * DAY,
    );
    await recordFailedSignIn(
      db(),
      (await db().select().from(user).where(eq(user.id, userId)).get())!.email,
      "Safari on Mac",
      now - DAY,
    );
    expect(await events(userId, "sign_in_failed")).toHaveLength(2);
    expect(await removeOldAccountEvents(db(), now)).toBeGreaterThanOrEqual(1);
    expect(await events(userId, "sign_in_failed")).toHaveLength(1);
    await db().delete(user).where(eq(user.id, userId));
    expect(await events(userId)).toHaveLength(0);
  });
});
