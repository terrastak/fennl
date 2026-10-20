import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_SAVED_SEARCHES, type SavedSearch } from "../../shared/savedSearch";
import { database } from "../db/client";
import { savedSearch, user } from "../db/schema";
import { setUpDatabase, signUpConfirmed, visitor, type Visitor } from "../test/visitor";

// Phase C13b: a person's saved searches.

const db = () => database(env.DB);
let counter = 0;

beforeAll(async () => {
  await setUpDatabase();
});

async function person() {
  const email = `saved-search-${++counter}@example.com`;
  return { v: await signUpConfirmed(email), email };
}

type Answer = {
  status: number;
  body: { search?: SavedSearch; searches?: SavedSearch[]; error?: string };
};

async function call(v: Visitor, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await v.request(path, { method, ...(body === undefined ? {} : { body }) });
  return { status: res.status, body: (await res.json()) as Answer["body"] };
}

const list = async (v: Visitor) => (await call(v, "GET", "/api/saved-searches")).body.searches;
const create = (v: Visitor, name: unknown, query: unknown) =>
  call(v, "POST", "/api/saved-searches", { name, query });

describe("saving a search", () => {
  it("keeps a name and the search, and lists it", async () => {
    const { v } = await person();
    expect(await list(v)).toEqual([]);
    const made = await create(v, "  Quick   dinners ", "time=30&category=Dinners&without=mushroom");
    expect(made.status).toBe(201);
    expect(made.body.search).toMatchObject({
      name: "Quick dinners",
      query: "time=30&category=Dinners&without=mushroom",
    });
    expect(await list(v)).toEqual([made.body.search]);
  });

  it("lists them by name, ignoring case", async () => {
    const { v } = await person();
    for (const name of ["banana bread", "Apple pie", "Cookies"]) {
      await create(v, name, "rating=4");
    }
    expect((await list(v))?.map((s) => s.name)).toEqual(["Apple pie", "banana bread", "Cookies"]);
  });

  it("needs a signed-in person", async () => {
    for (const [method, path] of [
      ["GET", "/api/saved-searches"],
      ["POST", "/api/saved-searches"],
      ["PUT", "/api/saved-searches/x"],
      ["DELETE", "/api/saved-searches/x"],
    ] as const) {
      const body =
        method === "GET" || method === "DELETE" ? undefined : { name: "a", query: "q=a" };
      expect((await call(visitor(), method, path, body)).status).toBe(401);
    }
  });

  it("refuses a missing or bad name, and a query that isn't a search", async () => {
    const { v } = await person();
    expect((await create(v, "", "q=a")).body.error).toBe("invalid_name");
    expect((await create(v, "x".repeat(61), "q=a")).body.error).toBe("invalid_name");
    expect((await create(v, undefined, "q=a")).body.error).toBe("invalid_name");
    expect((await create(v, "Name", "")).body.error).toBe("invalid_query");
    expect((await create(v, "Name", "time=30&admin=1")).body.error).toBe("invalid_query");
    expect((await create(v, "Name", undefined)).body.error).toBe("invalid_query");
    expect(await list(v)).toEqual([]);
  });

  it("won't keep two with the same name, ignoring case and spacing", async () => {
    const { v } = await person();
    expect((await create(v, "Weeknight", "time=30")).status).toBe(201);
    const again = await create(v, " weeknight ", "time=45");
    expect(again).toEqual({ status: 409, body: { error: "name_taken" } });
    expect(await list(v)).toHaveLength(1);
  });

  it("has a limit per account", async () => {
    const { v, email } = await person();
    const owner = await db().select().from(user).where(eq(user.email, email)).get();
    const now = new Date();
    // D1 allows only so many values in one statement, so the rows go in a few at a time.
    for (let start = 0; start < MAX_SAVED_SEARCHES; start += 10) {
      await db()
        .insert(savedSearch)
        .values(
          Array.from({ length: 10 }, (_, i) => ({
            id: crypto.randomUUID(),
            userId: owner!.id,
            name: `Search ${start + i}`,
            query: "rating=4",
            createdAt: now,
            updatedAt: now,
          })),
        );
    }
    expect(await create(v, "One more", "rating=5")).toEqual({
      status: 409,
      body: { error: "too_many" },
    });
  });
});

