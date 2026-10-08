import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent, type RecipeContent } from "../../shared/recipe";
import {
  SYNC_RULES,
  formatCursors,
  type ChangeResult,
  type Cursors,
  type PullResponse,
  type SyncChange,
} from "../../shared/sync";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { member, organization, recipe, session } from "../db/schema";
import { PASSWORD, setUpDatabase, signUpConfirmed, visitor, type Visitor } from "../test/visitor";

const db = () => database(env.DB);
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;
const id = () => crypto.randomUUID();
const MINUTE = 60 * 1000;

beforeAll(async () => {
  await setUpDatabase();
});

interface Person {
  v: Visitor;
  userId: string;
  deviceId: string;
  address: string;
}

async function registerDevice(v: Visitor) {
  const deviceId = id();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(await res.json()).toEqual({ status: "ok" });
  return deviceId;
}

/** Someone signed up, verified, on one registered browser. */
async function person(name = "June Lee"): Promise<Person> {
  const address = email(name.split(" ")[0]!.toLowerCase());
  const v = await signUpConfirmed(address, name);
  const userId = (await v.session())!.user.id;
  return { v, userId, deviceId: await registerDevice(v), address };
}

/** The same person in another browser. */
async function anotherDevice(p: Person): Promise<Person> {
  const v = visitor();
  const res = await v.request("/api/auth/sign-in/email", {
    body: { email: p.address, password: PASSWORD },
  });
  expect(res.status).toBe(200);
  return { ...p, v, deviceId: await registerDevice(v) };
}

let codes = 0;
/** Premium from a code, as beta testers have it. */
async function premium(p: Person) {
  const code = await createCode(
    db(),
    {
      code: `SYNC-${++codes}`,
      label: "Sync tests",
      tier: "household",
      access: { forever: true },
      allowsSignUp: true,
      maxUses: null,
      redeemBy: null,
    },
    null,
  );
  const res = await p.v.request("/api/codes/redeem", { body: { code: code.code } });
  expect(res.status).toBe(200);
}

/** Two people sharing one household (phase G1 builds joining; here it's set up directly). */
async function share(a: Person, b: Person) {
  const householdId = id();
  await db()
    .insert(organization)
    .values({
      id: householdId,
      name: "Shared kitchen",
      slug: `shared-${householdId}`,
      createdAt: new Date(),
    });
  await db()
    .insert(member)
    .values(
      [a, b].map((p) => ({
        id: id(),
        organizationId: householdId,
        userId: p.userId,
        role: p === a ? "owner" : "member",
        createdAt: new Date(),
      })),
    );
  await db()
    .update(session)
    .set({ activeOrganizationId: householdId })
    .where(inArray(session.userId, [a.userId, b.userId]));
}

async function push(
  p: Person,
  changes: unknown[],
  options: { sentAt?: number; deviceId?: string; schemaVersion?: number } = {},
) {
  const res = await p.v.request("/api/sync/push", {
    body: {
      deviceId: options.deviceId ?? p.deviceId,
      schemaVersion: options.schemaVersion ?? RECIPE_SCHEMA_VERSION,
      sentAt: options.sentAt ?? Date.now(),
      changes,
    },
  });
  return {
    status: res.status,
    body: (await res.json()) as { results: ChangeResult[]; error?: string },
  };
}

async function pull(p: Person, cursors: Cursors = {}, options: { deviceId?: string } = {}) {
  const query = new URLSearchParams({
    deviceId: options.deviceId ?? p.deviceId,
    schemaVersion: String(RECIPE_SCHEMA_VERSION),
    since: formatCursors(cursors),
  });
  const res = await p.v.request(`/api/sync/pull?${query.toString()}`);
  return { status: res.status, body: (await res.json()) as PullResponse & { error?: string } };
}

/** Pulls page after page until nothing more is waiting. */
async function pullAll(p: Person, cursors: Cursors = {}) {
  const all: PullResponse[] = [];
  let since = cursors;
  for (let i = 0; i < 20; i++) {
    const { status, body } = await pull(p, since);
    expect(status).toBe(200);
    all.push(body);
    since = body.cursors;
    if (!body.more) break;
  }
  return { pages: all, cursors: since, recipes: all.flatMap((page) => page.recipes) };
}

