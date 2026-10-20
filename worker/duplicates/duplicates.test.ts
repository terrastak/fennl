import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_DISMISSALS } from "../../shared/duplicates";
import { database } from "../db/client";
import { duplicateDismissal, user } from "../db/schema";
import { setUpDatabase, signUpConfirmed, visitor, type Visitor } from "../test/visitor";

// Phase C14: "not a duplicate" answers.

const db = () => database(env.DB);
let counter = 0;

beforeAll(async () => {
  await setUpDatabase();
});

async function person() {
  const email = `duplicates-${++counter}@example.com`;
  return { v: await signUpConfirmed(email), email };
}

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

async function call(v: Visitor, method: string, path: string, body?: unknown) {
  const res = await v.request(path, { method, ...(body === undefined ? {} : { body }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const pairs = async (v: Visitor) =>
  ((await call(v, "GET", "/api/duplicate-dismissals")).body.pairs ?? []) as [string, string][];
const dismiss = (v: Visitor, a: unknown, b: unknown) =>
  call(v, "POST", "/api/duplicate-dismissals", { a, b });

describe("saying a pair is not a duplicate", () => {
  it("keeps the pair, with the smaller id first, whichever way round it was said", async () => {
    const { v } = await person();
    expect(await pairs(v)).toEqual([]);
    expect((await dismiss(v, ID_B, ID_A)).status).toBe(201);
    expect(await pairs(v)).toEqual([[ID_A, ID_B]]);
  });

  it("is fine to say twice", async () => {
    const { v } = await person();
    await dismiss(v, ID_A, ID_B);
    expect((await dismiss(v, ID_B, ID_A)).status).toBe(201);
    expect(await pairs(v)).toHaveLength(1);
  });

  it("needs a signed-in person", async () => {
    for (const [method, path] of [
      ["GET", "/api/duplicate-dismissals"],
      ["POST", "/api/duplicate-dismissals"],
      ["DELETE", `/api/duplicate-dismissals/${ID_A}/${ID_B}`],
      ["DELETE", "/api/duplicate-dismissals"],
    ] as const) {
      const body = method === "POST" ? { a: ID_A, b: ID_B } : undefined;
      expect((await call(visitor(), method, path, body)).status).toBe(401);
    }
  });

  it("refuses ids that aren't recipe ids, and a recipe paired with itself", async () => {
    const { v } = await person();
    for (const [a, b] of [
      ["", ID_B],
      [ID_A, undefined],
      [ID_A, ID_A],
      ["short", ID_B],
      [`${ID_A}; drop table`, ID_B],
      [5, ID_B],
    ]) {
      expect((await dismiss(v, a, b)).body.error).toBe("invalid_pair");
    }
    expect(await pairs(v)).toEqual([]);
  });

  it("has a limit per account", async () => {
    const { v, email } = await person();
    const owner = await db().select().from(user).where(eq(user.email, email)).get();
    const now = new Date();
    for (let start = 0; start < MAX_DISMISSALS; start += 150) {
      const batch = Array.from({ length: Math.min(150, MAX_DISMISSALS - start) }, (_, i) => ({
        userId: owner!.id,
        recipeA: `a-${String(start + i).padStart(8, "0")}`,
        recipeB: `b-${String(start + i).padStart(8, "0")}`,
        createdAt: now,
      }));
      // D1 allows only so many values in one statement, so the rows go in a few at a time.
      for (let i = 0; i < batch.length; i += 20) {
        await db()
          .insert(duplicateDismissal)
          .values(batch.slice(i, i + 20));
      }
    }
    expect(await dismiss(v, ID_A, ID_B)).toEqual({ status: 409, body: { error: "too_many" } });
  });
});

describe("taking an answer back", () => {
  it("removes one pair, whichever way round, and says nothing if it wasn't there", async () => {
    const { v } = await person();
    await dismiss(v, ID_A, ID_B);
    await dismiss(v, ID_A, ID_C);
    expect((await call(v, "DELETE", `/api/duplicate-dismissals/${ID_B}/${ID_A}`)).status).toBe(200);
    expect(await pairs(v)).toEqual([[ID_A, ID_C]]);
    expect((await call(v, "DELETE", `/api/duplicate-dismissals/${ID_B}/${ID_A}`)).status).toBe(200);
  });

  it("clears every answer", async () => {
    const { v } = await person();
    await dismiss(v, ID_A, ID_B);
    await dismiss(v, ID_A, ID_C);
    expect((await call(v, "DELETE", "/api/duplicate-dismissals")).status).toBe(200);
    expect(await pairs(v)).toEqual([]);
  });

  it("refuses ids that aren't recipe ids", async () => {
    const { v } = await person();
    expect((await call(v, "DELETE", "/api/duplicate-dismissals/x/y")).status).toBe(400);
  });
});

describe("whose they are", () => {
  it("are the person's own: nobody else sees or changes them", async () => {
    const june = await person();
    const sam = await person();
    await dismiss(june.v, ID_A, ID_B);
    expect(await pairs(sam.v)).toEqual([]);
    await call(sam.v, "DELETE", `/api/duplicate-dismissals/${ID_A}/${ID_B}`);
    await call(sam.v, "DELETE", "/api/duplicate-dismissals");
    expect(await pairs(june.v)).toEqual([[ID_A, ID_B]]);
    // The same pair is fine for someone else too.
    expect((await dismiss(sam.v, ID_A, ID_B)).status).toBe(201);
  });

  it("go when the account goes", async () => {
    const { v, email } = await person();
    await dismiss(v, ID_A, ID_B);
    const owner = await db().select().from(user).where(eq(user.email, email)).get();
    const mine = () =>
      db().select().from(duplicateDismissal).where(eq(duplicateDismissal.userId, owner!.id));
    expect(await mine()).toHaveLength(1);
    await db().delete(user).where(eq(user.id, owner!.id));
    expect(await mine()).toHaveLength(0);
  });
});
