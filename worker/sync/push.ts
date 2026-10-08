import { eq, inArray } from "drizzle-orm";
import { RECIPE_FIELDS, type RecipeContent, type RecipeField } from "../../shared/recipe";
import type {
  CategoryChange,
  ChangeResult,
  MadeChange,
  OpinionChange,
  RecipeCategoryChange,
  RecipeChange,
  SyncChange,
} from "../../shared/sync";
import type { Database } from "../db/client";
import { category, member, recipe } from "../db/schema";

// Saving the changes a device sends (phase C3). Each change becomes one SQL statement that does
// its own "last change wins" field by field, and all of a push's statements run as one D1 batch
// (a transaction), so nothing reads, decides and then writes on stale data (CLAUDE.md, "Data
// model rules"). The one read before writing is of who owns each recipe and category, which
// never changes, to give a clear answer when a change isn't allowed.

/** Who is pushing, for the statements below. */
export interface PushCaller {
  userId: string;
  householdId: string;
}

export interface Statement {
  sql: string;
  params: unknown[];
}

/** Collects numbered parameters (?1, ?2, ...), so a value used several times is bound once. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value === undefined ? null : value);
    return `?${this.values.length}`;
  }
}

/** The people in the caller's household, as a subquery. */
function members(p: Params, caller: PushCaller): string {
  return `(select user_id from member where organization_id = ${p.add(caller.householdId)})`;
}

/** The server_seq for the k-th statement of a batch; the batch's last statement moves the counter. */
export function seq(k: number): string {
  return `((select value from sync_counter where id = 1) + ${k})`;
}

export function bump(n: number): Statement {
  return { sql: "update sync_counter set value = value + ?1 where id = 1", params: [n] };
}

/** One field kept by "last change wins": its column, its key in field_times, and its value. */
interface Field {
  column: string;
  key: string;
  value: unknown;
}

/**
 * The pieces of an update that keeps each field only if this change is newer than the field's
 * stored time. `table` qualifies column names (needed inside an upsert's DO UPDATE).
 *
 * A row is only touched if some field is both newer and different, so sending the same push
 * again (its answer was lost) changes nothing, even though its times come out a few
 * milliseconds later the second time.
 */
function lastChangeWins(fields: Field[], time: string, table: string) {
  const stored = (key: string) => `coalesce(json_extract(${table}.field_times, '$.${key}'), 0)`;
  // Trash is about whether it's deleted, not exactly when.
  const same = (f: Field) =>
    f.key === "deleted"
      ? `((${table}.${f.column} is null) = (${f.value as string} is null))`
      : `(${table}.${f.column} is ${f.value as string})`;
  return {
    set: fields.map(
      (f) =>
        `${f.column} = case when ${time} > ${stored(f.key)} then ${f.value as string} else ${table}.${f.column} end`,
    ),
    fieldTimes: `field_times = json_set(${table}.field_times, ${fields
      .map((f) => `'$.${f.key}', max(${time}, ${stored(f.key)})`)
      .join(", ")})`,
    newer: `(${fields.map((f) => `(${time} > ${stored(f.key)} and not ${same(f)})`).join(" or ")})`,
  };
}

function fieldTimesObject(keys: string[], time: string): string {
  return `json_object(${keys.map((key) => `'${key}', ${time}`).join(", ")})`;
}