function content(title: string): RecipeContent {
  return {
    ...emptyRecipeContent(),
    title,
    ingredients: [{ id: id(), text: "1 cup flour", heading: false }],
    directions: [{ id: id(), text: "Mix.", heading: false }],
  };
}

function create(recipeId: string, title: string, changedAt = Date.now()): SyncChange {
  return {
    kind: "recipe",
    id: recipeId,
    create: { createdAt: new Date().toISOString(), import: null },
    fields: content(title),
    changedAt,
  };
}

function edit(
  recipeId: string,
  fields: Partial<RecipeContent>,
  changedAt = Date.now(),
): SyncChange {
  return { kind: "recipe", id: recipeId, fields, changedAt };
}

const applied: ChangeResult = { status: "applied" };
const unchanged: ChangeResult = { status: "unchanged" };
const notFound: ChangeResult = { status: "rejected", reason: "not_found" };

async function stored(recipeId: string) {
  return db().select().from(recipe).where(eq(recipe.id, recipeId)).get();
}

describe("who may sync", () => {
  it("needs a signed-in person on a registered, active browser", async () => {
    const outsider = { v: visitor(), userId: "", deviceId: id(), address: "" };
    expect((await push(outsider, [])).status).toBe(401);
    expect((await pull(outsider)).status).toBe(401);

    const june = await person();
    expect((await push(june, [], { deviceId: id() })).body).toEqual({
      error: "device_not_registered",
    });
    expect((await pull(june, {}, { deviceId: id() })).body).toEqual({
      error: "device_not_registered",
    });
    expect((await push(june, [], { deviceId: "nope" })).body).toEqual({ error: "invalid_request" });
  });

  it("refuses a browser that was replaced", async () => {
    const june = await person();
    // The same browser comes back under a new ID (its storage was cleared): the old one is retired.
    const fresh = await registerDevice(june.v);
    const old = await push(june, [create(id(), "Soup")]);
    expect(old).toEqual({ status: 403, body: { error: "device_revoked" } });
    expect((await pull(june)).body).toEqual({ error: "device_revoked" });
    expect((await push(june, [create(id(), "Soup")], { deviceId: fresh })).status).toBe(200);
  });

  it("asks an old app to reload, and a too-new one to wait", async () => {
    const june = await person();
    expect(await push(june, [], { schemaVersion: 0 })).toEqual({
      status: 409,
      body: { error: "upgrade_required" },
    });
    expect(await push(june, [], { schemaVersion: RECIPE_SCHEMA_VERSION + 1 })).toEqual({
      status: 409,
      body: { error: "server_behind" },
    });
  });

  it("turns away malformed requests and oversized pushes", async () => {
    const june = await person();
    const res = await june.v.request("/api/sync/push", { body: { changes: "all of them" } });
    expect(res.status).toBe(400);
    const many = Array.from({ length: SYNC_RULES.changesPerPush + 1 }, () => create(id(), "x"));
    expect(await push(june, many)).toEqual({
      status: 413,
      body: { error: "too_many_changes", max: SYNC_RULES.changesPerPush },
    });
    const bad = await june.v.request(
      `/api/sync/pull?deviceId=${june.deviceId}&schemaVersion=1&since=not:a:cursor`,
    );
    expect(bad.status).toBe(400);
  });
});

