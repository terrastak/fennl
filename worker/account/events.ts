import type { Context } from "hono";
import { lt } from "drizzle-orm";
import {
  ACCOUNT_EVENT_DAYS,
  type AccountEventDetailsByKind,
  type AccountEventKind,
  type LimitRefusedDetails,
} from "../../shared/accountEvents";
import { deviceLabel } from "../../shared/devices";
import { database, type Database } from "../db/client";
import { accountEvent } from "../db/schema";

// Recording what happened on an account that no other table keeps (U15; shared/accountEvents.ts),
// for the admin console's account page. Every write is one conditional statement (a cap or a
// once-an-hour rule inside it), runs after the answer is sent (inBackground), and is never made
// while an admin acts as the person: their changes are in the admin log already.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** At most this many failed sign-ins, failed imports or sign-ins per person per hour. */
export const EVENTS_PER_HOUR = 50;

/**
 * Runs a recording after the answer is sent (the Worker's waitUntil), so it never slows or changes
 * the answer. Where there's no execution context (tests calling app.request), it's awaited.
 * A failure is logged, never thrown.
 */
export function inBackground(c: Context, task: Promise<unknown>): Promise<void> | undefined {
  const safe = task.then(
    () => undefined,
    (error: unknown) => console.error("Account event not recorded", error),
  );
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx as ExecutionContext;
  } catch {
    ctx = undefined;
  }
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(safe);
    return undefined;
  }
  return safe;
}

/**
 * One event, unless the person already has `cap` of this kind in the last hour. One statement,
 * so two at once can't both slip past the cap by much.
 */
export async function recordAccountEvent<K extends AccountEventKind>(
  db: Database,
  userId: string,
  kind: K,
  details: AccountEventDetailsByKind[K],
  now = Date.now(),
  cap = EVENTS_PER_HOUR,
): Promise<void> {
  await db.$client
    .prepare(
      `insert into account_event (id, user_id, kind, details, created_at)
       select ?1, ?2, ?3, ?4, ?5
       where exists (select 1 from user where id = ?2)
         and (select count(*) from account_event
              where user_id = ?2 and kind = ?3 and created_at > ?5 - ?6) < ?7`,
    )
    .bind(crypto.randomUUID(), userId, kind, JSON.stringify(details), now, HOUR_MS, cap)
    .run();
}

/** At most this many refused recipes' ids are kept on one refusal line. */
const RECIPE_IDS_KEPT = 500;

/**
 * Things refused because of a limit: at most one row per person per limit per hour, so a push
 * refusing 200 changes, or a browser asking again on every start, leaves one line.
 *
 * A new recipe turned away by sync stays in the device's outbox and is sent again each time the
 * app starts (app/sync/engine.ts), so its id is kept with the line (`recipeIds`): a push whose
 * refused recipes were all refused before is the same refusal again and adds nothing, so the
 * account page's "can't add" doesn't come back after being marked handled.
 */
