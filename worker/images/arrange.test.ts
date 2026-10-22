import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PhotoOrderResponse } from "../../shared/photoOrder";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "../../shared/recipe";
import { directionsFromText } from "../../shared/recipeLines";
import type { ChangeResult, SyncChange } from "../../shared/sync";
import { FAKE_TOKENS, fakeAi } from "../ai/fake";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { aiUsage } from "../db/schema";
import { setUpDatabase, signUpConfirmed, visitor, type Visitor } from "../test/visitor";

// Phase D4: Fennl's order for a recipe's photos. The fake AI takes the last photo for the
// finished dish and the cover, and the others for the method's steps in turn.

const db = () => database(env.DB);
let counter = 0;
const id = () => crypto.randomUUID();

beforeAll(async () => {
  await setUpDatabase();
});
beforeEach(() => fakeAi.reset());

interface Person {
  v: Visitor;
  userId: string;
  deviceId: string;
}

async function premiumPerson(): Promise<Person> {
  const v = await signUpConfirmed(`arrange-${++counter}@example.com`);
  const deviceId = id();
  expect((await v.request("/api/devices/register", { body: { deviceId } })).status).toBe(200);
  const code = await createCode(
    db(),
    {
      code: `ARRANGE-${++counter}`,
      label: "Arrange tests",
      tier: "individual",
      access: { forever: true },
      allowsSignUp: true,
      maxUses: null,
      redeemBy: null,
    },
    null,
  );
  expect((await v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(200);
  return { v, userId: (await v.session())!.user.id, deviceId };
}

async function push(p: Person, changes: SyncChange[]) {
  const res = await p.v.request("/api/sync/push", {
    body: {
      deviceId: p.deviceId,
      schemaVersion: RECIPE_SCHEMA_VERSION,
      sentAt: Date.now(),
      changes,
    },
  });
  return ((await res.json()) as { results: ChangeResult[] }).results;
}

/** Bytes that start like a JPEG, different every time. */
function jpeg(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  const seed = ++counter;
  for (let i = 4; i < bytes.length; i++) bytes[i] = (seed * 31 + i * 7) % 251;
  return bytes;
}

/** A recipe with a two-step method and photos taken at these times (null: unknown). */
async function recipeWithPhotos(p: Person, taken: (number | null)[]) {
  const recipeId = id();
  const photoIds = taken.map(() => id());
  const changes: SyncChange[] = [
    {
      kind: "recipe",
      id: recipeId,
      create: { createdAt: new Date().toISOString(), import: null },
      fields: {
        ...emptyRecipeContent(),
        title: "Focaccia",
        directions: directionsFromText("Mix the dough.\nShape it in the pan."),
      },
      changedAt: Date.now(),
    },
  ];
  for (const [i, takenAt] of taken.entries()) {
    const up = await p.v.request("/api/images/upload", { bytes: jpeg() });
    const { hash } = (await up.json()) as { hash: string };
    expect((await p.v.request(`/api/images/${hash}/thumb`, { bytes: jpeg() })).status).toBe(201);
    changes.push({
      kind: "photo",
      id: photoIds[i]!,
      recipeId,
      create: { imageHash: hash, role: "photo", width: 800, height: 600, takenAt },
      fields: { sortOrder: i + 1 },
      changedAt: Date.now(),
    });
  }
  expect((await push(p, changes)).every((r) => r.status === "applied")).toBe(true);
  return { recipeId, photoIds };
}

async function arrange(v: Visitor, recipeId: unknown) {
  const res = await v.request("/api/photos/arrange", { body: { recipeId } });
  return {
    status: res.status,
    body: (await res.json()) as PhotoOrderResponse & { error?: string },
  };
}

describe("arranging a recipe's photos", () => {
  it("puts the finished dish first, then the steps, and never counts as an import", async () => {
    const june = await premiumPerson();
    const {
      recipeId,
      photoIds: [mix, shape, done],
    } = await recipeWithPhotos(june, [1, 2, 3]);
    expect((await arrange(june.v, recipeId)).body).toEqual({
      order: [done, mix, shape],
      by: "fennl",
    });
    const usage = await db().select().from(aiUsage).where(eq(aiUsage.userId, june.userId)).all();
    expect(usage.map((u) => [u.purpose, u.countsAsImport, u.status])).toEqual([
      ["arrange", 0, "ok"],
    ]);
    // The recipe and its photos' small copies are what the AI sees.
    const [request] = fakeAi.requests;
    expect(request?.parts.map((part) => part.label)).toEqual([
      "The recipe",
      "Photo 1",
      "Photo 2",
      "Photo 3",
    ]);
    expect(request?.parts[0]).toMatchObject({
      text: expect.stringContaining("2. Shape it in the pan."),
    });
  });

  it("doesn't ask the AI again about the same photos", async () => {
    const june = await premiumPerson();
    const { recipeId } = await recipeWithPhotos(june, [1, 2]);
    const first = (await arrange(june.v, recipeId)).body;
    expect((await arrange(june.v, recipeId)).body).toEqual(first);
    expect(fakeAi.requests).toHaveLength(1);
  });

  it("leaves photos someone arranged by hand", async () => {
    const june = await premiumPerson();
    const { recipeId, photoIds } = await recipeWithPhotos(june, [1, 2]);
    await push(june, [
      {
        kind: "photo",
        id: photoIds[1]!,
        recipeId,
        fields: { sortOrder: 0, arrangedBy: "person" },
        changedAt: Date.now(),
      },
    ]);
    expect((await arrange(june.v, recipeId)).body).toEqual({
      order: [photoIds[1], photoIds[0]],
      by: "person",
    });
    expect(fakeAi.requests).toHaveLength(0);
  });

  it("goes by when they were taken when the AI has no answer", async () => {
    const june = await premiumPerson();
    fakeAi.reply = () => ({ ok: false, problem: "failed", tokens: FAKE_TOKENS, detail: "down" });
    const {
      recipeId,
      photoIds: [unknown, late, early],
    } = await recipeWithPhotos(june, [null, 20, 10]);
    expect((await arrange(june.v, recipeId)).body).toEqual({
      order: [early, late, unknown],
      by: "time",
    });
  });

  it("answers only about a recipe in the caller's household, and needs a signed-in person", async () => {
    const june = await premiumPerson();
    const pat = await premiumPerson();
    const { recipeId } = await recipeWithPhotos(june, [1, 2]);
    expect((await arrange(pat.v, recipeId)).status).toBe(404);
    expect((await arrange(june.v, "x")).status).toBe(400);
    expect((await arrange(visitor(), recipeId)).status).toBe(401);
  });

  it("has nothing to arrange with one photo", async () => {
    const june = await premiumPerson();
    const { recipeId, photoIds } = await recipeWithPhotos(june, [1]);
    expect((await arrange(june.v, recipeId)).body).toEqual({ order: photoIds, by: "unchanged" });
  });
});