describe("saving and fetching recipes", () => {
  it("creates a recipe owned by its creator, and hands it out once", async () => {
    const june = await person();
    const recipeId = id();
    expect((await push(june, [create(recipeId, "Green chile stew")])).body).toMatchObject({
      results: [applied],
    });

    const first = await pull(june);
    expect(first.body.members).toEqual([{ userId: june.userId, name: "June Lee" }]);
    expect(first.body.recipes).toHaveLength(1);
    expect(first.body.recipes[0]).toMatchObject({
      id: recipeId,
      ownerUserId: june.userId,
      updatedByUserId: june.userId,
      title: "Green chile stew",
      ingredients: [{ text: "1 cup flour", heading: false }],
      deletedAt: null,
    });
    expect(first.body.more).toBe(false);
    const cursor = first.body.cursors[june.userId]!;
    expect(cursor).toBe(first.body.recipes[0]!.serverSeq);

    const again = await pull(june, first.body.cursors);
    expect(again.body.recipes).toEqual([]);
    expect(again.body.cursors).toEqual(first.body.cursors);
  });

  it("checks each change, keeping the good ones in the same push", async () => {
    const june = await person();
    const good = id();
    const { body } = await push(june, [
      create(good, "Posole"),
      { ...create(id(), ""), changedAt: Date.now() },
      edit(id(), { title: "Nobody's" }),
      { kind: "recipe", id: good, fields: { servings: { count: -2, yield: null } }, changedAt: 5 },
      { kind: "mystery" },
    ]);
    expect(body.results).toEqual([
      applied,
      {
        status: "rejected",
        reason: "invalid",
        issues: [{ path: "fields.title", problem: "missing" }],
      },
      notFound,
      {
        status: "rejected",
        reason: "invalid",
        issues: [{ path: "fields.servings.count", problem: "invalid" }],
      },
      { status: "rejected", reason: "invalid", issues: [{ path: "kind", problem: "invalid" }] },
    ]);
  });

  it("keeps the later change field by field, and a repeated push changes nothing", async () => {
    const june = await person();
    await premium(june);
    const laptop = june;
    const phone = await anotherDevice(june);
    const recipeId = id();
    const t = Date.now() - 60_000;
    await push(laptop, [create(recipeId, "Carnitas", t)]);

    // The phone, offline, changed the title and notes a little later; the laptop changed the
    // title later still, and the servings.
    const phoneEdit = edit(
      recipeId,
      { title: "Carnitas (phone)", notes: "Use pork shoulder." },
      t + 10_000,
    );
    const laptopEdit = edit(
      recipeId,
      { title: "Slow carnitas", servings: { count: 6, yield: null } },
      t + 20_000,
    );
    expect((await push(laptop, [laptopEdit])).body.results).toEqual([applied]);
    expect((await push(phone, [phoneEdit])).body.results).toEqual([applied]);

    const row = await stored(recipeId);
    expect(row).toMatchObject({ title: "Slow carnitas", notes: "Use pork shoulder." });
    expect(JSON.parse(row!.servings)).toEqual({ count: 6, yield: null });

    // An older change to only the title is not kept at all.
    expect((await push(phone, [edit(recipeId, { title: "Old" }, t + 5_000)])).body.results).toEqual(
      [unchanged],
    );
    // Sending the same push again (say, the answer was lost) changes nothing.
    const seq = (await stored(recipeId))!.serverSeq;
    expect((await push(laptop, [laptopEdit])).body.results).toEqual([unchanged]);
    expect((await stored(recipeId))!.serverSeq).toBe(seq);
  });

  it("corrects for a device whose clock is wrong", async () => {
    const june = await person();
    await premium(june);
    const slow = await anotherDevice(june);
    const recipeId = id();
    await push(june, [create(recipeId, "Tamales")]);
    await push(june, [edit(recipeId, { title: "Pork tamales" })]);
    // This device's clock is an hour behind: its edit, made just now, looks an hour old.
    const hourAgo = Date.now() - 60 * MINUTE;
    const res = await push(slow, [edit(recipeId, { title: "Red pork tamales" }, hourAgo)], {
      sentAt: hourAgo,
    });
    expect(res.body.results).toEqual([applied]);
    expect((await stored(recipeId))!.title).toBe("Red pork tamales");

    // A clock in the future can't make a change win forever: times are never later than now.
    const ahead = Date.now() + 365 * 24 * 60 * MINUTE;
    await push(slow, [edit(recipeId, { notes: "From the future" }, ahead)]);
    await push(june, [edit(recipeId, { notes: "Later, for real" })]);
    expect((await stored(recipeId))!.notes).toBe("Later, for real");
  });

  it("moves a recipe to Trash and back, and other devices learn of both", async () => {
    const june = await person();
    const recipeId = id();
    await push(june, [create(recipeId, "Flan")]);
    const before = (await pull(june)).body.cursors;

    expect((await push(june, [{ ...edit(recipeId, {}), deleted: true }])).body.results).toEqual([
      applied,
    ]);
    const trashed = await pull(june, before);
    expect(trashed.body.recipes).toHaveLength(1);
    expect(trashed.body.recipes[0]!.deletedAt).not.toBeNull();
    expect(trashed.body.recipes[0]!.title).toBe("Flan");

    await push(june, [{ ...edit(recipeId, {}), deleted: false }]);
    const restored = await pull(june, trashed.body.cursors);
    expect(restored.body.recipes[0]!.deletedAt).toBeNull();
  });

  it("free accounts can't send a queue of offline changes; Premium can", async () => {
    const june = await person();
    const recipeId = id();
    const old = Date.now() - 10 * MINUTE;
    // Made ten minutes before sending, by the device's own clock.
    expect(await push(june, [create(recipeId, "Mole", old)])).toEqual({
      status: 403,
      body: { error: "offline_not_allowed" },
    });
    expect((await push(june, [create(recipeId, "Mole")])).body.results).toEqual([applied]);

    await premium(june);
    expect(
      (await push(june, [edit(recipeId, { notes: "Offline note" }, old)])).body.results,
    ).toEqual(
      [unchanged], // older than the creation, so not kept; but accepted
    );
  });
});