export async function recordLimitRefusals(
  db: Database,
  userId: string,
  refusals: LimitRefusedDetails[],
  now = Date.now(),
): Promise<void> {
  const byLimit = new Map<
    string,
    { details: LimitRefusedDetails; ids: string[]; fresh: boolean }
  >();
  for (const refusal of refusals) {
    const ids = refusal.recipeIds ?? [];
    const group = byLimit.get(refusal.limit);
    if (group) {
      group.ids.push(...ids);
      group.fresh ||= ids.length === 0;
    } else {
      byLimit.set(refusal.limit, { details: refusal, ids: [...ids], fresh: ids.length === 0 });
    }
  }
  if (byLimit.size === 0) return;
  const d1 = db.$client;
  const statements = [...byLimit.values()].flatMap(({ details, ids, fresh }) => {
    const recipeIds = [...new Set(ids)].slice(0, RECIPE_IDS_KEPT);
    const stored: LimitRefusedDetails = { ...details };
    if (recipeIds.length > 0) stored.recipeIds = recipeIds;
    else delete stored.recipeIds;
    const idsJson = JSON.stringify(recipeIds);
    const insert = d1
      .prepare(
        `insert into account_event (id, user_id, kind, details, created_at)
         select ?1, ?2, 'limit_refused', ?3, ?4
         where exists (select 1 from user where id = ?2)
           and not exists (
             select 1 from account_event
             where user_id = ?2 and kind = 'limit_refused'
               and json_extract(details, '$.limit') = ?5 and created_at > ?4 - ?6)
           and (?7 or exists (
             select 1 from json_each(?8) as t
             where not exists (
               select 1 from account_event e, json_each(e.details, '$.recipeIds') as s
               where e.user_id = ?2 and e.kind = 'limit_refused' and s.value = t.value)))`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        JSON.stringify(stored),
        now,
        details.limit,
        HOUR_MS,
        fresh ? 1 : 0,
        idsJson,
      );
    if (recipeIds.length === 0) return [insert];
    // The ids join the newest line for this limit, so a recipe refused within the same hour as
    // another (no new line) is still known when it's sent again.
    const remember = d1
      .prepare(
        `update account_event
         set details = json_set(details, '$.recipeIds', json((
           select json_group_array(value) from (
             select value from json_each(account_event.details, '$.recipeIds')
             union
             select value from json_each(?3)
             limit ?4))))
         where id = (
           select id from account_event
           where user_id = ?1 and kind = 'limit_refused' and json_extract(details, '$.limit') = ?2
           order by created_at desc limit 1)`,
      )
      .bind(userId, details.limit, idsJson, RECIPE_IDS_KEPT);
    return [insert, remember];
  });
  await d1.batch(statements);
}

/**
 * A sign-in refused for a wrong password, against the account whose address was typed (matched as
 * Better Auth matches it: lower case, nothing else). Nothing is written for an address no account
 * has. Only the time and the browser are kept, and whether the account has a password at all.
 */
export async function recordFailedSignIn(
  db: Database,
  typedEmail: string,
  browser: string,
  now = Date.now(),
): Promise<void> {
  await db.$client
    .prepare(
      `insert into account_event (id, user_id, kind, details, created_at)
       select ?1, u.id, 'sign_in_failed',
              json_object('browser', ?2, 'hasPassword', json(case when exists (
                select 1 from account a where a.user_id = u.id and a.provider_id = 'credential'
              ) then 'true' else 'false' end)),
              ?3
       from user u
       where u.email = ?4
         and (select count(*) from account_event e
              where e.user_id = u.id and e.kind = 'sign_in_failed' and e.created_at > ?3 - ?5) < ?6`,
    )
    .bind(crypto.randomUUID(), browser, now, typedEmail.toLowerCase(), HOUR_MS, EVENTS_PER_HOUR)
    .run();
}

/**
 * From Better Auth's answer to /api/auth/sign-in/email (worker/index.ts): a 401 for a wrong
 * password (or a password tried on an account without one) is kept against the address typed.
 * Too many tries (429) and anything else aren't.
 */
export async function recordFailedSignInFrom(
  env: Env,
  request: Request,
  response: Response,
  now = Date.now(),
): Promise<void> {
  if (response.status !== 401) return;
  const answer = (await response.json().catch(() => null)) as { code?: unknown } | null;
  if (answer?.code !== "INVALID_EMAIL_OR_PASSWORD") return;
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  if (typeof body?.email !== "string" || body.email.length > 320) return;
  const browser = deviceLabel(request.headers.get("user-agent"));
  await recordFailedSignIn(database(env.DB), body.email, browser, now);
}

/** Removes account events over 90 days old (the hourly job). Returns how many. */
export async function removeOldAccountEvents(db: Database, now = Date.now()): Promise<number> {
  const removed = await db
    .delete(accountEvent)
    .where(lt(accountEvent.createdAt, new Date(now - ACCOUNT_EVENT_DAYS * DAY_MS)))
    .returning({ id: accountEvent.id })
    .all();
  return removed.length;
}
