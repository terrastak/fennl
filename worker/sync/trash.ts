import { Hono } from "hono";
import { TRASH_DAYS, emptyRecipeContent, isId } from "../../shared/recipe";
import type { Database } from "../db/client";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { bump, seq, type Statement } from "./push";

// Trash (phase C9). Moving a recipe to Trash and back is an ordinary synced change (its
// "deleted" field). Here is what happens after: a recipe is deleted for good ("expunged") after
// 30 days in Trash, by the hourly scheduled job, or straight away when someone empties Trash.
//
// Expunging wipes the recipe's content, and the household's ratings, notes, "made it" days and
// category links for it. The recipe's row stays, marked expunged and with a new server_seq, so
// every device learns of it and drops its copy (CLAUDE.md, "Data model rules"). It can't come
// back: changes to it are refused from then on (worker/sync/push.ts).

const DAY = 24 * 60 * 60 * 1000;

/** Recipes per batch of statements (each recipe is one statement, plus a few for the rest). */
const CHUNK = 40;

const EMPTY = emptyRecipeContent();

/** Each recipe's content, as stored once wiped. */
const WIPED: Record<string, unknown> = {
  title: "",
  description: "",
  ingredients: "[]",
  directions: "[]",
  times: JSON.stringify(EMPTY.times),
  servings: JSON.stringify(EMPTY.servings),
  source: JSON.stringify(EMPTY.source),
  notes: "",
  difficulty: null,
  difficulty_text: null,
  nutrition: null,
};

/** Still in Trash and not yet expunged: the only recipes expunging may touch. */
const IN_TRASH = "deleted_at is not null and expunged_at is null";

/** Expunges these recipes (those still in Trash), in chunks. Returns how many were expunged. */
export async function expungeRecipes(db: Database, recipeIds: string[], now = Date.now()) {
  const d1 = db.$client;
  let expunged = 0;
  for (let i = 0; i < recipeIds.length; i += CHUNK) {
    const ids = recipeIds.slice(i, i + CHUNK);
    const marks = ids.map((_, k) => `?${k + 2}`).join(", ");
    const statements: Statement[] = ids.map((id, k) => ({
      sql: `update recipe set ${Object.keys(WIPED)
        .map((column, c) => `${column} = ?${c + 3}`)
        .join(", ")}, import = null, expunged_at = ?1, updated_at = ?1, server_seq = ${seq(k + 1)}
        where id = ?2 and ${IN_TRASH}
        returning id`,
      params: [now, id, ...Object.values(WIPED)],
    }));
    // What belonged to them goes too. These rows aren't sent to devices again: a device drops
    // them itself when it learns the recipe was expunged.
    const theirs = `recipe_id in (${marks}) and recipe_id in (select id from recipe where expunged_at = ?1)`;
    statements.push(
      {
        sql: `update recipe_opinion set note = '', rating = null, favorite = 0,
          deleted_at = coalesce(deleted_at, ?1), updated_at = ?1 where ${theirs}`,
        params: [now, ...ids],
      },
      {
        sql: `update recipe_made set deleted_at = coalesce(deleted_at, ?1), updated_at = ?1
          where ${theirs}`,
        params: [now, ...ids],
      },
      {
        sql: `update recipe_category set deleted_at = coalesce(deleted_at, ?1), updated_at = ?1
          where ${theirs}`,
        params: [now, ...ids],
      },
      // Its photos (phase D2). The images themselves are deleted by the housekeeping job (D3)
      // once nothing uses them.
      {
        sql: `update recipe_photo set deleted_at = coalesce(deleted_at, ?1), updated_at = ?1
          where ${theirs}`,
        params: [now, ...ids],
      },
      bump(ids.length),
    );
    const results = await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...s.params)));
    expunged += results.slice(0, ids.length).filter((r) => r.results.length > 0).length;
  }
  return expunged;
}

/** The scheduled job: recipes in Trash for more than 30 days. Returns how many were expunged. */
export async function expungeOldTrash(db: Database, now = Date.now()): Promise<number> {
  const rows = await db.$client
    .prepare(`select id from recipe where ${IN_TRASH} and deleted_at < ?1 limit 2000`)
    .bind(now - TRASH_DAYS * DAY)
    .all<{ id: string }>();
  return expungeRecipes(
    db,
    rows.results.map((r) => r.id),
    now,
  );
}

// ---------------------------------------------------------------------------------------------
// Emptying Trash now
// ---------------------------------------------------------------------------------------------

type TrashEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const trashRoutes = new Hono<TrashEnv>();

trashRoutes.use("/api/trash/*", requireHousehold);

/**
 * Deletes for good what's in the household's Trash: everything, or the recipes named. Either
 * partner can, as either can move recipes to Trash (CLAUDE.md, "Recipe ownership in
 * households").
 */
trashRoutes.post("/api/trash/empty", async (c) => {
  const signedIn = c.var.signedIn;
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    // No body: empty all of it.
  }
  const chosen = (body as { recipeIds?: unknown }).recipeIds;
  if (
    chosen !== undefined &&
    (!Array.isArray(chosen) || !chosen.every(isId) || chosen.length > 1000)
  ) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const rows = await signedIn.db.$client
    .prepare(
      `select id from recipe where ${IN_TRASH}
        and owner_user_id in (select user_id from member where organization_id = ?1)`,
    )
    .bind(signedIn.household.householdId)
    .all<{ id: string }>();
  const wanted = chosen ? new Set(chosen as string[]) : null;
  const ids = rows.results.map((r) => r.id).filter((id) => !wanted || wanted.has(id));
  const expunged = await expungeRecipes(signedIn.db, ids);
  return c.json({ expunged });
});
