import { env } from "cloudflare:test";
import { asc, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { RECIPE_SCHEMA_VERSION, emptyRecipeContent } from "../../shared/recipe";
import {
  formatCursors,
  type ChangeResult,
  type Cursors,
  type PullResponse,
  type SyncChange,
} from "../../shared/sync";
import { database } from "../db/client";
import { member, organization, recipeNote, recipeOpinion, session } from "../db/schema";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";
import { expungeRecipes } from "./trash";

// U7: notes on a recipe are entries, each signed by the person who wrote it and dated. Anyone in
// the household can add one; only its writer can change or remove it.

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

async function person(name: string): Promise<Person> {
  const v = await signUpConfirmed(`${name.toLowerCase()}-notes-${++counter}@example.com`, name);
  const userId = (await v.session())!.user.id;
  const deviceId = id();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(await res.json()).toEqual({ status: "ok" });
  return { v, userId, deviceId };
}

async function share(a: Person, b: Person) {
  const householdId = id();
  await db()
    .insert(organization)
    .values({ id: householdId, name: "Shared", slug: `n-${householdId}`, createdAt: new Date() });
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

async function push(p: Person, changes: unknown[]) {
  const res = await p.v.request("/api/sync/push", {
    body: {
      deviceId: p.deviceId,
      schemaVersion: RECIPE_SCHEMA_VERSION,
      sentAt: Date.now(),
      changes,
    },
  });
  return (await res.json()) as { results: ChangeResult[] };
}

async function pullNotes(p: Person) {
  const notes: PullResponse["notes"] = [];
  let since: Cursors = {};
  for (let i = 0; i < 10; i++) {
    const query = new URLSearchParams({
      deviceId: p.deviceId,
      schemaVersion: String(RECIPE_SCHEMA_VERSION),
      since: formatCursors(since),
    });
    const body = (await (await p.v.request(`/api/sync/pull?${query}`)).json()) as PullResponse;
    notes.push(...body.notes);
    since = body.cursors;
    if (!body.more) break;
  }
  return notes;
}

async function recipeOf(p: Person): Promise<string> {
  const recipeId = id();
  const change: SyncChange = {
    kind: "recipe",
    id: recipeId,
    create: { createdAt: new Date().toISOString(), import: null },
    fields: { ...emptyRecipeContent(), title: "Lemon cake" },
    changedAt: Date.now(),
  };
  expect((await push(p, [change])).results).toEqual([applied]);
  return recipeId;
}

const note = (recipeId: string, noteId: string, rest: object, changedAt = Date.now()) => ({
  kind: "note",
  id: noteId,
  recipeId,
  ...rest,
  changedAt,
});

const applied: ChangeResult = { status: "applied" };
const unchanged: ChangeResult = { status: "unchanged" };

describe("notes on a recipe (U7)", () => {
  it("are signed by their writer; a partner adds their own but can't change another's", async () => {
    const june = await person("June");
    const sam = await person("Sam");
    await share(june, sam);
    const recipeId = await recipeOf(june);
    const junes = id();
    const sams = id();
    const t = Date.now();
    expect(
      (await push(june, [note(recipeId, junes, { text: "Use Meyer lemons." }, t)])).results,
    ).toEqual([applied]);
    expect(
      (await push(sam, [note(recipeId, sams, { text: "Doubled it." }, t + 1)])).results,
    ).toEqual([applied]);

    let notes = await pullNotes(june);
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: junes, userId: june.userId, text: "Use Meyer lemons." }),
        expect.objectContaining({ id: sams, userId: sam.userId, text: "Doubled it." }),
      ]),
    );
    expect(notes.find((n) => n.id === junes)?.editedAt).toBeNull();

    // Sam can't change or remove June's note.
    expect((await push(sam, [note(recipeId, junes, { text: "Mine now" }, t + 2)])).results).toEqual(
      [unchanged],
    );
    expect((await push(sam, [note(recipeId, junes, { deleted: true }, t + 3)])).results).toEqual([
      unchanged,
    ]);

    // June changes hers: it's marked edited. Then removes it.
    expect(
      (await push(june, [note(recipeId, junes, { text: "Meyer lemons." }, t + 4)])).results,
    ).toEqual([applied]);
    notes = await pullNotes(sam);
    expect(notes.find((n) => n.id === junes)).toMatchObject({
      text: "Meyer lemons.",
      editedAt: expect.any(String),
      deletedAt: null,
    });
    expect((await push(june, [note(recipeId, junes, { deleted: true }, t + 5)])).results).toEqual([
      applied,
    ]);
    notes = await pullNotes(sam);
    expect(notes.find((n) => n.id === junes)?.deletedAt).not.toBeNull();
    expect(notes.find((n) => n.id === sams)?.deletedAt).toBeNull();
  });

  it("can't be added to a recipe outside the household", async () => {
    const june = await person("June");
    const stranger = await person("Pat");
    const recipeId = await recipeOf(june);
    expect((await push(stranger, [note(recipeId, id(), { text: "Hi" })])).results).toEqual([
      { status: "rejected", reason: "not_found" },
    ]);
  });

  it("are wiped when the recipe is deleted for good", async () => {
    const june = await person("June");
    const recipeId = await recipeOf(june);
    const noteId = id();
    await push(june, [note(recipeId, noteId, { text: "Grandma's" })]);
    await push(june, [
      { kind: "recipe", id: recipeId, fields: {}, deleted: true, changedAt: Date.now() },
    ]);
    expect(await expungeRecipes(db(), [recipeId])).toBe(1);
    const row = await db().select().from(recipeNote).where(eq(recipeNote.id, noteId)).get();
    expect(row).toMatchObject({ text: "" });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect((await push(june, [note(recipeId, id(), { text: "Again" })])).results).toEqual([
      unchanged,
    ]);
  });
});

