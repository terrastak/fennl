import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  cleanSavedName,
  cleanSavedQuery,
  MAX_SAVED_SEARCHES,
  sameSavedName,
  type SavedSearch,
} from "../../shared/savedSearch";
import { savedSearch } from "../db/schema";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";

// A person's saved searches (phase C13b; shared/savedSearch.ts). Their own: every route looks
// only at the signed-in person's rows, so another person's are simply not found. The list is
// loaded when the app opens and kept on the device for offline use; saving, renaming and
// removing need a connection.

type SessionEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const savedSearchRoutes = new Hono<SessionEnv>();

/** Changes per person per minute: a guard against a runaway script. */
const CHANGES_PER_MINUTE = 60;

type Row = typeof savedSearch.$inferSelect;

const present = (row: Row): SavedSearch => ({
  id: row.id,
  name: row.name,
  query: row.query,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

savedSearchRoutes.use("/api/saved-searches", requireHousehold);
savedSearchRoutes.use("/api/saved-searches/*", requireHousehold);

savedSearchRoutes.get("/api/saved-searches", async (c) => {
  const { db, userId } = c.var.signedIn;
  const rows = await db
    .select()
    .from(savedSearch)
    .where(eq(savedSearch.userId, userId))
    .orderBy(asc(sql`lower(${savedSearch.name})`))
    .all();
  return c.json({ searches: rows.map(present) });
});

/** The name and query in a request, checked. */
async function readBody(c: {
  req: { json: <T>() => Promise<T> };
}): Promise<{ name?: string; query?: string; bad?: "invalid_name" | "invalid_query" }> {
  const body = (await c.req.json<unknown>().catch(() => null)) as {
    name?: unknown;
    query?: unknown;
  } | null;
  const result: { name?: string; query?: string; bad?: "invalid_name" | "invalid_query" } = {};
  if (body?.name !== undefined) {
    const name = cleanSavedName(body.name);
    if (name === null) return { bad: "invalid_name" };
    result.name = name;
  }
  if (body?.query !== undefined) {
    const query = cleanSavedQuery(body.query);
    if (query === null) return { bad: "invalid_query" };
    result.query = query;
  }
  return result;
}

savedSearchRoutes.post("/api/saved-searches", async (c) => {
  const { db, userId } = c.var.signedIn;
  if (
    !(await withinRateLimit(db, `saved-search:${userId}`, {
      max: CHANGES_PER_MINUTE,
      windowMs: 60_000,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const { name, query, bad } = await readBody(c);
  if (bad) return c.json({ error: bad }, 400);
  if (name === undefined) return c.json({ error: "invalid_name" }, 400);
  if (query === undefined) return c.json({ error: "invalid_query" }, 400);

  const mine = await db.select().from(savedSearch).where(eq(savedSearch.userId, userId)).all();
  if (mine.some((row) => sameSavedName(row.name, name))) {
    return c.json({ error: "name_taken" }, 409);
  }
  if (mine.length >= MAX_SAVED_SEARCHES) return c.json({ error: "too_many" }, 409);

  const now = new Date();
  const row: Row = { id: crypto.randomUUID(), userId, name, query, createdAt: now, updatedAt: now };
  await db.insert(savedSearch).values(row);
  return c.json({ search: present(row) }, 201);
});

savedSearchRoutes.put("/api/saved-searches/:id", async (c) => {
  const { db, userId } = c.var.signedIn;
  if (
    !(await withinRateLimit(db, `saved-search:${userId}`, {
      max: CHANGES_PER_MINUTE,
      windowMs: 60_000,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const { name, query, bad } = await readBody(c);
  if (bad) return c.json({ error: bad }, 400);
  if (name === undefined && query === undefined) return c.json({ error: "nothing_to_change" }, 400);

  const id = c.req.param("id");
  const mine = await db.select().from(savedSearch).where(eq(savedSearch.userId, userId)).all();
  const current = mine.find((row) => row.id === id);
  if (!current) return c.json({ error: "not_found" }, 404);
  if (name !== undefined && mine.some((row) => row.id !== id && sameSavedName(row.name, name))) {
    return c.json({ error: "name_taken" }, 409);
  }

  const changes = {
    name: name ?? current.name,
    query: query ?? current.query,
    updatedAt: new Date(),
  };
  await db
    .update(savedSearch)
    .set(changes)
    .where(and(eq(savedSearch.id, id), eq(savedSearch.userId, userId)));
  return c.json({ search: present({ ...current, ...changes }) });
});

savedSearchRoutes.delete("/api/saved-searches/:id", async (c) => {
  const { db, userId } = c.var.signedIn;
  if (
    !(await withinRateLimit(db, `saved-search:${userId}`, {
      max: CHANGES_PER_MINUTE,
      windowMs: 60_000,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const removed = await db
    .delete(savedSearch)
    .where(and(eq(savedSearch.id, c.req.param("id")), eq(savedSearch.userId, userId)))
    .returning({ id: savedSearch.id });
  if (removed.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