describe("other households", () => {
  it("can't see, change or claim someone else's recipes", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    const recipeId = id();
    await push(june, [create(recipeId, "June's enchiladas")]);

    const { body } = await push(sam, [
      edit(recipeId, { title: "Mine now" }),
      create(recipeId, "Mine now"),
      { kind: "opinion", recipeId, fields: { rating: 1 }, changedAt: Date.now() },
      { kind: "made", id: id(), recipeId, madeOn: "2026-10-07", changedAt: Date.now() },
      { ...edit(recipeId, {}), deleted: true },
    ]);
    expect(body.results).toEqual([notFound, notFound, notFound, notFound, notFound]);
    expect(await stored(recipeId)).toMatchObject({ title: "June's enchiladas", deletedAt: null });

    // Asking for June's changes by her ID gets nothing.
    const peek = await pull(sam, { [june.userId]: 0 });
    expect(peek.body.recipes).toEqual([]);
    expect(peek.body.members.map((m) => m.userId)).toEqual([sam.userId]);
    expect(peek.body.cursors).toEqual({ [sam.userId]: 0 });
  });
});

describe("a shared household", () => {
  it("lets either partner edit; the owner stays, and each pulls both libraries", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    const junes = id();
    await push(june, [create(junes, "Chiles rellenos")]);
    await share(june, sam);

    // Sam joins: he has no cursor for June yet, so he gets her library from the start.
    const first = await pullAll(sam);
    expect(first.pages[0]!.members).toEqual([
      { userId: sam.userId, name: "Sam Park" },
      { userId: june.userId, name: "June Lee" },
    ]);
    expect(first.recipes.map((r) => r.id)).toEqual([junes]);

    expect((await push(sam, [edit(junes, { notes: "Less cheese." })])).body.results).toEqual([
      applied,
    ]);
    const row = await stored(junes);
    expect(row).toMatchObject({ ownerUserId: june.userId, updatedByUserId: sam.userId });

    const sams = id();
    await push(sam, [create(sams, "Sopaipillas")]);
    const later = await pullAll(june, { [june.userId]: 0 });
    expect(later.recipes.map((r) => [r.id, r.ownerUserId]).sort()).toEqual(
      [
        [junes, june.userId],
        [sams, sam.userId],
      ].sort(),
    );
  });

  it("keeps each person's rating, favorite and note apart", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    await share(june, sam);
    const recipeId = id();
    await push(june, [create(recipeId, "Elote")]);
    const opinion = (fields: object) => ({
      kind: "opinion",
      recipeId,
      fields,
      changedAt: Date.now(),
    });
    expect((await push(june, [opinion({ rating: 4, favorite: true })])).body.results).toEqual([
      applied,
    ]);
    expect((await push(sam, [opinion({ rating: 3, note: "Needs lime." })])).body.results).toEqual([
      applied,
    ]);
    expect((await push(june, [opinion({ note: "Grill it." })])).body.results).toEqual([applied]);
    expect((await push(sam, [opinion({ rating: 9 })])).body.results[0]).toMatchObject({
      reason: "invalid",
    });

    const { opinions } = (await pullAll(june)).pages.reduce(
      (all, page) => ({ opinions: [...all.opinions, ...page.opinions] }),
      { opinions: [] as PullResponse["opinions"] },
    );
    const byPerson = Object.fromEntries(opinions.map((o) => [o.userId, o]));
    expect(byPerson[june.userId]).toMatchObject({ rating: 4, favorite: true, note: "Grill it." });
    expect(byPerson[sam.userId]).toMatchObject({ rating: 3, favorite: false, note: "Needs lime." });
  });

  it("files recipes only under the recipe owner's categories", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    await share(june, sam);
    const recipeId = id();
    await push(june, [create(recipeId, "Pozole verde")]);
    const now = Date.now();
    const samsSoups = id();
    const junesSoups = id();
    const junesMexican = id();
    const { body } = await push(sam, [
      // Sam's own category: fine, but not for June's recipe.
      {
        kind: "category",
        id: samsSoups,
        create: {},
        fields: { name: "Soups", parentId: null, sortOrder: 0 },
        changedAt: now,
      },
      { kind: "recipeCategory", recipeId, categoryId: samsSoups, deleted: false, changedAt: now },
      // Sam files June's recipe: the category is made as June's.
      {
        kind: "category",
        id: junesMexican,
        create: { ownerUserId: june.userId },
        fields: { name: "Mexican", parentId: null, sortOrder: 0 },
        changedAt: now,
      },
      {
        kind: "category",
        id: junesSoups,
        create: { ownerUserId: june.userId },
        fields: { name: "Soups", parentId: junesMexican, sortOrder: 0 },
        changedAt: now,
      },
      { kind: "recipeCategory", recipeId, categoryId: junesSoups, deleted: false, changedAt: now },
      // A child of someone else's category is refused.
      {
        kind: "category",
        id: id(),
        create: {},
        fields: { name: "Stews", parentId: junesSoups, sortOrder: 1 },
        changedAt: now,
      },
    ]);
    expect(body.results).toEqual([
      applied,
      { status: "rejected", reason: "wrong_owner" },
      applied,
      applied,
      applied,
      { status: "rejected", reason: "wrong_owner" },
    ]);

    const { pages } = await pullAll(june);
    const categories = pages.flatMap((p) => p.categories);
    const links = pages.flatMap((p) => p.recipeCategories);
    expect(categories.find((c) => c.id === junesSoups)).toMatchObject({
      ownerUserId: june.userId,
      parentId: junesMexican,
    });
    expect(links).toEqual([
      expect.objectContaining({ recipeId, categoryId: junesSoups, deletedAt: null }),
    ]);

    // Taking it out of the category is a change other devices see.
    await push(sam, [
      {
        kind: "recipeCategory",
        recipeId,
        categoryId: junesSoups,
        deleted: true,
        changedAt: Date.now(),
      },
    ]);
    const after = (await pullAll(june)).pages.flatMap((p) => p.recipeCategories);
    expect(after[0]!.deletedAt).not.toBeNull();
  });

  it("records who made it, and lets it be taken back", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    await share(june, sam);
    const recipeId = id();
    await push(june, [create(recipeId, "Birria")]);
    const madeId = id();
    const made = {
      kind: "made",
      id: madeId,
      recipeId,
      madeOn: "2026-10-03",
      changedAt: Date.now(),
    };
    expect((await push(sam, [made])).body.results).toEqual([applied]);
    expect((await push(sam, [made])).body.results).toEqual([unchanged]);
    expect((await push(sam, [{ ...made, madeOn: "Tuesday" }])).body.results[0]).toMatchObject({
      reason: "invalid",
    });
    let rows = (await pullAll(june)).pages.flatMap((p) => p.made);
    expect(rows).toEqual([
      expect.objectContaining({
        id: madeId,
        userId: sam.userId,
        madeOn: "2026-10-03",
        deletedAt: null,
      }),
    ]);
    expect((await push(june, [{ ...made, deleted: true }])).body.results).toEqual([applied]);
    rows = (await pullAll(june)).pages.flatMap((p) => p.made);
    expect(rows[0]!.deletedAt).not.toBeNull();
  });
});

