import { Hono, type Context } from "hono";
import {
  MAX_DRAFTS,
  MAX_DRAFT_REQUEST_BYTES,
  draftFits,
  draftTextBytes,
  isDraftData,
  type DraftData,
  type DraftError,
  type DraftsResponse,
  type RecipeDraft,
} from "../../shared/drafts";
import { isId } from "../../shared/recipe";
import { readCapped } from "../body";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import { bump } from "../sync/push";
import { holdDraftPhotos } from "./hold";

// Drafts (U27 part 3; shared/drafts.ts). What a person changed in the recipe editor and hasn't
// applied with Done, kept with their account so closing the window or switching devices loses
// nothing. Every route looks only at the signed-in person's own drafts: a partner never sees
// them. A draft of a saved recipe needs the recipe's owner in the person's household (the access
// rule); a new recipe's draft is the person's own.
//
// Two devices writing the same draft: the newest edit wins (by the device's clock moved onto the
// server's), so a device that was offline for days can't overwrite a newer draft. Done and
// Discard remove only the version a device has seen.

type DraftEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const draftRoutes = new Hono<DraftEnv>();

draftRoutes.use("/api/drafts", requireHousehold);
draftRoutes.use("/api/drafts/*", requireHousehold);

/** Writes per person per minute: the editor saves about once a second while typing. */
const CHANGES_PER_MINUTE = 240;
/** About how much draft text one GET answers with; the rest comes on the next (`more`). */
const PAGE_BYTES = 4_000_000;

const STATUS: Record<DraftError, 400 | 404 | 409 | 413 | 429> = {
  invalid_request: 400,
  invalid_draft: 400,
  too_large: 413,
  too_many: 409,
  in_trash: 409,
  limit: 409,
  not_found: 404,
  rate_limited: 429,
};

function refuse(c: Context<DraftEnv>, error: DraftError) {
  return c.json({ error }, STATUS[error]);
}

const members = (n: number) => `(select user_id from member where organization_id = ?${n})`;