describe("changing and removing", () => {
  it("renames, and updates the search", async () => {
    const { v } = await person();
    const { body } = await create(v, "Soups", "q=soup");
    const id = body.search!.id;

    const renamed = await call(v, "PUT", `/api/saved-searches/${id}`, { name: "All the soups" });
    expect(renamed.body.search).toMatchObject({ name: "All the soups", query: "q=soup" });

    const updated = await call(v, "PUT", `/api/saved-searches/${id}`, { query: "q=soup&time=30" });
    expect(updated.body.search).toMatchObject({ name: "All the soups", query: "q=soup&time=30" });
    expect(await list(v)).toEqual([updated.body.search]);
  });

  it("can keep its own name, but not take another's", async () => {
    const { v } = await person();
    const a = (await create(v, "Alpha", "q=a")).body.search!;
    await create(v, "Beta", "q=b");
    expect((await call(v, "PUT", `/api/saved-searches/${a.id}`, { name: "ALPHA" })).status).toBe(
      200,
    );
    expect(await call(v, "PUT", `/api/saved-searches/${a.id}`, { name: "beta" })).toEqual({
      status: 409,
      body: { error: "name_taken" },
    });
  });

  it("refuses a change that changes nothing, or a bad one", async () => {
    const { v } = await person();
    const { id } = (await create(v, "Soups", "q=soup")).body.search!;
    expect((await call(v, "PUT", `/api/saved-searches/${id}`, {})).body.error).toBe(
      "nothing_to_change",
    );
    expect((await call(v, "PUT", `/api/saved-searches/${id}`, { name: " " })).body.error).toBe(
      "invalid_name",
    );
    expect((await call(v, "PUT", `/api/saved-searches/${id}`, { query: "x=1" })).body.error).toBe(
      "invalid_query",
    );
  });

  it("removes one", async () => {
    const { v } = await person();
    const { id } = (await create(v, "Soups", "q=soup")).body.search!;
    expect((await call(v, "DELETE", `/api/saved-searches/${id}`)).status).toBe(200);
    expect(await list(v)).toEqual([]);
    expect((await call(v, "DELETE", `/api/saved-searches/${id}`)).status).toBe(404);
  });
});

describe("whose they are", () => {
  it("are the person's own: nobody else sees, changes or removes them", async () => {
    const june = await person();
    const sam = await person();
    const { id } = (await create(june.v, "June's soups", "q=soup")).body.search!;

    expect(await list(sam.v)).toEqual([]);
    expect(
      (await call(sam.v, "PUT", `/api/saved-searches/${id}`, { name: "Mine now" })).status,
    ).toBe(404);
    expect((await call(sam.v, "DELETE", `/api/saved-searches/${id}`)).status).toBe(404);
    expect((await list(june.v))?.map((s) => s.name)).toEqual(["June's soups"]);

    // The same name is fine for someone else.
    expect((await create(sam.v, "June's soups", "q=stew")).status).toBe(201);
  });

  it("go when the account goes", async () => {
    const { v, email } = await person();
    await create(v, "Soups", "q=soup");
    const owner = await db().select().from(user).where(eq(user.email, email)).get();
    expect(
      await db().select().from(savedSearch).where(eq(savedSearch.userId, owner!.id)),
    ).toHaveLength(1);
    await db().delete(user).where(eq(user.id, owner!.id));
    expect(
      await db().select().from(savedSearch).where(eq(savedSearch.userId, owner!.id)),
    ).toHaveLength(0);
  });
});
