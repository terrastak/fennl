import { env } from "cloudflare:test";
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  MAX_DRAFTS,
  MAX_DRAFT_BYTES,
  emptyDraftData,
  type DraftData,
  type DraftPutResponse,
  type DraftsResponse,
} from "../../shared/drafts";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent, type RecipeContent } from "../../shared/recipe";
import type { ChangeResult, SyncChange } from "../../shared/sync";
import { database } from "../db/client";
import {
  limitOverride,
  member,
  organization,
  recipe,
  recipeDraft,
  session,
  user,
} from "../db/schema";
import {
  householdOf,
  setUpDatabase,
  signUpConfirmed,
  visitor,
  type Visitor,
} from "../test/visitor";
import { STALE_DRAFTS } from "./routes";

// U27 part 3: drafts kept with the account until Done or Discard.

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
  const v = await signUpConfirmed(`drafts-${++counter}@example.com`, name);
  const userId = (await v.session())!.user.id;
  const deviceId = id();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(res.status).toBe(200);
  return { v, userId, deviceId };
}

/** Two people sharing one household (phase G1 builds joining; here it's set up directly). */
async function share(a: Person, b: Person) {
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
  return householdId;
}

async function push(p: Person, changes: SyncChange[], sentAt = Date.now()) {
  const res = await p.v.request("/api/sync/push", {
    body: { deviceId: p.deviceId, schemaVersion: RECIPE_SCHEMA_VERSION, sentAt, changes },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: ChangeResult[] }).results;
}

function content(title: string): RecipeContent {
  return {
    ...emptyRecipeContent(),
    title,
    ingredients: [{ id: id(), text: "1 cup flour", heading: false }],
  };
}

async function newRecipe(p: Person, title = "Lemon Bars") {
  const recipeId = id();
  const [result] = await push(p, [
    {
      kind: "recipe",
      id: recipeId,
      create: { createdAt: new Date().toISOString(), import: null },
      fields: content(title),
      changedAt: Date.now(),
    },
  ]);
  expect(result).toEqual({ status: "applied" });
  return recipeId;
}

const draftOf = (title: string): DraftData => ({
  ...emptyDraftData(),
  fields: { title },
  base: { title: "Lemon Bars" },
});

interface Answer<T> {
  status: number;
  body: T & { error?: string };
}

async function put(
  p: Person,
  recipeId: string,
  draft: unknown,
  times: { startedAt?: number; editedAt?: number; sentAt?: number } = {},
): Promise<Answer<DraftPutResponse>> {
  const now = Date.now();
  const res = await p.v.request(`/api/drafts/${recipeId}`, {
    method: "PUT",
    body: {
      draft,
      startedAt: times.startedAt ?? now - 1000,
      editedAt: times.editedAt ?? now,
      sentAt: times.sentAt ?? now,
    },
  });
  return { status: res.status, body: (await res.json()) as Answer<DraftPutResponse>["body"] };
}

async function list(p: Person, since?: number): Promise<DraftsResponse> {
  const res = await p.v.request(`/api/drafts${since === undefined ? "" : `?since=${since}`}`);
  expect(res.status).toBe(200);
  return (await res.json()) as DraftsResponse;
}

async function remove(p: Person, recipeId: string, editedAt?: string | number) {
  const query = editedAt === undefined ? "" : `?editedAt=${encodeURIComponent(String(editedAt))}`;
  const res = await p.v.request(`/api/drafts/${recipeId}${query}`, { method: "DELETE" });
  return { status: res.status, body: (await res.json()) as { removed?: boolean; error?: string } };
}

/** A limit exception for the person's household (as the admin console sets one). */
async function limit(p: Person, key: string, value: number) {
  await db()
    .insert(limitOverride)
    .values({
      id: id(),
      householdId: await householdOf(p.v),
      key,
      value,
      createdAt: new Date(),
    });
}

const storedDrafts = (recipeId: string) =>
  db().select().from(recipeDraft).where(eq(recipeDraft.recipeId, recipeId)).all();