interface Row {
  recipe_id: string;
  owner_user_id: string;
  is_new: number;
  content: string;
  started_at: number;
  edited_at: number;
  updated_at: number;
  server_seq: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

function present(row: Row): RecipeDraft {
  return {
    recipeId: row.recipe_id,
    ownerUserId: row.owner_user_id,
    isNew: Boolean(row.is_new),
    data: JSON.parse(row.content) as DraftData,
    startedAt: iso(row.started_at),
    editedAt: iso(row.edited_at),
    updatedAt: iso(row.updated_at),
  };
}

/** A time a device sent, as milliseconds; null if it isn't one. */
function deviceTime(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** A device's time moved onto the server's clock, never later than now. */
export function serverTime(time: number, sentAt: number, now: number): number {
  return Math.max(1, Math.min(now, Math.round(time + (now - sentAt))));
}

/**
 * Drafts that can no longer be applied (a condition on recipe_draft, ?1 the person and ?2 their
 * household): of recipes in Trash or deleted for good, of recipes whose owner is no longer in
 * their household (a visibility change: they can't see the recipe, so its draft goes), and of
 * saved recipes that are gone altogether (their owner's account was deleted). Looked up through
 * the person's own drafts only (the primary key), never the whole recipe table.
 */
export const STALE_DRAFTS = `recipe_draft.user_id = ?1 and (
    exists (select 1 from recipe r where r.id = recipe_draft.recipe_id
      and (r.deleted_at is not null or r.expunged_at is not null
        or r.owner_user_id not in ${members(2)}))
    or (recipe_draft.is_new = 0
      and not exists (select 1 from recipe r where r.id = recipe_draft.recipe_id)))`;

/**
 * Removes the person's stale drafts (above), holding their photos for the usual week first. Not
 * while an admin acts as them: a GET changes nothing then (stale drafts are left out instead).
 */
async function dropStale(d1: D1Database, userId: string, householdId: string, now: number) {
  const hold = holdDraftPhotos(STALE_DRAFTS, [userId, householdId], now);
  await d1.batch([
    d1.prepare(hold.sql).bind(...hold.params),
    d1.prepare(`delete from recipe_draft where ${STALE_DRAFTS}`).bind(userId, householdId),
  ]);
}

/** The person's drafts, as stored, with whether the recipe exists now and whose it is. */
const SELECT = `select recipe_draft.recipe_id,
    coalesce(r.owner_user_id, recipe_draft.owner_user_id) as owner_user_id,
    r.id is null as is_new, recipe_draft.content, recipe_draft.started_at,
    recipe_draft.edited_at, recipe_draft.updated_at, recipe_draft.server_seq
  from recipe_draft left join recipe r on r.id = recipe_draft.recipe_id`;

/**
 * GET /api/drafts?since=<cursor>: the person's drafts written after the cursor (all of them
 * without one), a page at a time, and every draft's id with its latest edit.
 */
draftRoutes.get("/api/drafts", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const d1 = db.$client;
  const sinceText = c.req.query("since");
  const since = sinceText === undefined || sinceText === "" ? 0 : Number(sinceText);
  if (!Number.isInteger(since) || since < 0) return refuse(c, "invalid_request");

  if (!c.var.signedIn.impersonating) {
    await dropStale(d1, userId, household.householdId, Date.now());
  }
  const [changed, all] = await d1.batch([
    d1
      .prepare(
        `${SELECT} where recipe_draft.user_id = ?1 and recipe_draft.server_seq > ?3
          and not (${STALE_DRAFTS}) order by recipe_draft.server_seq`,
      )
      .bind(userId, household.householdId, since),
    d1
      .prepare(
        `select recipe_id, edited_at from recipe_draft
          where user_id = ?1 and not (${STALE_DRAFTS}) order by recipe_id`,
      )
      .bind(userId, household.householdId),
  ]);
  const rows = (changed?.results ?? []) as unknown as Row[];
  const drafts: RecipeDraft[] = [];
  let bytes = 0;
  let cursor = since;
  for (const row of rows) {
    if (drafts.length > 0 && bytes + row.content.length > PAGE_BYTES) break;
    bytes += row.content.length;
    drafts.push(present(row));
    cursor = row.server_seq;
  }
  const answer: DraftsResponse = {
    drafts,
    ids: ((all?.results ?? []) as unknown as Pick<Row, "recipe_id" | "edited_at">[]).map((row) => ({
      recipeId: row.recipe_id,
      editedAt: iso(row.edited_at),
    })),
    cursor,
    more: drafts.length < rows.length,
  };
  return c.json(answer);
});

/**
 * PUT /api/drafts/:recipeId: keeps the draft, unless the stored one is newer. One conditional
 * statement checks the access rule, Trash, the cap and "newer only" as it writes.
 */
draftRoutes.put("/api/drafts/:recipeId", async (c) => {
  const { db, userId, household } = c.var.signedIn;
  const recipeId = c.req.param("recipeId");
  if (!isId(recipeId)) return refuse(c, "invalid_request");
  if (
    !(await withinRateLimit(db, `draft:${userId}`, {
      max: CHANGES_PER_MINUTE,
      windowMs: 60_000,
    }))
  ) {
    return refuse(c, "rate_limited");
  }
  const raw = await readCapped(c.req.raw, MAX_DRAFT_REQUEST_BYTES);
  if (raw === null) return refuse(c, "too_large");
  let body: { draft?: unknown; startedAt?: unknown; editedAt?: unknown; sentAt?: unknown };
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as typeof body;
  } catch {
    return refuse(c, "invalid_request");
  }
  const startedAt = deviceTime(body?.startedAt);
  const editedAt = deviceTime(body?.editedAt);
  const sentAt = deviceTime(body?.sentAt);
  if (startedAt === null || editedAt === null || sentAt === null) {
    return refuse(c, "invalid_request");
  }
  if (!isDraftData(body.draft)) return refuse(c, "invalid_draft");
  const content = JSON.stringify(body.draft);
  // Bounded by the plan's per-recipe size (shared/drafts.ts draftFits), never a fixed number.
  const plan = await householdEntitlements(db, household.householdId);
  const textBytes = draftTextBytes(body.draft);
  if (!draftFits(new TextEncoder().encode(content).length, textBytes, plan.max_recipe_bytes)) {
    return refuse(c, "too_large");
  }

  const now = Date.now();
  const edited = serverTime(editedAt, sentAt, now);
  const started = Math.min(serverTime(startedAt, sentAt, now), edited);
  const d1 = db.$client;
  // New-recipe drafts are bounded by the plan (owner's choice pending, spec.md U27 part 3): a
  // household holds at most as many as its plan's recipes, and their text with its recipes' text
  // stays within the plan's text limit, so drafts can't hold more than the plan allows. A saved
  // recipe's draft never counts. (Not the room left for recipes: a new recipe started with room
  // keeps its draft in the account when the room goes, and Done says why it waits.)
  const otherNew = (what: string) =>
    `(select ${what} from recipe_draft o where o.is_new = 1 and o.recipe_id <> ?2
      and o.user_id in ${members(7)})`;
  const room = `(?10 is null or ${otherNew("count(*)")} < ?10)
      and (?11 is null or (select coalesce(sum(text_bytes), 0) from recipe
        where owner_user_id in ${members(7)}) + ${otherNew("coalesce(sum(o.text_bytes), 0)")}
        + ?9 <= ?11)`;
  const [written] = await d1.batch([
    d1
      .prepare(
        `insert into recipe_draft (user_id, recipe_id, owner_user_id, is_new, content, text_bytes,
            started_at, edited_at, device_edited_at, updated_at, server_seq)
          select ?1, ?2, coalesce(r.owner_user_id, ?1), r.id is null, ?3,
            case when r.id is null then ?9 else 0 end, ?4, ?5, ?12, ?6,
            (select value from sync_counter where id = 1) + 1
          from (select 1) left join recipe r on r.id = ?2
          where (r.id is not null or (${room}
              and not exists (select 1 from recipe_draft where user_id = ?1 and recipe_id = ?2
                and is_new = 0)))
            and (r.id is null or (r.deleted_at is null and r.expunged_at is null
              and r.owner_user_id in ${members(7)}))
            and ((select count(*) from recipe_draft where user_id = ?1) < ?8
              or exists (select 1 from recipe_draft where user_id = ?1 and recipe_id = ?2))
          on conflict (user_id, recipe_id) do update set content = excluded.content,
            text_bytes = excluded.text_bytes,
            edited_at = excluded.edited_at, device_edited_at = excluded.device_edited_at,
            updated_at = excluded.updated_at,
            owner_user_id = excluded.owner_user_id, is_new = excluded.is_new,
            server_seq = excluded.server_seq
          where excluded.edited_at > recipe_draft.edited_at
          returning *`,
      )
      .bind(
        userId,
        recipeId,
        content,
        started,
        edited,
        now,
        household.householdId,
        MAX_DRAFTS,
        textBytes,
        plan.max_recipes,
        plan.max_text_bytes,
        editedAt,
      ),
    d1.prepare(bump(1).sql).bind(...bump(1).params),
  ]);
  const row = (written?.results ?? [])[0] as Row | undefined;
  if (row) return c.json({ draft: present(row), kept: true });

  // Not written: say why.
  const [recipeRows, storedRows, countRows] = await d1.batch([
    d1
      .prepare(
        `select deleted_at is not null or expunged_at is not null as trashed,
            owner_user_id in ${members(2)} as visible
          from recipe where id = ?1`,
      )
      .bind(recipeId, household.householdId),
    d1
      .prepare(
        `${SELECT.replace(" from ", ", recipe_draft.is_new as stored_new from ")}
          where recipe_draft.user_id = ?1 and recipe_draft.recipe_id = ?2`,
      )
      .bind(userId, recipeId),
    d1.prepare("select count(*) as n from recipe_draft where user_id = ?1").bind(userId),
  ]);
  const found = (recipeRows?.results ?? [])[0] as { trashed: number; visible: number } | undefined;
  if (found?.trashed) return refuse(c, "in_trash");
  if (found && !found.visible) return refuse(c, "not_found");
  const stored = (storedRows?.results ?? [])[0] as (Row & { stored_new: number }) | undefined;
  // A saved recipe's draft whose recipe is gone (its owner's account was deleted).
  if (!found && stored && !stored.stored_new) return refuse(c, "not_found");
  if (stored && Date.parse(present(stored).editedAt) >= edited) {
    return c.json({ draft: present(stored), kept: false });
  }
  const count = ((countRows?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0;
  if (!stored && count >= MAX_DRAFTS) return refuse(c, "too_many");
  return refuse(c, "limit");
});

/**
 * DELETE /api/drafts/:recipeId: removes the draft after Done or Discard, only if it is no newer
 * than the version the device has, so a newer draft from another device stays. `editedAt`: that
 * version's time as the server answered it (milliseconds or ISO). A version the device wrote but
 * never heard back about: `deviceEditedAt` and `sentAt` instead (the device's clock): exactly that
 * version (as the device sent it), or one older (moved onto the server's clock as PUT does). With
 * neither, removes it whatever its time. Its photos are held for the usual week first (hold.ts).
 */
draftRoutes.delete("/api/drafts/:recipeId", async (c) => {
  const { db, userId } = c.var.signedIn;
  const recipeId = c.req.param("recipeId");
  if (!isId(recipeId)) return refuse(c, "invalid_request");
  const now = Date.now();
  const editedText = c.req.query("editedAt");
  const deviceText = c.req.query("deviceEditedAt");
  let upTo: number | null = null;
  let exactly: number | null = null;
  if (editedText !== undefined) {
    upTo = /^\d+$/.test(editedText) ? Number(editedText) : Date.parse(editedText);
    if (!Number.isFinite(upTo)) return refuse(c, "invalid_request");
  } else if (deviceText !== undefined) {
    const device = deviceTime(Number(deviceText));
    const sentAt = deviceTime(Number(c.req.query("sentAt")));
    if (device === null || sentAt === null) return refuse(c, "invalid_request");
    upTo = serverTime(device, sentAt, now);
    exactly = device;
  }
  if (
    !(await withinRateLimit(db, `draft:${userId}`, {
      max: CHANGES_PER_MINUTE,
      windowMs: 60_000,
    }))
  ) {
    return refuse(c, "rate_limited");
  }
  const which = `recipe_draft.user_id = ?1 and recipe_draft.recipe_id = ?2
    and (?3 is null or recipe_draft.edited_at <= ?3 or recipe_draft.device_edited_at = ?4)`;
  const hold = holdDraftPhotos(which, [userId, recipeId, upTo, exactly], now);
  const d1 = db.$client;
  const [, removed] = await d1.batch([
    d1.prepare(hold.sql).bind(...hold.params),
    d1
      .prepare(`delete from recipe_draft where ${which} returning recipe_id`)
      .bind(userId, recipeId, upTo, exactly),
  ]);
  return c.json({ ok: true, removed: (removed?.results ?? []).length > 0 });
});
