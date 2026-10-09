import { env } from "cloudflare:test";
import { strFromU8, unzipSync } from "fflate";
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { readExportFile } from "../../shared/exportFormat";
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
import {
  image,
  member,
  organization,
  photoGrace,
  premiumGrant,
  recipePhoto,
  session,
} from "../db/schema";
import type { EmailMessage } from "../email/email";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";
import { PHOTO_GRACE_DAYS, photoGracePeriods, reminderDue } from "./grace";
import { UNUSED_DAYS, markUnusedImages, purgeDeletedImages, reconcileImages } from "./housekeeping";
import { PURGE_WINDOW_MS } from "./images";

// Phase D3: photo housekeeping. Photos nothing shows are removed after a week and their stored
// copies deleted; image rows are checked against R2; photos in a household without photos are
// kept for 90 days, with reminders, then deleted.

const db = () => database(env.DB);
let counter = 0;
const id = () => crypto.randomUUID();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
  expect((await v.request("/api/devices/register", { body: { deviceId } })).status).toBe(200);
  return { v, userId: (await v.session())!.user.id, deviceId };
}

async function premium(p: Person) {
  const code = await createCode(
    db(),
    {
      code: `HOUSE-${++counter}`,
      label: "Housekeeping tests",
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

/** Premium from codes taken away (as when a code's access ends), or given back. */
async function setPremium(p: Person, on: boolean) {
  await db()
    .update(premiumGrant)
    .set({ revokedAt: on ? null : new Date() })
    .where(eq(premiumGrant.userId, p.userId));
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

function newRecipe(recipeId = id(), title = "Shakshuka"): SyncChange {
  return {
    kind: "recipe",
    id: recipeId,
    create: { createdAt: new Date().toISOString(), import: null },
    fields: { ...emptyRecipeContent(), title },
    changedAt: Date.now(),
  };
}

function jpeg(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  const seed = ++counter;
  for (let i = 4; i < size; i++) bytes[i] = (seed * 31 + i * 7) % 251;
  return bytes;
}

async function upload(p: Person, bytes = jpeg()) {
  const res = await p.v.request("/api/images/upload", { bytes });
  return { status: res.status, body: (await res.json()) as { hash: string; error?: string } };
}

async function uploadWithThumb(p: Person, bytes = jpeg()) {
  const { hash } = (await upload(p, bytes)).body;
  const thumb = await p.v.request(`/api/images/${hash}/thumb`, { bytes: jpeg(32) });
  expect(thumb.status).toBe(201);
  return hash;
}

const addPhoto = (
  recipeId: string,
  imageHash: string,
  photoId = id(),
  sortOrder = 1,
): SyncChange => ({
  kind: "photo",
  id: photoId,
  recipeId,
  create: { imageHash, role: "photo", width: 800, height: 600 },
  fields: { sortOrder },
  changedAt: Date.now(),
});

const removePhoto = (recipeId: string, photoId: string, deleted = true): SyncChange => ({
  kind: "photo",
  id: photoId,
  recipeId,
  fields: {},
  deleted,
  changedAt: Date.now(),
});

const row = (p: Person, hash: string) =>
  db()
    .select()
    .from(image)
    .where(and(eq(image.ownerUserId, p.userId), eq(image.hash, hash)))
    .get();

const stored = async (p: Person, hash: string) =>
  (await env.IMAGES.list({ prefix: `${p.userId}/${hash}` })).objects.map((o) =>
    o.key.slice(p.userId.length + 1),
  );

/** Moves a photo's times back, as if it was added (or stopped being used) `days` ago. */
async function age(p: Person, hash: string, days: number) {
  const then = new Date(Date.now() - days * DAY);
  await db()
    .update(image)
    .set({ createdAt: then })
    .where(and(eq(image.ownerUserId, p.userId), eq(image.hash, hash)));
  await db()
    .update(recipePhoto)
    .set({ updatedAt: then })
    .where(and(eq(recipePhoto.ownerUserId, p.userId), eq(recipePhoto.imageHash, hash)));
}

describe("photos nothing shows", () => {
  it("are removed a week after they stop being used, and their stored copies deleted", async () => {
    const june = await premiumPerson();
    const recipeId = id();
    const shown = await uploadWithThumb(june);
    const removed = await uploadWithThumb(june);
    const neverAdded = await uploadWithThumb(june);
    const photoId = id();
    expect(
      await push(june, [
        newRecipe(recipeId),
        addPhoto(recipeId, shown),
        addPhoto(recipeId, removed, photoId),
      ]),
    ).toEqual([{ status: "applied" }, { status: "applied" }, { status: "applied" }]);
    expect(await push(june, [removePhoto(recipeId, photoId)])).toEqual([{ status: "applied" }]);

    // Within the week, nothing goes.
    for (const hash of [shown, removed, neverAdded]) await age(june, hash, UNUSED_DAYS - 1);
    await markUnusedImages(db());
    for (const hash of [shown, removed, neverAdded]) {
      expect((await row(june, hash))?.deletedAt).toBeNull();
    }

    // After it, the two nothing shows are removed; the one on the recipe stays.
    for (const hash of [shown, removed, neverAdded]) await age(june, hash, UNUSED_DAYS + 1);
    expect(await markUnusedImages(db())).toBeGreaterThanOrEqual(2);
    expect((await row(june, shown))?.deletedAt).toBeNull();
    expect((await row(june, removed))?.deletedAt).not.toBeNull();
    expect((await row(june, neverAdded))?.deletedAt).not.toBeNull();
    const usage = (await pullAll(june)).usage.photos;
    expect(usage).toMatchObject({ count: 1, bytes: 64 });

    // Their stored copies (and small copies) are deleted; the one in use keeps both.
    expect(await stored(june, removed)).toEqual([removed, `${removed}.thumb`]);
    expect(await purgeDeletedImages(db(), env.IMAGES)).toBeGreaterThanOrEqual(2);
    expect(await stored(june, removed)).toEqual([]);
    expect(await stored(june, neverAdded)).toEqual([]);
    expect(await stored(june, shown)).toEqual([shown, `${shown}.thumb`]);
    expect((await row(june, removed))?.purgedAt).not.toBeNull();

    // A removed photo can't be put back once its image is gone: devices keep it removed.
    expect(await push(june, [removePhoto(recipeId, photoId, false)])).toEqual([
      { status: "unchanged" },
    ]);
    const photos = (await pullAll(june)).photos.filter((p) => p.id === photoId);
    expect(photos[0]?.deletedAt).not.toBeNull();
  });

  it("keeps the photos of recipes in Trash, and removes those of recipes deleted for good", async () => {
    const june = await premiumPerson();
    const recipeId = id();
    const hash = await uploadWithThumb(june);
    await push(june, [newRecipe(recipeId), addPhoto(recipeId, hash)]);
    await push(june, [
      { kind: "recipe", id: recipeId, fields: {}, deleted: true, changedAt: Date.now() },
    ]);
    await age(june, hash, UNUSED_DAYS + 1);
    await markUnusedImages(db());
    expect((await row(june, hash))?.deletedAt).toBeNull();

    expect((await june.v.request("/api/trash/empty", { body: {} })).status).toBe(200);
    await age(june, hash, UNUSED_DAYS + 1);
    await markUnusedImages(db());
    expect((await row(june, hash))?.deletedAt).not.toBeNull();
  });

  it("can't be added again while their stored copy is being deleted, then can", async () => {
    const june = await premiumPerson();
    const bytes = jpeg();
    const hash = await uploadWithThumb(june, bytes);
    await age(june, hash, UNUSED_DAYS + 1);
    await markUnusedImages(db());
    // The housekeeping job has claimed it: the same photo waits.
    await db()
      .update(image)
      .set({ purgedAt: new Date() })
      .where(and(eq(image.ownerUserId, june.userId), eq(image.hash, hash)));
    const busy = await upload(june, bytes);
    expect(busy.status).toBe(503);
    expect(busy.body.error).toBe("storage_busy");

    // Once that's over, it's stored afresh, without the old small copy.
    await env.IMAGES.delete([`${june.userId}/${hash}`, `${june.userId}/${hash}.thumb`]);
    await db()
      .update(image)
      .set({ purgedAt: new Date(Date.now() - PURGE_WINDOW_MS - 1000) })
      .where(and(eq(image.ownerUserId, june.userId), eq(image.hash, hash)));
    const again = await upload(june, bytes);
    expect(again.status).toBe(201);
    expect(await row(june, hash)).toMatchObject({
      deletedAt: null,
      purgedAt: null,
      thumbBytes: null,
    });
    expect(await stored(june, hash)).toEqual([hash]);
  });
});

describe("checking photo rows against storage", () => {
  it("deletes left-over objects, corrects sizes and small copies, and reports lost photos", async () => {
    const june = await premiumPerson();
    const fine = await uploadWithThumb(june);
    const wrongSize = await uploadWithThumb(june);
    const lostThumb = await uploadWithThumb(june);
    const lost = await uploadWithThumb(june);
    await db()
      .update(image)
      .set({ bytes: 999 })
      .where(and(eq(image.ownerUserId, june.userId), eq(image.hash, wrongSize)));
    await env.IMAGES.delete(`${june.userId}/${lostThumb}.thumb`);
    await env.IMAGES.delete(`${june.userId}/${lost}`);
    const nobodys = `${june.userId}/${"a".repeat(64)}`;
    await env.IMAGES.put(nobodys, jpeg());
    await env.IMAGES.put("notes.txt", "hello");

    // An hour on, so nothing counts as half-uploaded.
    const report = await reconcileImages(db(), env.IMAGES, Date.now() + 2 * HOUR);
    expect(report.complete).toBe(true);
    expect(report.removed).toContain(nobodys);
    expect(report.unknown).toContain("notes.txt");
    expect(report.missing).toContain(`${june.userId}/${lost}`);
    expect(report.missing).not.toContain(`${june.userId}/${fine}`);
    expect(report.fixedSizes).toEqual([`${june.userId}/${wrongSize}`]);
    expect(report.fixedThumbs).toContain(`${june.userId}/${lostThumb}.thumb`);

    expect(await env.IMAGES.head(nobodys)).toBeNull();
    expect(await env.IMAGES.head("notes.txt")).not.toBeNull();
    expect((await row(june, wrongSize))?.bytes).toBe(64);
    expect((await row(june, lostThumb))?.thumbBytes).toBeNull();
    expect((await row(june, fine))?.thumbBytes).toBe(32);

    // Everything matches now.
    const again = await reconcileImages(db(), env.IMAGES, Date.now() + 2 * HOUR);
    expect(again.removed).toEqual([]);
    expect(again.fixedSizes).toEqual([]);
    expect(again.fixedThumbs).toEqual([]);
  });

  it("leaves anything from the last hour alone", async () => {
    const june = await premiumPerson();
    const hash = await uploadWithThumb(june);
    await env.IMAGES.delete(`${june.userId}/${hash}`);
    const fresh = `${june.userId}/${"b".repeat(64)}`;
    await env.IMAGES.put(fresh, jpeg());
    const report = await reconcileImages(db(), env.IMAGES);
    expect(report.missing).not.toContain(`${june.userId}/${hash}`);
    expect(report.removed).not.toContain(fresh);
  });
});

describe("the 90-day photo grace period", () => {
  it("decides the reminders", () => {
    expect(reminderDue(90, 90)).toBeNull();
    expect(reminderDue(31, 90)).toBeNull();
    expect(reminderDue(30, 90)).toBe(30);
    expect(reminderDue(30, 30)).toBeNull();
    expect(reminderDue(5, 30)).toBe(7);
    // A job that missed the 7-day reminder sends only the latest one due.
    expect(reminderDue(1, 30)).toBe(1);
    expect(reminderDue(1, 1)).toBeNull();
  });

  it("keeps photos for 90 days with reminders, ends when photos are allowed again, then deletes them", async () => {
    const june = await premiumPerson("June Park");
    const recipeId = id();
    const hash = await uploadWithThumb(june);
    const photoId = id();
    await push(june, [newRecipe(recipeId), addPhoto(recipeId, hash, photoId)]);
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => {
      sent.push(m);
    };
    const mine = () => sent.filter((m) => m.to.startsWith("june-"));
    const open = () =>
      db()
        .select()
        .from(photoGrace)
        .where(eq(photoGrace.userId, june.userId))
        .all()
        .then((rows) => rows.filter((r) => r.endedAt === null));

    // Premium: nothing happens.
    await photoGracePeriods(db(), send);
    expect(await open()).toEqual([]);

    // The code's Premium ends: the period starts, with a notice.
    await setPremium(june, false);
    const start = Date.now();
    await photoGracePeriods(db(), send, start);
    const [grace] = await open();
    expect(grace?.deleteAfter.getTime()).toBe(start + PHOTO_GRACE_DAYS * DAY);
    expect(mine().map((m) => m.subject)).toEqual([
      expect.stringMatching(/^Your Fennl photos are kept until /),
    ]);
    // Settings shows until when, and the photos are still there to see.
    const usage = (await pullAll(june)).usage.photos;
    expect(usage).toMatchObject({ enabled: false, count: 1 });
    expect(usage?.members[0]?.deleteAfter).toBe(start + PHOTO_GRACE_DAYS * DAY);
    expect((await june.v.request(`/api/images/${hash}`)).status).toBe(200);

    // Reminders at 30, 7 and 1 days left, each once.
    await photoGracePeriods(db(), send, start + 61 * DAY);
    await photoGracePeriods(db(), send, start + 61 * DAY + HOUR);
    await photoGracePeriods(db(), send, start + 84 * DAY);
    await photoGracePeriods(db(), send, start + 89.5 * DAY);
    expect(mine().map((m) => m.subject)).toEqual([
      expect.stringMatching(/kept until/),
      "Your Fennl photos will be deleted in 29 days",
      "Your Fennl photos will be deleted in 6 days",
      "Your Fennl photos will be deleted tomorrow",
    ]);

    // Premium again ends it; nothing is deleted.
    await setPremium(june, true);
    await photoGracePeriods(db(), send, start + 89.6 * DAY);
    expect(await open()).toEqual([]);
    await photoGracePeriods(db(), send, start + 91 * DAY);
    expect((await row(june, hash))?.deletedAt).toBeNull();

    // Without it again, a new 90 days; at the end the photos are deleted.
    await setPremium(june, false);
    const second = start + 91 * DAY;
    await photoGracePeriods(db(), send, second);
    expect((await open()).length).toBe(1);
    await photoGracePeriods(db(), send, second + 90 * DAY);
    expect(await open()).toEqual([]);
    expect((await row(june, hash))?.deletedAt).not.toBeNull();
    // Devices learn the photo is gone; the recipe stays.
    const pulled = await pullAll(june);
    expect(pulled.photos.find((p) => p.id === photoId)?.deletedAt).not.toBeNull();
    expect(pulled.usage.photos).toMatchObject({ count: 0 });
    expect(pulled.recipes.find((r) => r.id === recipeId)?.deletedAt).toBeNull();
    await purgeDeletedImages(db(), env.IMAGES);
    expect(await stored(june, hash)).toEqual([]);
  });

  it("leaves people without photos alone", async () => {
    const june = await person();
    const sent: EmailMessage[] = [];
    await photoGracePeriods(db(), async (m) => {
      sent.push(m);
    });
    expect(sent.filter((m) => m.to.startsWith("june-"))).toEqual([]);
    const rows = await db()
      .select()
      .from(photoGrace)
      .where(eq(photoGrace.userId, june.userId))
      .all();
    expect(rows).toEqual([]);
  });
});

describe("photo usage", () => {
  it("shows the household's total against its quota, and each member's share", async () => {
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
          createdAt: new Date(Date.now() + i),
        })),
      );
    await db()
      .update(session)
      .set({ activeOrganizationId: householdId })
      .where(inArray(session.userId, [a.userId, b.userId]));
    await premium(a);
    await upload(a, jpeg(100));
    await upload(a, jpeg(200));
    await upload(b, jpeg(50));
    const usage = (await pullAll(b)).usage.photos;
    expect(usage).toEqual({
      enabled: true,
      bytes: 350,
      count: 3,
      maxBytes: 10 * 1024 ** 3,
      maxCount: 30_000,
      members: [
        { userId: a.userId, name: "Ana Ruiz", bytes: 300, count: 2, deleteAfter: null },
        { userId: b.userId, name: "Ben Ruiz", bytes: 50, count: 1, deleteAfter: null },
      ],
    });
  });
});