describe("who may", () => {
  it("needs a signed-in person, and a recipe id", async () => {
    const outsider = visitor();
    expect((await outsider.request("/api/drafts")).status).toBe(401);
    expect(
      (await outsider.request(`/api/drafts/${id()}`, { method: "PUT", body: {} })).status,
    ).toBe(401);
    expect((await outsider.request(`/api/drafts/${id()}`, { method: "DELETE" })).status).toBe(401);

    const june = await person();
    expect((await put(june, "nope", draftOf("x"))).status).toBe(400);
    expect((await remove(june, "nope")).status).toBe(400);
    expect((await june.v.request("/api/drafts?since=abc")).status).toBe(400);
  });
});

describe("keeping a draft", () => {
  it("keeps a new recipe's draft as the person's own", async () => {
    const june = await person();
    const recipeId = id();
    const data: DraftData = { ...emptyDraftData(), fields: content("Soup") };
    const { status, body } = await put(june, recipeId, data);
    expect(status).toBe(200);
    expect(body.kept).toBe(true);
    expect(body.draft).toMatchObject({ recipeId, ownerUserId: june.userId, isNew: true, data });

    const all = await list(june);
    expect(all.drafts).toEqual([body.draft]);
    expect(all.ids).toEqual([{ recipeId, editedAt: body.draft.editedAt }]);
    expect(all.more).toBe(false);
  });

  it("keeps a saved recipe's draft, and replaces it with a newer edit", async () => {
    const june = await person();
    const recipeId = await newRecipe(june);
    const first = await put(june, recipeId, draftOf("Lemon Squares"));
    expect(first.body.draft).toMatchObject({ ownerUserId: june.userId, isNew: false });
    const second = await put(june, recipeId, draftOf("Lemon Slices"), {
      editedAt: Date.now() + 5,
      sentAt: Date.now() + 5,
    });
    expect(second.body.kept).toBe(true);
    expect(second.body.draft.data.fields.title).toBe("Lemon Slices");
    // Started when the draft first began.
    expect(second.body.draft.startedAt).toBe(first.body.draft.startedAt);
    expect(await storedDrafts(recipeId)).toHaveLength(1);
  });

  it("never lets an older edit replace a newer one", async () => {
    const june = await person();
    const laptop = { ...june };
    const recipeId = await newRecipe(june);
    const now = Date.now();
    const newer = await put(june, recipeId, draftOf("Newer"), { editedAt: now, sentAt: now });
    // A device that was offline sends an edit made a minute earlier.
    const older = await put(laptop, recipeId, draftOf("Older"), {
      editedAt: now - 60_000,
      sentAt: now,
    });
    expect(older.status).toBe(200);
    expect(older.body).toEqual({ draft: newer.body.draft, kept: false });
    expect((await list(june)).drafts[0]?.data.fields.title).toBe("Newer");
  });

  it("moves the device's times onto the server's clock", async () => {
    const june = await person();
    const recipeId = id();
    const hourAhead = Date.now() + 60 * 60_000;
    const before = Date.now();
    const { body } = await put(june, recipeId, draftOf("x"), {
      startedAt: hourAhead - 600_000,
      editedAt: hourAhead - 5_000,
      sentAt: hourAhead,
    });
    const edited = Date.parse(body.draft.editedAt);
    expect(edited).toBeGreaterThanOrEqual(before - 5_000);
    expect(edited).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(body.draft.startedAt)).toBeLessThan(edited - 500_000);
  });

  it("turns away a draft of the wrong shape, too big, or one too many", async () => {
    const june = await person();
    expect((await put(june, id(), { fields: { title: 5 } })).body.error).toBe("invalid_draft");
    expect((await put(june, id(), draftOf("x"), { editedAt: -1 })).body.error).toBe(
      "invalid_request",
    );
    const lines = Array.from({ length: 1000 }, () => ({
      id: id(),
      text: "y".repeat(1000),
      heading: false,
    }));
    const huge = { ...emptyDraftData(), fields: { ingredients: lines } };
    expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_DRAFT_BYTES);
    const tooBig = await put(june, id(), huge);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toBe("too_large");

    // At the cap, a new draft is turned away; the ones already there can still change.
    await limit(june, "max_recipes", 10_000);
    const now = new Date();
    const rows = Array.from({ length: MAX_DRAFTS }, () => ({
      userId: june.userId,
      recipeId: id(),
      ownerUserId: june.userId,
      isNew: true,
      content: JSON.stringify(emptyDraftData()),
      startedAt: now,
      editedAt: now,
      updatedAt: now,
      serverSeq: 0,
    }));
    for (let i = 0; i < rows.length; i += 10) {
      await db()
        .insert(recipeDraft)
        .values(rows.slice(i, i + 10));
    }
    const full = await put(june, id(), draftOf("one more"));
    expect(full.status).toBe(409);
    expect(full.body.error).toBe("too_many");
    const [one] = await db()
      .select()
      .from(recipeDraft)
      .where(eq(recipeDraft.userId, june.userId))
      .limit(1)
      .all();
    expect((await put(june, one!.recipeId, draftOf("changed"))).body.kept).toBe(true);
  });
});