const RECIPE_COLUMNS: Record<RecipeField, { column: string; json: boolean }> = {
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

function recipeFields(p: Params, change: RecipeChange, time: number): Field[] {
  const fields: Field[] = [];
  for (const key of RECIPE_FIELDS) {
    if (!(key in change.fields)) continue;
    const { column, json } = RECIPE_COLUMNS[key];
    const value = change.fields[key as keyof RecipeContent];
    fields.push({
      column,
      key,
      value: p.add(json ? (value === null ? null : JSON.stringify(value)) : value),
    });
  }
  if (change.deleted !== undefined) {
    fields.push({
      column: "deleted_at",
      key: "deleted",
      value: p.add(change.deleted ? time : null),
    });
  }
  return fields;
}

function recipeStatement(
  caller: PushCaller,
  change: RecipeChange,
  time: number,
  now: number,
  k: number,
): Statement {
  const p = new Params();
  const t = p.add(time);
  const fields = recipeFields(p, change, time);
  const who = p.add(caller.userId);
  const at = p.add(now);
  const update = (table: string) => {
    const lww = lastChangeWins(fields, t, table);
    return {
      set: [
        ...lww.set,
        lww.fieldTimes,
        `updated_by_user_id = ${who}`,
        `updated_at = ${at}`,
        `server_seq = ${seq(k)}`,
      ].join(", "),
      newer: lww.newer,
    };
  };
  if (!change.create) {
    const u = update("recipe");
    return {
      sql: `update recipe set ${u.set}
        where id = ${p.add(change.id)} and owner_user_id in ${members(p, caller)}
          and expunged_at is null and ${u.newer}
        returning id`,
      params: p.values,
    };
  }
  const value = (key: string) => fields.find((f) => f.key === key)?.value ?? "null";
  const columns = RECIPE_FIELDS.map((key) => RECIPE_COLUMNS[key].column);
  const u = update("recipe");
  return {
    sql: `insert into recipe (id, owner_user_id, copied_from, ${columns.join(", ")}, import,
        field_times, created_at, updated_by_user_id, updated_at, deleted_at, server_seq)
      select ${p.add(change.id)}, ${who}, null, ${RECIPE_FIELDS.map(value).join(", ")},
        ${p.add(change.create.import ? JSON.stringify(change.create.import) : null)},
        ${fieldTimesObject(
          fields.map((f) => f.key),
          t,
        )},
        ${p.add(Date.parse(change.create.createdAt))}, ${who}, ${at}, ${value("deleted")}, ${seq(k)}
      where true
      on conflict (id) do update set ${u.set}
      where recipe.owner_user_id in ${members(p, caller)} and recipe.expunged_at is null
        and ${u.newer}
      returning id`,
    params: p.values,
  };
}

function opinionStatement(
  caller: PushCaller,
  change: OpinionChange,
  time: number,
  now: number,
  k: number,
): Statement {
  const p = new Params();
  const t = p.add(time);
  const fields: Field[] = [];
  if ("rating" in change.fields) {
    fields.push({ column: "rating", key: "rating", value: p.add(change.fields.rating) });
  }
  if ("favorite" in change.fields) {
    fields.push({
      column: "favorite",
      key: "favorite",
      value: p.add(change.fields.favorite ? 1 : 0),
    });
  }
  if ("note" in change.fields) {
    fields.push({ column: "note", key: "note", value: p.add(change.fields.note) });
  }
  const value = (key: string, fallback: string) =>
    fields.find((f) => f.key === key)?.value ?? fallback;
  const lww = lastChangeWins(fields, t, "recipe_opinion");
  const at = p.add(now);
  const recipeId = p.add(change.recipeId);
  const visible = members(p, caller);
  return {
    sql: `insert into recipe_opinion (recipe_id, user_id, owner_user_id, rating, favorite, note,
        field_times, updated_at, deleted_at, server_seq)
      select r.id, ${p.add(caller.userId)}, r.owner_user_id, ${value("rating", "null")},
        ${value("favorite", "0")}, ${value("note", "''")},
        ${fieldTimesObject(
          fields.map((f) => f.key),
          t,
        )}, ${at}, null, ${seq(k)}
      from recipe r where r.id = ${recipeId} and r.owner_user_id in ${visible}
        and r.expunged_at is null
      on conflict (recipe_id, user_id) do update set
        ${[...lww.set, lww.fieldTimes, `updated_at = ${at}`, `server_seq = ${seq(k)}`].join(", ")}
      where recipe_opinion.owner_user_id in ${visible} and ${lww.newer}
      returning recipe_id`,
    params: p.values,
  };
}

function madeStatement(
  caller: PushCaller,
  change: MadeChange,
  time: number,
  now: number,
  k: number,
): Statement {
  const p = new Params();
  const recipeId = p.add(change.recipeId);
  if (change.deleted) {
    return {
      sql: `update recipe_made set deleted_at = ${p.add(time)}, updated_at = ${p.add(now)},
          server_seq = ${seq(k)}
        where id = ${p.add(change.id)} and recipe_id = ${recipeId} and deleted_at is null
          and owner_user_id in ${members(p, caller)}
        returning id`,
      params: p.values,
    };
  }
  return {
    sql: `insert into recipe_made (id, recipe_id, user_id, owner_user_id, made_on, updated_at,
        deleted_at, server_seq)
      select ${p.add(change.id)}, r.id, ${p.add(caller.userId)}, r.owner_user_id,
        ${p.add(change.madeOn)}, ${p.add(now)}, null, ${seq(k)}
      from recipe r where r.id = ${recipeId} and r.owner_user_id in ${members(p, caller)}
        and r.expunged_at is null
      on conflict (id) do nothing
      returning id`,
    params: p.values,
  };
}

function categoryStatement(
  caller: PushCaller,
  change: CategoryChange,
  owner: string,
  time: number,
  now: number,
  k: number,
): Statement {
  const p = new Params();
  const t = p.add(time);
  const fields: Field[] = [];
  if ("name" in change.fields) {
    fields.push({ column: "name", key: "name", value: p.add(change.fields.name) });
  }
  if ("parentId" in change.fields) {
    fields.push({ column: "parent_id", key: "parentId", value: p.add(change.fields.parentId) });
  }
  if ("sortOrder" in change.fields) {
    fields.push({ column: "sort_order", key: "sortOrder", value: p.add(change.fields.sortOrder) });
  }
  if (change.deleted !== undefined) {
    fields.push({
      column: "deleted_at",
      key: "deleted",
      value: p.add(change.deleted ? time : null),
    });
  }
  const at = p.add(now);
  const visible = members(p, caller);
  const lww = lastChangeWins(fields, t, "category");
  const set = [...lww.set, lww.fieldTimes, `updated_at = ${at}`, `server_seq = ${seq(k)}`].join(
    ", ",
  );
  const id = p.add(change.id);
  if (!change.create) {
    return {
      sql: `update category set ${set}
        where id = ${id} and owner_user_id in ${visible} and ${lww.newer}
        returning id`,
      params: p.values,
    };
  }
  const value = (key: string) => fields.find((f) => f.key === key)?.value ?? "null";
  const ownerParam = p.add(owner);
  return {
    sql: `insert into category (id, owner_user_id, parent_id, name, sort_order, field_times,
        updated_at, deleted_at, server_seq)
      select ${id}, ${ownerParam}, ${value("parentId")}, ${value("name")}, ${value("sortOrder")},
        ${fieldTimesObject(
          fields.map((f) => f.key),
          t,
        )}, ${at}, ${value("deleted")}, ${seq(k)}
      where ${ownerParam} in ${visible}
      on conflict (id) do update set ${set}
      where category.owner_user_id in ${visible} and ${lww.newer}
      returning id`,
    params: p.values,
  };
}

function recipeCategoryStatement(
  caller: PushCaller,
  change: RecipeCategoryChange,
  time: number,
  now: number,
  k: number,
): Statement {
  const p = new Params();
  const t = p.add(time);
  const deletedAt = p.add(change.deleted ? time : null);
  const at = p.add(now);
  const visible = members(p, caller);
  const lww = lastChangeWins(
    [{ column: "deleted_at", key: "deleted", value: deletedAt }],
    t,
    "recipe_category",
  );
  return {
    sql: `insert into recipe_category (recipe_id, category_id, owner_user_id, field_times,
        updated_at, deleted_at, server_seq)
      select r.id, c.id, r.owner_user_id, ${fieldTimesObject(["deleted"], t)}, ${at},
        ${deletedAt}, ${seq(k)}
      from recipe r join category c on c.owner_user_id = r.owner_user_id
      where r.id = ${p.add(change.recipeId)} and c.id = ${p.add(change.categoryId)}
        and r.owner_user_id in ${visible} and r.expunged_at is null
      on conflict (recipe_id, category_id) do update set
        ${[...lww.set, lww.fieldTimes, `updated_at = ${at}`, `server_seq = ${seq(k)}`].join(", ")}
      where recipe_category.owner_user_id in ${visible} and ${lww.newer}
      returning recipe_id`,
    params: p.values,
  };
}

// ---------------------------------------------------------------------------------------------

const CHUNK = 90;

async function owners(
  db: Database,
  table: typeof recipe | typeof category,
  ids: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db
      .select({ id: table.id, owner: table.ownerUserId })
      .from(table)
      .where(inArray(table.id, ids.slice(i, i + CHUNK)))
      .all();
    for (const row of rows) found.set(row.id, row.owner);
  }
  return found;
}