describe("photos in the export", () => {
  it("puts each photo in the .zip once, shows it on the recipe's page, and can leave them out", async () => {
    const june = await premiumPerson();
    const first = id();
    const second = id();
    const coverBytes = jpeg(300);
    const cover = (await upload(june, coverBytes)).body.hash;
    const other = (await upload(june, jpeg(120))).body.hash;
    await push(june, [
      newRecipe(first, "Shakshuka"),
      newRecipe(second, "Stew"),
      addPhoto(first, cover, id(), 1),
      addPhoto(first, other, id(), 2),
      addPhoto(second, cover),
    ]);

    const res = await june.v.request("/api/export");
    expect(res.status).toBe(200);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const file = readExportFile(JSON.parse(strFromU8(files["fennl-recipes.json"]!)))!;
    expect(file.version).toBe(2);
    const shakshuka = file.recipes.find((r) => r.id === first)!;
    expect(shakshuka.photos).toEqual([
      { hash: cover, file: `photos/${cover}.jpg`, role: "photo", width: 800, height: 600 },
      { hash: other, file: `photos/${other}.jpg`, role: "photo", width: 800, height: 600 },
    ]);
    expect(
      Object.keys(files)
        .filter((f) => f.startsWith("photos/"))
        .sort(),
    ).toEqual([`photos/${cover}.jpg`, `photos/${other}.jpg`].sort());
    expect(files[`photos/${cover}.jpg`]).toEqual(coverBytes);
    const page = Object.entries(files).find(
      ([name]) => name.startsWith("recipes/shakshuka-") && name.endsWith(".html"),
    )![1];
    expect(strFromU8(page)).toContain(`<img src="../photos/${cover}.jpg" alt="Shakshuka"`);
    expect(strFromU8(page)).toContain(`alt="Shakshuka, photo 2"`);

    const small = await june.v.request("/api/export?photos=0");
    const without = unzipSync(new Uint8Array(await small.arrayBuffer()));
    expect(Object.keys(without).some((f) => f.startsWith("photos/"))).toBe(false);
    const data = readExportFile(JSON.parse(strFromU8(without["fennl-recipes.json"]!)))!;
    expect(data.recipes.find((r) => r.id === first)?.photos?.[0]).toMatchObject({
      hash: cover,
      file: null,
    });
  });
});
