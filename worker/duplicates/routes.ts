import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { isRecipeId, MAX_DISMISSALS } from "../../shared/duplicates";
import { duplicateDismissal } from "../db/schema";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";

// "Not a duplicate" answers from the duplicate finder (phase C14; shared/duplicates.ts). A
// person's own list: every route looks only at the signed-in person's rows. It is read when the
// finder opens; adding, taking back and clearing need a connection.

type SessionEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const duplicateRoutes = new Hono<SessionEnv>();

/** Changes per person per minute: a guard against a runaway script. */
const CHANGES_PER_MINUTE = 120;

duplicateRoutes.use("/api/duplicate-dismissals", requireHousehold);
duplicateRoutes.use("/api/duplicate-dismissals/*", requireHousehold);

/** The pair in smaller-id-first order. */
const ordered = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

duplicateRoutes.get("/api/duplicate-dismissals", async (c) => {
  const { db, userId } = c.var.signedIn;
  const rows = await db
    .select({ a: duplicateDismissal.recipeA, b: duplicateDismissal.recipeB })
    .from(duplicateDismissal)
    .where(eq(duplicateDismissal.userId, userId))
    .all();
  return c.json({ pairs: rows.map((row) => [row.a, row.b] as [string, string]) });
});

duplicateRoutes.post("/api/duplicate-dismissals", async (c) => {
  const { db, userId } = c.var.signedIn;
  if (
    !(await withinRateLimit(db, `dismiss-duplicate:${userId}`, {
      max: CHANGES_PER_MINUTE,
      windowMs: 60_000,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = (await c.req.json<unknown>().catch(() => null)) as {
    a?: unknown;
    b?: unknown;
  } | null;
  if (!isRecipeId(body?.a) || !isRecipeId(body?.b) || body.a === body.b) {
    return c.json({ error: "invalid_pair" }, 400);
  }
  const [a, b] = ordered(body.a, body.b);
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(duplicateDismissal)
    .where(eq(duplicateDismissal.userId, userId))
    .get();
  if ((count?.n ?? 0) >= MAX_DISMISSALS) return c.json({ error: "too_many" }, 409);
  // Saying it twice is fine.
  await db
    .insert(duplicateDismissal)
    .values({ userId, recipeA: a, recipeB: b, createdAt: new Date() })
    .onConflictDoNothing();
  return c.json({ pair: [a, b] }, 201);
});

duplicateRoutes.delete("/api/duplicate-dismissals/:a/:b", async (c) => {
  const { db, userId } = c.var.signedIn;
  const { a: x, b: y } = c.req.param();
  if (!isRecipeId(x) || !isRecipeId(y)) return c.json({ error: "invalid_pair" }, 400);
  const [a, b] = ordered(x, y);
  await db
    .delete(duplicateDismissal)
    .where(
      and(
        eq(duplicateDismissal.userId, userId),
        eq(duplicateDismissal.recipeA, a),
        eq(duplicateDismissal.recipeB, b),
      ),
    );
  return c.json({ ok: true });
});

/** Forgets every answer: "show them again". */
duplicateRoutes.delete("/api/duplicate-dismissals", async (c) => {
  const { db, userId } = c.var.signedIn;
  await db.delete(duplicateDismissal).where(eq(duplicateDismissal.userId, userId));
  return c.json({ ok: true });
});