/** The people in a household. */
export async function householdMembers(db: Database, householdId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, householdId))
    .all();
  return rows.map((row) => row.userId);
}

type Planned = { result: ChangeResult } | { build: (k: number) => Statement };

/**
 * Decides, for each change, whether it's allowed, and if so the statement that saves it. Owners
 * are read once up front; changes earlier in the same push (a new recipe, a new category) count.
 */
async function plan(
  db: Database,
  caller: PushCaller,
  changes: SyncChange[],
  times: number[],
  now: number,
): Promise<Planned[]> {
  const recipeIds = new Set<string>();
  const categoryIds = new Set<string>();
  for (const change of changes) {
    if (change.kind === "recipe") recipeIds.add(change.id);
    if (change.kind === "opinion" || change.kind === "made") recipeIds.add(change.recipeId);
    if (change.kind === "category") {
      categoryIds.add(change.id);
      if (change.fields.parentId) categoryIds.add(change.fields.parentId);
    }
    if (change.kind === "recipeCategory") {
      recipeIds.add(change.recipeId);
      categoryIds.add(change.categoryId);
    }
  }
  const [recipeOwner, categoryOwner, people] = await Promise.all([
    owners(db, recipe, [...recipeIds]),
    owners(db, category, [...categoryIds]),
    householdMembers(db, caller.householdId),
  ]);
  const inHousehold = (owner: string | undefined) => owner !== undefined && people.includes(owner);
  const rejected = (reason: "not_found" | "wrong_owner"): Planned => ({
    result: { status: "rejected", reason },
  });

  return changes.map((change, i): Planned => {
    const time = times[i] as number;
    switch (change.kind) {
      case "recipe": {
        if (change.create && !recipeOwner.has(change.id)) recipeOwner.set(change.id, caller.userId);
        if (!inHousehold(recipeOwner.get(change.id))) return rejected("not_found");
        return { build: (k) => recipeStatement(caller, change, time, now, k) };
      }
      case "opinion":
        if (!inHousehold(recipeOwner.get(change.recipeId))) return rejected("not_found");
        return { build: (k) => opinionStatement(caller, change, time, now, k) };
      case "made":
        if (!inHousehold(recipeOwner.get(change.recipeId))) return rejected("not_found");
        return { build: (k) => madeStatement(caller, change, time, now, k) };
      case "category": {
        if (change.create && !categoryOwner.has(change.id)) {
          const owner = change.create.ownerUserId ?? caller.userId;
          if (!inHousehold(owner)) return rejected("not_found");
          categoryOwner.set(change.id, owner);
        }
        const owner = categoryOwner.get(change.id);
        if (!owner || !inHousehold(owner)) return rejected("not_found");
        const parent = change.fields.parentId;
        if (parent) {
          if (!categoryOwner.has(parent)) return rejected("not_found");
          if (categoryOwner.get(parent) !== owner) return rejected("wrong_owner");
        }
        return { build: (k) => categoryStatement(caller, change, owner, time, now, k) };
      }
      case "recipeCategory": {
        const owner = recipeOwner.get(change.recipeId);
        if (!inHousehold(owner) || !categoryOwner.has(change.categoryId)) {
          return rejected("not_found");
        }
        if (categoryOwner.get(change.categoryId) !== owner) return rejected("wrong_owner");
        return { build: (k) => recipeCategoryStatement(caller, change, time, now, k) };
      }
    }
  });
}

