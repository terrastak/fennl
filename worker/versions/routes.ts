import { Hono } from "hono";
import { isRecipeId } from "../../shared/duplicates";
import { RECIPE_FIELDS, type RecipeContent } from "../../shared/recipe";
import {
  VERSION_RULES,
  isVersionReason,
  type RecipeVersion,
  type VersionReason,
  type VersionSnapshot,
} from "../../shared/versions";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";

// Earlier versions of recipes (phase E13; shared/versions.ts). Before importing again from
// Paprika changes a recipe, the app asks the server to keep the recipe as the server has it; the
// recipe page then reads it back to compare and, if the person wants, to put it back (as an
// ordinary change through sync). Deciding removes it. Access is the recipe's: its owner must be
// in the caller's household.

type SessionEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const versionRoutes = new Hono<SessionEnv>();

/** Requests per person per minute: an import keeps versions a batch at a time. */
const KEEPS_PER_MINUTE = 120;

versionRoutes.use("/api/recipes/versions", requireHousehold);
versionRoutes.use("/api/recipes/:id/versions", requireHousehold);
versionRoutes.use("/api/recipes/:id/versions/*", requireHousehold);

const COLUMNS: Record<(typeof RECIPE_FIELDS)[number], { column: string; json: boolean }> = {
  title: { column: "title", json: false },
  description: { column: "description", json: false },
  ingredients: { column: "ingredients", json: true },
  directions: { column: "directions", json: true },
  times: { column: "times", json: true },
  servings: { column: "servings", json: true },
  source: { column: "source", json: true },
  notes: { column: "notes", json: false },
  difficulty: { column: "difficulty", json: false },
  difficultyText: { column: "difficulty_text", json: false },
  nutrition: { column: "nutrition", json: true },
};

/** The recipe's content as JSON, built by the database from the row as it is now. */
const CONTENT = `json_object(${RECIPE_FIELDS.map((field) => {
  const { column, json } = COLUMNS[field];
  return `'${field}', ${json ? `json(r.${column})` : `r.${column}`}`;
}).join(", ")})`;

const IN_HOUSEHOLD = "(select user_id from member where organization_id = ?2)";

/**
 * Keeps the current version of each recipe (one statement for them all, from the rows as they
 * are, so nothing is read and then written back). A recipe already holding a version nobody has
 * decided on keeps that one: it's the one from before the first update.
 */
versionRoutes.post("/api/recipes/versions", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  if (
    !(await withinRateLimit(db, `keep-versions:${userId}`, {
      max: KEEPS_PER_MINUTE,
      windowMs: 60_000,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = (await c.req.json<unknown>().catch(() => null)) as {
    recipeIds?: unknown;
    reason?: unknown;
  } | null;
  const ids = body?.recipeIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > VERSION_RULES.recipesPerRequest ||
    !ids.every(isRecipeId) ||
    !isVersionReason(body?.reason)
  ) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const unique = [...new Set(ids)];
  const reason: VersionReason = body.reason;
  const marks = (from: number) => unique.map((_, i) => `?${i + from}`).join(", ");
  const d1 = db.$client;
  await d1
    .prepare(
      `insert into recipe_version (id, recipe_id, owner_user_id, snapshot, reason, author_user_id,
          created_at)
        select lower(hex(randomblob(16))), r.id, r.owner_user_id,
          json_object('content', ${CONTENT}, 'opinion', json((
            select json_object('userId', o.user_id, 'rating', o.rating, 'note', o.note)
            from recipe_opinion o
            where o.recipe_id = r.id and o.user_id = ?1 and o.deleted_at is null))),
          ?3, ?1, ?4
        from recipe r
        where r.id in (${marks(5)}) and r.owner_user_id in ${IN_HOUSEHOLD}
          and r.expunged_at is null
          and not exists (select 1 from recipe_version v where v.recipe_id = r.id and v.reason = ?3)`,
    )
    .bind(userId, household.householdId, reason, Date.now(), ...unique)
    .run();
  const kept = await d1
    .prepare(
      `select distinct v.recipe_id as id from recipe_version v
        where v.recipe_id in (${marks(3)}) and v.reason = ?1
          and v.owner_user_id in (select user_id from member where organization_id = ?2)`,
    )
    .bind(reason, household.householdId, ...unique)
    .all<{ id: string }>();
  return c.json({ kept: kept.results.map((row) => row.id) });
});

versionRoutes.get("/api/recipes/:id/versions", async (c) => {
  const { db, household } = c.var.signedIn;
  const recipeId = c.req.param("id");
  if (!isRecipeId(recipeId)) return c.json({ error: "not_found" }, 404);
  const rows = await db.$client
    .prepare(
      `select v.id, v.recipe_id, v.reason, v.created_at, v.author_user_id, v.snapshot
        from recipe_version v
        where v.recipe_id = ?1 and v.owner_user_id in ${IN_HOUSEHOLD}
        order by v.created_at`,
    )
    .bind(recipeId, household.householdId)
    .all<{
      id: string;
      recipe_id: string;
      reason: VersionReason;
      created_at: number;
      author_user_id: string | null;
      snapshot: string;
    }>();
  const versions: RecipeVersion[] = rows.results.map((row) => {
    const snapshot = JSON.parse(row.snapshot) as {
      content: RecipeContent;
      opinion: VersionSnapshot["opinion"];
    };
    return {
      id: row.id,
      recipeId: row.recipe_id,
      reason: row.reason,
      createdAt: new Date(row.created_at).toISOString(),
      authorUserId: row.author_user_id,
      snapshot: { content: snapshot.content, opinion: snapshot.opinion ?? null },
    };
  });
  return c.json({ versions });
});

/** The household chose which version to keep: the earlier one isn't needed any more. */
versionRoutes.delete("/api/recipes/:id/versions/:versionId", async (c) => {
  const { db, household } = c.var.signedIn;
  const { id: recipeId, versionId } = c.req.param();
  if (!isRecipeId(recipeId) || !/^[0-9a-f]{32}$/.test(versionId)) {
    return c.json({ error: "not_found" }, 404);
  }
  const done = await db.$client
    .prepare(
      `delete from recipe_version
        where id = ?3 and recipe_id = ?1 and owner_user_id in ${IN_HOUSEHOLD} returning id`,
    )
    .bind(recipeId, household.householdId, versionId)
    .all();
  return done.results.length > 0 ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
});