describe("the plan's limits", () => {
  it("bounds a draft by the plan's per-recipe size", async () => {
    const june = await person();
    await limit(june, "max_recipe_bytes", 1000);
    const words = (n: number) => ({ ...emptyDraftData(), fields: { notes: "x".repeat(n) } });
    expect((await put(june, id(), words(1500))).status).toBe(200);
    const big = await put(june, id(), words(2500));
    expect(big.status).toBe(413);
    expect(big.body.error).toBe("too_large");
  });

  it("bounds new recipes' drafts by the plan's recipes and text; a saved one's never counts", async () => {
    const june = await person();
    await limit(june, "max_recipes", 1);
    const saved = await newRecipe(june);
    // At the plan's one recipe already: a new recipe's draft is still kept (Done says why it
    // waits), but not a second.
    const first = id();
    expect((await put(june, first, draftOf("New one"))).status).toBe(200);
    const refused = await put(june, id(), draftOf("Another"));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("limit");
    // The draft already there can change, and a saved recipe's draft never counts.
    expect((await put(june, first, draftOf("New one, changed"))).body.kept).toBe(true);
    expect((await put(june, saved, draftOf("Saved, changed"))).body.kept).toBe(true);

    const sam = await person("Sam Ortiz");
    await limit(sam, "max_text_bytes", 1000);
    const text = (n: number) => ({ ...emptyDraftData(), fields: { title: "t".repeat(n) } });
    expect((await put(sam, id(), text(400))).status).toBe(200);
    expect((await put(sam, id(), text(400))).body.error).toBe("limit");
  });
});

describe("who sees a draft", () => {
  it("is the person's own: a partner sees none of it", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    await share(june, sam);
    const recipeId = await newRecipe(june);
    await put(june, recipeId, draftOf("June's change"));
    await put(june, id(), { ...emptyDraftData(), fields: content("June's new one") });

    expect((await list(june)).drafts).toHaveLength(2);
    const samSees = await list(sam);
    expect(samSees.drafts).toEqual([]);
    expect(samSees.ids).toEqual([]);
    // The partner's own draft of the same recipe is separate.
    await put(sam, recipeId, draftOf("Sam's change"));
    expect((await list(sam)).drafts.map((d) => d.data.fields.title)).toEqual(["Sam's change"]);
    expect((await list(june)).drafts.map((d) => d.data.fields.title).sort()).toEqual([
      "June's change",
      "June's new one",
    ]);
  });

  it("allows a draft of a partner's recipe only while they share a household", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    const householdId = await share(june, sam);
    const recipeId = await newRecipe(june);
    const kept = await put(sam, recipeId, draftOf("Sam's change"));
    expect(kept.body.draft).toMatchObject({ ownerUserId: june.userId, isNew: false });

    // Sam leaves: the recipe isn't visible to Sam any more, so the draft goes.
    await db()
      .delete(member)
      .where(and(eq(member.userId, sam.userId), eq(member.organizationId, householdId)));
    expect((await put(sam, recipeId, draftOf("Again"))).status).toBe(404);
    expect((await list(sam)).drafts).toEqual([]);
    expect(await storedDrafts(recipeId)).toEqual([]);
  });

  it("hands out only what changed after the cursor", async () => {
    const june = await person();
    const a = id();
    const b = id();
    await put(june, a, draftOf("A"));
    const first = await list(june);
    expect(first.drafts).toHaveLength(1);
    await put(june, b, draftOf("B"));
    const next = await list(june, first.cursor);
    expect(next.drafts.map((d) => d.recipeId)).toEqual([b]);
    expect(next.ids.map((d) => d.recipeId).sort()).toEqual([a, b].sort());
    expect((await list(june, next.cursor)).drafts).toEqual([]);
  });
});