describe("large libraries", () => {
  it("takes pushes of many recipes and hands them out in pages", async () => {
    const june = await person();
    await premium(june);
    const ids: string[] = [];
    for (const size of [100, 100, 50]) {
      const changes = Array.from({ length: size }, (_, i) => {
        const recipeId = id();
        ids.push(recipeId);
        return create(recipeId, `Recipe ${ids.length + i}`);
      });
      const { body } = await push(june, changes);
      expect(body.results.every((r) => r.status === "applied")).toBe(true);
    }
    const { pages, recipes } = await pullAll(june);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.slice(0, -1).every((p) => p.more)).toBe(true);
    expect(recipes.map((r) => r.id).sort()).toEqual([...ids].sort());
    // In order, each once.
    const seqs = recipes.map((r) => r.serverSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe("Trash, and deleting for good (phase C9)", () => {
  async function inTrash(p: Person, title: string, deletedAgo = 0) {
    const recipeId = id();
    expect((await push(p, [create(recipeId, title)])).body.results).toEqual([applied]);
    const opinion = {
      kind: "opinion",
      recipeId,
      fields: { rating: 5, note: "Grandma's" },
      changedAt: Date.now(),
    };
    expect((await push(p, [opinion])).body.results).toEqual([applied]);
    const trash = {
      kind: "recipe",
      id: recipeId,
      fields: {},
      deleted: true,
      changedAt: Date.now(),
    };
    expect((await push(p, [trash])).body.results).toEqual([applied]);
    if (deletedAgo) {
      await db()
        .update(recipe)
        .set({ deletedAt: new Date(Date.now() - deletedAgo) })
        .where(eq(recipe.id, recipeId));
    }
    return recipeId;
  }

  it("empties the household's Trash: content wiped, devices told, no coming back", async () => {
    const june = await person();
    await premium(june);
    const phone = await anotherDevice(june);
    const { cursors } = await pullAll(phone);
    const gone = await inTrash(june, "Old fruitcake");
    const kept = id();
    expect((await push(june, [create(kept, "Pozole")])).body.results).toEqual([applied]);

    const res = await june.v.request("/api/trash/empty", { body: {} });
    expect(await res.json()).toEqual({ expunged: 1 });
    const row = await stored(gone);
    expect(row).toMatchObject({ title: "", ingredients: "[]", notes: "" });
    expect(row?.expungedAt).toBeInstanceOf(Date);
    expect((await stored(kept))?.title).toBe("Pozole");

    // The other device learns it's gone, with nothing of its content.
    const later = await pullAll(phone, cursors);
    const tombstone = later.recipes.find((r) => r.id === gone);
    expect(tombstone).toMatchObject({ title: "", expungedAt: expect.any(String) });
    // Its rating and note were wiped too (a device that fetches them now gets nothing of them).
    for (const opinion of later.pages.flatMap((p) => p.opinions)) {
      if (opinion.recipeId === gone) expect(opinion).toMatchObject({ note: "", rating: null });
    }

    // Restoring or rating it now changes nothing.
    const restore = { kind: "recipe", id: gone, fields: {}, deleted: false, changedAt: Date.now() };
    expect((await push(phone, [restore])).body.results).toEqual([unchanged]);
    const rate = { kind: "opinion", recipeId: gone, fields: { rating: 4 }, changedAt: Date.now() };
    expect((await push(phone, [rate])).body.results).toEqual([unchanged]);
    expect((await stored(gone))?.deletedAt).toBeInstanceOf(Date);
  });

  it("empties only the recipes named, and never someone else's", async () => {
    const june = await person();
    const sam = await person("Sam Ortiz");
    const a = await inTrash(june, "A");
    const b = await inTrash(june, "B");
    const theirs = await inTrash(sam, "Sam's");

    const res = await june.v.request("/api/trash/empty", { body: { recipeIds: [a, theirs] } });
    expect(await res.json()).toEqual({ expunged: 1 });
    expect((await stored(a))?.expungedAt).toBeInstanceOf(Date);
    expect((await stored(b))?.expungedAt).toBeNull();
    expect((await stored(theirs))?.expungedAt).toBeNull();
    const bad = await june.v.request("/api/trash/empty", { body: { recipeIds: ["nope"] } });
    expect(bad.status).toBe(400);
  });

  it("deletes for good, hourly, what's been in Trash more than 30 days", async () => {
    const june = await person();
    const DAY = 24 * 60 * MINUTE;
    const old = await inTrash(june, "Thirty-one days", 31 * DAY);
    const recent = await inTrash(june, "Twenty-nine days", 29 * DAY);
    const { expungeOldTrash } = await import("./trash");
    expect(await expungeOldTrash(db())).toBeGreaterThanOrEqual(1);
    expect((await stored(old))?.expungedAt).toBeInstanceOf(Date);
    expect((await stored(recent))?.expungedAt).toBeNull();
    expect((await stored(recent))?.title).toBe("Twenty-nine days");
  });
});