describe("carrying over notes written before entries (migration 0038)", () => {
  it("makes each dated part its own entry, dated that day", async () => {
    const june = await person("June");
    const recipeId = await recipeOf(june);
    const opinion = {
      kind: "opinion",
      recipeId,
      fields: {
        note: "Mom's, with extra raisins.\n\nOct 26, 2026: Used less sugar.\n\nOct 27, 2026: Walnuts.\nToasted.",
      },
      changedAt: Date.now(),
    };
    expect((await push(june, [opinion])).results).toEqual([applied]);
    const plain = await recipeOf(june);
    await push(june, [{ ...opinion, recipeId: plain, fields: { note: "  Just this.  " } }]);
    const changed = new Date("2026-10-20T08:00:00Z");
    await db()
      .update(recipeOpinion)
      .set({ updatedAt: changed })
      .where(eq(recipeOpinion.recipeId, plain));
    await db()
      .update(recipeOpinion)
      .set({ updatedAt: new Date("2026-10-28T09:00:00Z") })
      .where(eq(recipeOpinion.recipeId, recipeId));

    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0038"))!;
    await env.DB.batch(migration.queries.map((q) => env.DB.prepare(q)));

    const rows = await db()
      .select()
      .from(recipeNote)
      .where(inArray(recipeNote.recipeId, [recipeId, plain]))
      .orderBy(asc(recipeNote.writtenAt))
      .all();
    const noon = (day: string) => new Date(`${day}T12:00:00Z`).getTime();
    expect(
      rows.map((r) => ({ recipe: r.recipeId, text: r.text, at: r.writtenAt.getTime() })),
    ).toEqual([
      { recipe: plain, text: "Just this.", at: changed.getTime() },
      // Words before the first dated part come just before it.
      { recipe: recipeId, text: "Mom's, with extra raisins.", at: noon("2026-10-26") + 2 },
      { recipe: recipeId, text: "Used less sugar.", at: noon("2026-10-26") + 3 },
      { recipe: recipeId, text: "Walnuts.\nToasted.", at: noon("2026-10-27") + 4 },
    ]);
    expect(rows.every((r) => r.userId === june.userId && r.editedAt === null)).toBe(true);

    // Devices fetch them.
    const pulled = await pullNotes(june);
    expect(pulled.filter((n) => n.recipeId === recipeId)).toHaveLength(3);
  });
});