function prepare(d1: D1Database, statement: Statement): D1PreparedStatement {
  return d1.prepare(statement.sql).bind(...statement.params);
}

/**
 * Saves a push's changes. `times` are the changes' times already moved onto the server's clock.
 * Returns what became of each change, in the same order.
 */
export async function applyChanges(
  db: Database,
  caller: PushCaller,
  changes: SyncChange[],
  times: number[],
  now = Date.now(),
): Promise<ChangeResult[]> {
  const planned = await plan(db, caller, changes, times, now);
  const results: (ChangeResult | null)[] = planned.map((p) => ("result" in p ? p.result : null));
  const toRun = planned.flatMap((p, i) => ("build" in p ? [{ i, build: p.build }] : []));
  if (toRun.length === 0) return results as ChangeResult[];

  const d1 = db.$client;
  const outcome = (rows: unknown[]): ChangeResult =>
    rows.length > 0 ? { status: "applied" } : { status: "unchanged" };
  try {
    const done = await d1.batch([
      ...toRun.map((run, k) => prepare(d1, run.build(k + 1))),
      prepare(d1, bump(toRun.length)),
    ]);
    toRun.forEach((run, k) => {
      results[run.i] = outcome(done[k]?.results ?? []);
    });
  } catch (error) {
    // One statement failed, so the whole batch was undone. Save the changes one at a time, so
    // only the one that can't be saved is turned away.
    console.error("Sync push batch failed; retrying one by one", error);
    for (const run of toRun) {
      try {
        const [done] = await d1.batch([prepare(d1, run.build(1)), prepare(d1, bump(1))]);
        results[run.i] = outcome(done?.results ?? []);
      } catch (single) {
        console.error("Sync change failed", single);
        results[run.i] = { status: "rejected", reason: "failed" };
      }
    }
  }
  return results as ChangeResult[];
}