describe("removing a draft", () => {
  it("removes only the version the device saw", async () => {
    const june = await person();
    const recipeId = await newRecipe(june);
    const seen = (await put(june, recipeId, draftOf("Seen"))).body.draft;
    // Meanwhile another device writes a newer edit.
    const newer = (
      await put(june, recipeId, draftOf("Newer"), {
        editedAt: Date.now() + 10,
        sentAt: Date.now() + 10,
      })
    ).body.draft;
    expect(await remove(june, recipeId, seen.editedAt)).toEqual({
      status: 200,
      body: { ok: true, removed: false },
    });
    expect(await storedDrafts(recipeId)).toHaveLength(1);
    expect((await remove(june, recipeId, Date.parse(newer.editedAt))).body.removed).toBe(true);
    expect(await storedDrafts(recipeId)).toEqual([]);
    // Without a time, whatever its time.
    await put(june, recipeId, draftOf("Again"));
    expect((await remove(june, recipeId)).body.removed).toBe(true);
    expect((await remove(june, recipeId)).body.removed).toBe(false);
  });

  it("removes a version the device wrote but never heard back about, by the device's clock", async () => {
    const june = await person();
    const recipeId = await newRecipe(june);
    const slow = Date.now() - 60_000; // this device's clock is a minute slow
    const mine = slow - 10_000;
    await put(june, recipeId, draftOf("Mine"), { editedAt: mine, sentAt: slow });
    const removal = (at: number) =>
      june.v.request(`/api/drafts/${recipeId}?deviceEditedAt=${at}&sentAt=${Date.now() - 60_000}`, {
        method: "DELETE",
      });
    // Exactly its own version goes, whatever the time the request took.
    expect(await (await removal(mine)).json()).toEqual({ ok: true, removed: true });
    // A newer edit from another device stays.
    await put(june, recipeId, draftOf("Mine again"), { editedAt: mine, sentAt: slow });
    await put(june, recipeId, draftOf("Newer"), { editedAt: Date.now() });
    expect(await (await removal(mine)).json()).toEqual({ ok: true, removed: false });
    expect(await storedDrafts(recipeId)).toHaveLength(1);
  });

  it("doesn't remove another person's draft", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    await share(june, sam);
    const recipeId = await newRecipe(june);
    await put(sam, recipeId, draftOf("Sam's"));
    expect((await remove(june, recipeId)).body.removed).toBe(false);
    expect(await storedDrafts(recipeId)).toHaveLength(1);
  });

  it("goes for everyone when the recipe goes to Trash", async () => {
    const june = await person("June Lee");
    const sam = await person("Sam Park");
    await share(june, sam);
    const recipeId = await newRecipe(june);
    const other = await newRecipe(june, "Other");
    await put(june, recipeId, draftOf("June's"));
    await put(sam, recipeId, draftOf("Sam's"));
    await put(june, other, draftOf("Other change"));

    expect(
      await push(sam, [
        { kind: "recipe", id: recipeId, fields: {}, deleted: true, changedAt: Date.now() },
      ]),
    ).toEqual([{ status: "applied" }]);
    expect(await storedDrafts(recipeId)).toEqual([]);
    expect(await storedDrafts(other)).toHaveLength(1);

    // A draft can't be kept for a recipe in Trash.
    const refused = await put(june, recipeId, draftOf("Late"));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("in_trash");
    expect(await storedDrafts(recipeId)).toEqual([]);
  });

  it("stays when a move to Trash doesn't land", async () => {
    const june = await person();
    const recipeId = await newRecipe(june);
    const now = Date.now();
    await push(june, [{ kind: "recipe", id: recipeId, fields: {}, deleted: true, changedAt: now }]);
    await push(june, [
      { kind: "recipe", id: recipeId, fields: {}, deleted: false, changedAt: now + 1 },
    ]);
    await put(june, recipeId, draftOf("Kept"));
    // An older move to Trash arrives late: the later "put back" wins, and the draft stays.
    const late = Date.now() - 60_000;
    expect(
      await push(
        june,
        [{ kind: "recipe", id: recipeId, fields: {}, deleted: true, changedAt: late }],
        Date.now(),
      ),
    ).toEqual([{ status: "unchanged" }]);
    expect(await storedDrafts(recipeId)).toHaveLength(1);
  });

  it("goes when the recipe is deleted for good", async () => {
    const june = await person();
    const recipeId = await newRecipe(june);
    await push(june, [
      { kind: "recipe", id: recipeId, fields: {}, deleted: true, changedAt: Date.now() },
    ]);
    // Put there directly, as if it had come before Trash.
    const now = new Date();
    await db()
      .insert(recipeDraft)
      .values({
        userId: june.userId,
        recipeId,
        ownerUserId: june.userId,
        isNew: false,
        content: JSON.stringify(draftOf("x")),
        startedAt: now,
        editedAt: now,
        updatedAt: now,
        serverSeq: 0,
      });
    const res = await june.v.request("/api/trash/empty", { body: { recipeIds: [recipeId] } });
    expect(await res.json()).toEqual({ expunged: 1 });
    expect(await storedDrafts(recipeId)).toEqual([]);
  });

  it("goes when the recipe's owner's account is deleted, never coming back as a new recipe", async () => {
    const june = await person();
    const sam = await person("Sam Ortiz");
    await share(june, sam);
    const recipeId = await newRecipe(june);
    expect((await put(sam, recipeId, draftOf("Sam's"))).status).toBe(200);
    await db().delete(user).where(eq(user.id, june.userId));
    expect((await list(sam)).drafts).toEqual([]);
    expect(await storedDrafts(recipeId)).toEqual([]);
    // Nor can the device turn it into a new recipe's draft afterwards.
    await db()
      .insert(recipeDraft)
      .values({
        userId: sam.userId,
        recipeId,
        ownerUserId: june.userId,
        isNew: false,
        content: JSON.stringify(draftOf("Sam's")),
        startedAt: new Date(),
        editedAt: new Date(Date.now() - 60_000),
        updatedAt: new Date(),
        serverSeq: 0,
      });
    const put2 = await put(sam, recipeId, draftOf("Sam's again"));
    expect(put2.body.error).toBe("not_found");
  });

  it("is left alone by a GET while an admin acts as the person (only left out)", async () => {
    const june = await person();
    const recipeId = await newRecipe(june);
    await put(june, recipeId, draftOf("Mine"));
    await db().update(recipe).set({ deletedAt: new Date() }).where(eq(recipe.id, recipeId));
    const sessionId = (await june.v.session())!.session.id;
    await db()
      .update(session)
      .set({ impersonatedBy: "some-admin" })
      .where(eq(session.id, sessionId));
    const seen = await list(june);
    expect(seen.drafts).toEqual([]);
    expect(seen.ids).toEqual([]);
    expect(await storedDrafts(recipeId)).toHaveLength(1);
    await db().update(session).set({ impersonatedBy: null }).where(eq(session.id, sessionId));
    await list(june);
    expect(await storedDrafts(recipeId)).toEqual([]);
  });

  it("looks for stale drafts through the person's own drafts, never every recipe", async () => {
    const plan = await env.DB.prepare(
      `explain query plan delete from recipe_draft where ${STALE_DRAFTS}`,
    )
      .bind("someone", "household")
      .all<{ detail: string }>();
    const steps = plan.results.map((row) => row.detail);
    expect(steps.some((step) => /^SEARCH recipe_draft/.test(step))).toBe(true);
    expect(steps.filter((step) => /\bSCAN (recipe|r)\b/.test(step))).toEqual([]);
  });

  it("goes with the person's account", async () => {
    const june = await person();
    const recipeId = id();
    await put(june, recipeId, draftOf("Mine"));
    expect(await storedDrafts(recipeId)).toHaveLength(1);
    await db().delete(user).where(eq(user.id, june.userId));
    expect(await storedDrafts(recipeId)).toEqual([]);
  });
});
