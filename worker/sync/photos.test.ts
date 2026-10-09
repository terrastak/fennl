import { env } from "cloudflare:test";
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "../../shared/recipe";
import {
  formatCursors,
  type ChangeResult,
  type Cursors,
  type PullResponse,
  type SyncChange,
} from "../../shared/sync";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { image, member, organization, recipe, recipePhoto, session } from "../db/schema";
import {
  overrideLimit,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";
import { expungeRecipes } from "./trash";

// Phase D2: photos on recipes, synced like the rest of a recipe. A photo (and its image) belongs
// to the recipe's owner, whoever adds it; a recipe has at most max_photos_per_recipe photos.

const db = () => database(env.DB);
let counter = 0;
const id = () => crypto.randomUUID();

beforeAll(async () => {
  await setUpDatabase();
});

interface Person {
  v: Visitor;
  userId: string;
  deviceId: string;
}

async function person(name = "June Lee"): Promise<Person> {
  const v = await signUpConfirmed(
    `${name.split(" ")[0]!.toLowerCase()}-${++counter}@example.com`,
    name,
  );
  const deviceId = id();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(res.status).toBe(200);
  return { v, userId: (await v.session())!.user.id, deviceId };
}

async function premium(p: Person) {
  const code = await createCode(
    db(),
    {
      code: `PHOTO-${++counter}`,
      label: "Photo tests",
      tier: "household",
      access: { forever: true },
      allowsSignUp: true,
      maxUses: null,
      redeemBy: null,
    },
    null,
  );
  expect((await p.v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(200);
}

async function premiumPerson(name?: string) {
  const p = await person(name);
  await premium(p);
  return p;
}

/** Two people sharing a household with Premium. */
async function couple() {
  const a = await person("Ana Ruiz");
  const b = await person("Ben Ruiz");
  const householdId = id();
  await db()
    .insert(organization)
    .values({
      id: householdId,
      name: "Shared",
      slug: `shared-${householdId}`,
      createdAt: new Date(),
    });
  await db()
    .insert(member)
    .values(
      [a, b].map((p, i) => ({
        id: id(),
        organizationId: householdId,
        userId: p.userId,
        role: i === 0 ? "owner" : "member",
        createdAt: new Date(),
      })),
    );
  await db()
    .update(session)
    .set({ activeOrganizationId: householdId })
    .where(inArray(session.userId, [a.userId, b.userId]));
  await premium(a);
  return { a, b };
}

async function push(p: Person, changes: unknown[]) {
  const res = await p.v.request("/api/sync/push", {
    body: {
      deviceId: p.deviceId,
      schemaVersion: RECIPE_SCHEMA_VERSION,
      sentAt: Date.now(),
      changes,
    },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: ChangeResult[] }).results;
}

async function pullAll(p: Person): Promise<PullResponse> {
  let since: Cursors = {};
  const photos: PullResponse["photos"] = [];
  let last: PullResponse | null = null;
  for (let i = 0; i < 20; i++) {
    const query = new URLSearchParams({
      deviceId: p.deviceId,
      schemaVersion: String(RECIPE_SCHEMA_VERSION),
      since: formatCursors(since),
    });
    const res = await p.v.request(`/api/sync/pull?${query.toString()}`);
    last = (await res.json()) as PullResponse;
    photos.push(...last.photos);
    since = last.cursors;
    if (!last.more) break;
  }
  return { ...last!, photos };
}

function newRecipe(recipeId = id()): SyncChange {
  return {
    kind: "recipe",
    id: recipeId,
    create: { createdAt: new Date().toISOString(), import: null },
    fields: { ...emptyRecipeContent(), title: "Shakshuka" },
    changedAt: Date.now(),
  };
}

/** Bytes that start like a JPEG, different every time. */
function jpeg(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  const seed = ++counter;
  for (let i = 4; i < size; i++) bytes[i] = (seed * 31 + i * 7) % 251;
  return bytes;
}

async function upload(p: Person, owner?: string, bytes = jpeg()) {
  const res = await p.v.request(`/api/images/upload${owner ? `?owner=${owner}` : ""}`, { bytes });
  return { status: res.status, body: (await res.json()) as { hash: string; error?: string } };
}

function addPhoto(
  recipeId: string,
  imageHash: string,
  extra: { photoId?: string; sortOrder?: number; changedAt?: number } = {},
): SyncChange {
  return {
    kind: "photo",
    id: extra.photoId ?? id(),
    recipeId,
    create: { imageHash, role: "photo", width: 1800, height: 2400 },
    fields: { sortOrder: extra.sortOrder ?? 1 },
    changedAt: extra.changedAt ?? Date.now(),
  };
}

const applied: ChangeResult = { status: "applied" };
const notFound: ChangeResult = { status: "rejected", reason: "not_found" };
const full: ChangeResult = { status: "rejected", reason: "limit", limit: "max_photos_per_recipe" };

describe("photos on recipes", () => {
  it("adds a photo, and every device of the household fetches it", async () => {
    const june = await premiumPerson();
    const recipeId = id();
    const { hash } = (await upload(june)).body;
    const photoId = id();
    expect(await push(june, [newRecipe(recipeId), addPhoto(recipeId, hash, { photoId })])).toEqual([
      applied,
      applied,
    ]);
    const { photos } = await pullAll(june);
    expect(photos).toEqual([
      expect.objectContaining({
        id: photoId,
        recipeId,
        imageHash: hash,
        role: "photo",
        width: 1800,
        height: 2400,
        sortOrder: 1,
        addedByUserId: june.userId,
        deletedAt: null,
      }),
    ]);
  });

  it("refuses a photo whose image wasn't uploaded, or another household's recipe", async () => {
    const june = await premiumPerson();
    const sam = await premiumPerson("Sam Park");
    const recipeId = id();
    await push(june, [newRecipe(recipeId)]);
    expect(await push(june, [addPhoto(recipeId, "a".repeat(64))])).toEqual([notFound]);
    const { hash } = (await upload(sam)).body;
    // Sam's own image, on June's recipe: not his household's recipe.
    expect(await push(sam, [addPhoto(recipeId, hash)])).toEqual([notFound]);
    // June's recipe with Sam's image: the image isn't stored for June.
    expect(await push(june, [addPhoto(recipeId, hash)])).toEqual([notFound]);
  });

  it("moves and removes photos, last change winning", async () => {
    const june = await premiumPerson();
    const recipeId = id();
    const { hash } = (await upload(june)).body;
    const photoId = id();
    const t = Date.now();
    await push(june, [newRecipe(recipeId), addPhoto(recipeId, hash, { photoId, changedAt: t })]);
    const move = (sortOrder: number, changedAt: number): SyncChange => ({
      kind: "photo",
      id: photoId,
      recipeId,
      fields: { sortOrder },
      changedAt,
    });
    expect(await push(june, [move(5, t + 10), move(3, t + 5)])).toEqual([
      applied,
      { status: "unchanged" },
    ]);
    expect(
      await push(june, [
        { kind: "photo", id: photoId, recipeId, fields: {}, deleted: true, changedAt: t + 20 },
      ]),
    ).toEqual([applied]);
    const row = await db().select().from(recipePhoto).where(eq(recipePhoto.id, photoId)).get();
    expect(row).toMatchObject({ sortOrder: 5 });
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe("whose photo it is", () => {
  it("belongs to the recipe's owner when a partner adds it, and says who added it", async () => {
    const { a, b } = await couple();
    const recipeId = id();
    await push(a, [newRecipe(recipeId)]);
    // Ben uploads for Ana's recipe: the image is Ana's (it counts for the household either way).
    const uploaded = await upload(b, a.userId);
    expect(uploaded.status).toBe(201);
    const stored = await db().select().from(image).where(eq(image.hash, uploaded.body.hash)).all();
    expect(stored.map((row) => row.ownerUserId)).toEqual([a.userId]);
    expect((await env.IMAGES.head(`${a.userId}/${uploaded.body.hash}`))?.size).toBeGreaterThan(0);

    const photoId = id();
    expect(await push(b, [addPhoto(recipeId, uploaded.body.hash, { photoId })])).toEqual([applied]);
    const row = await db().select().from(recipePhoto).where(eq(recipePhoto.id, photoId)).get();
    expect(row).toMatchObject({ ownerUserId: a.userId, addedByUserId: b.userId });
    // Both see it.
    expect((await pullAll(a)).photos.map((p) => p.id)).toContain(photoId);
    expect((await pullAll(b)).photos.map((p) => p.id)).toContain(photoId);
  });

  it("won't upload for someone outside the household", async () => {
    const june = await premiumPerson();
    const sam = await premiumPerson("Sam Park");
    expect((await upload(june, sam.userId)).status).toBe(404);
    expect((await upload(june, "not-a-member")).status).toBe(404);
  });
});

describe("photos per recipe", () => {
  it("stops at the plan's limit, with room again when one is removed", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "max_photos_per_recipe", 2);
    const recipeId = id();
    const hashes = [];
    for (let i = 0; i < 3; i++) hashes.push((await upload(june)).body.hash);
    const first = id();
    expect(
      await push(june, [
        newRecipe(recipeId),
        addPhoto(recipeId, hashes[0]!, { photoId: first }),
        addPhoto(recipeId, hashes[1]!),
        addPhoto(recipeId, hashes[2]!),
      ]),
    ).toEqual([applied, applied, applied, full]);
    // Removing one makes room; putting it back when full is turned away.
    const remove: SyncChange = {
      kind: "photo",
      id: first,
      recipeId,
      fields: {},
      deleted: true,
      changedAt: Date.now(),
    };
    expect(await push(june, [remove, addPhoto(recipeId, hashes[2]!)])).toEqual([applied, applied]);
    expect(
      await push(june, [
        {
          kind: "photo",
          id: first,
          recipeId,
          fields: {},
          deleted: false,
          changedAt: Date.now() + 5,
        },
      ]),
    ).toEqual([full]);
  });

  it("starts at the decided limit: 10 on Premium, none on Free", async () => {
    const june = await premiumPerson();
    const plan = (await (await june.v.request("/api/entitlements")).json()) as {
      max_photos_per_recipe: number;
    };
    expect(plan.max_photos_per_recipe).toBe(10);
    const free = await person("Kim Wu");
    const freePlan = (await (await free.v.request("/api/entitlements")).json()) as {
      max_photos_per_recipe: number;
    };
    expect(freePlan.max_photos_per_recipe).toBe(0);
  });

  it("can't be beaten by two devices adding at the same moment", async () => {
    const june = await premiumPerson();
    await overrideLimit(june.v, "max_photos_per_recipe", 2);
    const recipeId = id();
    await push(june, [newRecipe(recipeId)]);
    const hashes = [];
    for (let i = 0; i < 4; i++) hashes.push((await upload(june)).body.hash);
    await Promise.all(hashes.map((hash) => push(june, [addPhoto(recipeId, hash)])));
    const live = await db()
      .select()
      .from(recipePhoto)
      .where(and(eq(recipePhoto.recipeId, recipeId)))
      .all();
    expect(live.filter((row) => !row.deletedAt)).toHaveLength(2);
  });
});

describe("thumbnails", () => {
  it("stores a small copy and serves it, or the photo until there is one", async () => {
    const june = await premiumPerson();
    const big = jpeg(400);
    const { hash } = (await upload(june, undefined, big)).body;

    // No small copy yet: the photo itself, kept only an hour.
    const before = await june.v.request(`/api/images/${hash}/thumb`);
    expect(before.status).toBe(200);
    expect(new Uint8Array(await before.arrayBuffer())).toEqual(big);
    expect(before.headers.get("cache-control")).toBe("private, max-age=3600");

    const small = jpeg(40);
    const res = await june.v.request(`/api/images/${hash}/thumb`, { bytes: small });
    expect(res.status).toBe(201);
    const after = await june.v.request(`/api/images/${hash}/thumb`);
    expect(new Uint8Array(await after.arrayBuffer())).toEqual(small);
    expect(after.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    // The thumbnail doesn't count towards the quota.
    const row = await db().select().from(image).where(eq(image.hash, hash)).get();
    expect(row).toMatchObject({ bytes: 400, thumbBytes: 40 });
  });

  it("is refused for a photo that isn't stored, for a file that isn't a picture, and for other households", async () => {
    const june = await premiumPerson();
    const sam = await premiumPerson("Sam Park");
    expect(
      (await june.v.request(`/api/images/${"0".repeat(64)}/thumb`, { bytes: jpeg() })).status,
    ).toBe(404);
    const { hash } = (await upload(june)).body;
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect((await june.v.request(`/api/images/${hash}/thumb`, { bytes: html })).status).toBe(415);
    expect((await sam.v.request(`/api/images/${hash}/thumb`, { bytes: jpeg() })).status).toBe(404);
    expect((await sam.v.request(`/api/images/${hash}/thumb`)).status).toBe(404);
    const outsider = visitor();
    expect((await outsider.request(`/api/images/${hash}/thumb`)).status).toBe(401);
  });
});

describe("recipes deleted for good", () => {
  it("take their photos with them", async () => {
    const june = await premiumPerson();
    const recipeId = id();
    const { hash } = (await upload(june)).body;
    const photoId = id();
    await push(june, [
      newRecipe(recipeId),
      addPhoto(recipeId, hash, { photoId }),
      { kind: "recipe", id: recipeId, fields: {}, deleted: true, changedAt: Date.now() + 1 },
    ]);
    expect(await expungeRecipes(db(), [recipeId])).toBe(1);
    const row = await db().select().from(recipePhoto).where(eq(recipePhoto.id, photoId)).get();
    expect(row?.deletedAt).not.toBeNull();
    expect(
      (await db().select().from(recipe).where(eq(recipe.id, recipeId)).get())?.expungedAt,
    ).not.toBeNull();
    // And nothing more can be added to it.
    const { hash: other } = (await upload(june)).body;
    expect(await push(june, [addPhoto(recipeId, other)])).toEqual([{ status: "unchanged" }]);
  });
});
