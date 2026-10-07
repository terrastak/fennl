import {
  IMPORT_SOURCES,
  RECIPE_FIELDS,
  RECIPE_RULES,
  RECIPE_SCHEMA_VERSION,
  emptyRecipeContent,
  isCategoryName,
  isId,
  isRating,
  recipeIssues,
  type Category,
  type RecipeCategory,
  type RecipeContent,
  type RecipeImport,
  type RecipeIssue,
  type Recipe,
  type RecipeMade,
  type RecipeOpinion,
} from "./recipe";

/**
 * How devices send and fetch recipe changes (phase C3, CLAUDE.md "Sync architecture"). The
 * server is worker/sync/; the device side is phase C4.
 *
 * Sending: POST /api/sync/push with a list of changes. Each change says when it was made (on the
 * device's clock) and which fields it sets. The server corrects for a wrong device clock (it
 * compares the device's clock with its own when the push arrives) and keeps, field by field, the
 * change made last. It answers, for each change, whether it was kept.
 *
 * Fetching: GET /api/sync/pull with one cursor per person in the household ("everything owned
 * by Brian after change 812"). Answers come in pages; `more` says to ask again.
 */

/** The oldest app version (shared/recipe.ts RECIPE_SCHEMA_VERSION) the server still accepts. */
export const MIN_CLIENT_SCHEMA_VERSION = 1;

/**
 * Sizes of one request: technical bounds of the protocol, the same for every plan. (Plan limits
 * such as recipe counts live in plan_limits and are enforced in phase C11.) A device with more
 * to send splits it over several pushes.
 */
export const SYNC_RULES = {
  /** Changes in one push. */
  changesPerPush: 100,
  /** Bytes in one push. */
  pushBytes: 4 * 1024 * 1024,
  /**
   * Without offline editing (Free), every change in a push must have been made within this long
   * before it was sent: Free saves go to the server straight away and never queue up.
   */
  freeChangeAgeMs: 2 * 60 * 1000,
  /** Rows in one page of a pull, and recipes among them (recipes are the big ones). */
  pullRows: 500,
  pullRecipes: 100,
  /** Roughly how many bytes one page of a pull may hold (at least one row is always sent). */
  pullBytes: 4 * 1024 * 1024,
} as const;

// ---------------------------------------------------------------------------------------------
// Changes a device sends
// ---------------------------------------------------------------------------------------------

interface ChangeBase {
  /** When the change was made, in milliseconds on the device's clock. */
  changedAt: number;
}

/** Creating or editing a recipe, or moving it to Trash and back. */
export interface RecipeChange extends ChangeBase {
  kind: "recipe";
  id: string;
  /** Present for a new recipe, which must then set every field. */
  create?: { createdAt: string; import: RecipeImport | null };
  fields: Partial<RecipeContent>;
  /** True: move to Trash. False: restore from Trash. */
  deleted?: boolean;
}

export type OpinionFields = Pick<RecipeOpinion, "rating" | "favorite" | "note">;
export const OPINION_FIELDS = ["rating", "favorite", "note"] as const;

/** The caller's own rating, favorite or signed note on a recipe. */
export interface OpinionChange extends ChangeBase {
  kind: "opinion";
  recipeId: string;
  fields: Partial<OpinionFields>;
}

/** "Made it" on a day, or taking one back (deleted). */
export interface MadeChange extends ChangeBase {
  kind: "made";
  id: string;
  recipeId: string;
  madeOn: string;
  deleted?: boolean;
}

export type CategoryFields = Pick<Category, "name" | "parentId" | "sortOrder">;
export const CATEGORY_FIELDS = ["name", "parentId", "sortOrder"] as const;

/** Creating, renaming, moving or deleting a category. */
export interface CategoryChange extends ChangeBase {
  kind: "category";
  id: string;
  /**
   * Present for a new category, which must then set every field. ownerUserId: whose category
   * it is, the caller by default. A partner's, when filing a partner's recipe under a category
   * they don't have yet (CLAUDE.md, "Recipe ownership in households").
   */
  create?: { ownerUserId?: string };
  fields: Partial<CategoryFields>;
  deleted?: boolean;
}

/** Filing a recipe under a category (deleted: false) or taking it out (deleted: true). */
export interface RecipeCategoryChange extends ChangeBase {
  kind: "recipeCategory";
  recipeId: string;
  categoryId: string;
  deleted: boolean;
}

export type SyncChange =
  RecipeChange | OpinionChange | MadeChange | CategoryChange | RecipeCategoryChange;

export interface PushRequest {
  deviceId: string;
  schemaVersion: number;
  /** When the device sent this, on its own clock (for correcting its clock). */
  sentAt: number;
  changes: SyncChange[];
}

/**
 * What became of one change:
 * - applied: kept (at least one of its fields was newer than the server's).
 * - unchanged: the server already had this or something newer; fetch to see it.
 * - rejected: not allowed or not valid; it will never be kept, so the device drops it.
 *   not_found: no such recipe or category in the caller's household (or never was).
 *   wrong_owner: a category belonging to someone other than the recipe's owner.
 *   invalid: see issues.
 *   failed: the server couldn't save it; send it again later.
 */
export type ChangeResult =
  | { status: "applied" }
  | { status: "unchanged" }
  | { status: "rejected"; reason: "not_found" | "wrong_owner" | "failed" }
  | { status: "rejected"; reason: "invalid"; issues: RecipeIssue[] };

export interface PushResponse {
  results: ChangeResult[];
}

/** Errors for a whole push or pull (with the HTTP status the server uses). */
export type SyncError =
  | "invalid_request" // 400
  | "device_not_registered" // 403: register the device first (B6)
  | "device_revoked" // 403: this browser was signed out or replaced
  | "offline_not_allowed" // 403: queued changes without offline editing (Free)
  | "upgrade_required" // 409: the app is too old; reload it
  | "server_behind" // 409: the app is newer than the server; try again shortly
  | "too_many_changes" // 413
  | "too_large"; // 413

// ---------------------------------------------------------------------------------------------
// What a device fetches
// ---------------------------------------------------------------------------------------------

/** Where a device is up to, per owner: { [userId]: last server_seq it has }. */
export type Cursors = Record<string, number>;

export interface PullResponse {
  /** The people whose recipes the caller can see. Drop local rows owned by anyone else. */
  members: { userId: string; name: string }[];
  recipes: Recipe[];
  opinions: RecipeOpinion[];
  made: RecipeMade[];
  categories: Category[];
  recipeCategories: RecipeCategory[];
  /** Send these back next time. An owner missing from the request starts at 0. */
  cursors: Cursors;
  /** More changes are waiting: ask again straight away. */
  more: boolean;
}

/** Cursors as the pull's `since` parameter: "userA:812,userB:0". */
export function formatCursors(cursors: Cursors): string {
  return Object.entries(cursors)
    .map(([userId, seq]) => `${userId}:${seq}`)
    .join(",");
}

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Reads `since`; null if it's malformed. */
export function parseCursors(value: string | undefined): Cursors | null {
  const cursors: Cursors = {};
  if (!value) return cursors;
  for (const part of value.split(",")) {
    const [userId, seq, extra] = part.split(":");
    const n = Number(seq);
    if (extra !== undefined || !userId || !USER_ID.test(userId)) return null;
    if (!Number.isSafeInteger(n) || n < 0) return null;
    cursors[userId] = n;
  }
  return cursors;
}

// ---------------------------------------------------------------------------------------------
// Checking what a device sent
// ---------------------------------------------------------------------------------------------

export type Checked<T> = { ok: true; value: T } | { ok: false; issues: RecipeIssue[] };

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** "2026-10-03", a real day. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Only these keys, at least one of them. */
function fieldKeys(fields: unknown, allowed: readonly string[], issues: RecipeIssue[]): string[] {
  if (!isObject(fields)) {
    issues.push({ path: "fields", problem: "invalid" });
    return [];
  }
  const keys = Object.keys(fields);
  for (const key of keys) {
    if (!allowed.includes(key)) issues.push({ path: `fields.${key}`, problem: "invalid" });
  }
  return keys.filter((key) => allowed.includes(key));
}

function isImport(value: unknown): value is RecipeImport | null {
  if (value === null) return true;
  if (!isObject(value)) return false;
  const optionalText = (v: unknown) =>
    v === null || (typeof v === "string" && v.length <= RECIPE_RULES.urlLength);
  return (
    typeof value.source === "string" &&
    (IMPORT_SOURCES as readonly string[]).includes(value.source) &&
    optionalText(value.importJobId) &&
    optionalText(value.externalId) &&
    optionalText(value.externalHash) &&
    isIsoDate(value.importedAt)
  );
}

function checkRecipe(change: Fields, issues: RecipeIssue[]): RecipeChange | null {
  if (!isId(change.id)) issues.push({ path: "id", problem: "invalid" });
  const keys = fieldKeys(change.fields, RECIPE_FIELDS, issues);
  const fields = (isObject(change.fields) ? change.fields : {}) as Partial<RecipeContent>;
  // Each field is checked with the recipe rules, on its own (the others may be on the server).
  const probe = { ...emptyRecipeContent(), title: "-", ...fields };
  for (const issue of recipeIssues(probe, null)) {
    if (keys.some((key) => issue.path === key || issue.path.startsWith(`${key}.`))) {
      issues.push({ ...issue, path: `fields.${issue.path}` });
    }
  }
  if (change.deleted !== undefined && typeof change.deleted !== "boolean") {
    issues.push({ path: "deleted", problem: "invalid" });
  }
  let create: RecipeChange["create"];
  if (change.create !== undefined) {
    const c = change.create;
    if (!isObject(c) || !isIsoDate(c.createdAt) || !isImport(c.import)) {
      issues.push({ path: "create", problem: "invalid" });
    } else {
      create = { createdAt: c.createdAt, import: c.import };
      for (const key of RECIPE_FIELDS) {
        if (!keys.includes(key)) issues.push({ path: `fields.${key}`, problem: "missing" });
      }
    }
  } else if (keys.length === 0 && change.deleted === undefined) {
    issues.push({ path: "fields", problem: "missing" });
  }
  if (issues.length > 0) return null;
  return {
    kind: "recipe",
    id: change.id as string,
    ...(create ? { create } : {}),
    fields,
    ...(change.deleted !== undefined ? { deleted: change.deleted as boolean } : {}),
    changedAt: change.changedAt as number,
  };
}

function checkOpinion(change: Fields, issues: RecipeIssue[]): OpinionChange | null {
  if (!isId(change.recipeId)) issues.push({ path: "recipeId", problem: "invalid" });
  const keys = fieldKeys(change.fields, OPINION_FIELDS, issues);
  if (keys.length === 0) issues.push({ path: "fields", problem: "missing" });
  const fields = (isObject(change.fields) ? change.fields : {}) as Partial<OpinionFields>;
  if ("rating" in fields && !isRating(fields.rating)) {
    issues.push({ path: "fields.rating", problem: "invalid" });
  }
  if ("favorite" in fields && typeof fields.favorite !== "boolean") {
    issues.push({ path: "fields.favorite", problem: "invalid" });
  }
  if ("note" in fields) {
    if (typeof fields.note !== "string") issues.push({ path: "fields.note", problem: "invalid" });
    else if (fields.note.length > RECIPE_RULES.notesLength) {
      issues.push({ path: "fields.note", problem: "too_long" });
    }
  }
  if (issues.length > 0) return null;
  return {
    kind: "opinion",
    recipeId: change.recipeId as string,
    fields,
    changedAt: change.changedAt as number,
  };
}

function checkMade(change: Fields, issues: RecipeIssue[]): MadeChange | null {
  if (!isId(change.id)) issues.push({ path: "id", problem: "invalid" });
  if (!isId(change.recipeId)) issues.push({ path: "recipeId", problem: "invalid" });
  if (!isDay(change.madeOn)) issues.push({ path: "madeOn", problem: "invalid" });
  if (change.deleted !== undefined && typeof change.deleted !== "boolean") {
    issues.push({ path: "deleted", problem: "invalid" });
  }
  if (issues.length > 0) return null;
  return {
    kind: "made",
    id: change.id as string,
    recipeId: change.recipeId as string,
    madeOn: change.madeOn as string,
    ...(change.deleted !== undefined ? { deleted: change.deleted as boolean } : {}),
    changedAt: change.changedAt as number,
  };
}

function checkCategory(change: Fields, issues: RecipeIssue[]): CategoryChange | null {
  if (!isId(change.id)) issues.push({ path: "id", problem: "invalid" });
  const keys = fieldKeys(change.fields, CATEGORY_FIELDS, issues);
  const fields = (isObject(change.fields) ? change.fields : {}) as Partial<CategoryFields>;
  if ("name" in fields && !isCategoryName(fields.name)) {
    issues.push({ path: "fields.name", problem: "invalid" });
  }
  if (
    "parentId" in fields &&
    fields.parentId !== null &&
    (!isId(fields.parentId) || fields.parentId === change.id)
  ) {
    issues.push({ path: "fields.parentId", problem: "invalid" });
  }
  if (
    "sortOrder" in fields &&
    !(Number.isSafeInteger(fields.sortOrder) && Math.abs(fields.sortOrder as number) <= 1e9)
  ) {
    issues.push({ path: "fields.sortOrder", problem: "invalid" });
  }
  if (change.deleted !== undefined && typeof change.deleted !== "boolean") {
    issues.push({ path: "deleted", problem: "invalid" });
  }
  let create: CategoryChange["create"];
  if (change.create !== undefined) {
    const c = change.create;
    const owner = isObject(c) ? c.ownerUserId : undefined;
    if (
      !isObject(c) ||
      (owner !== undefined && (typeof owner !== "string" || !USER_ID.test(owner)))
    ) {
      issues.push({ path: "create", problem: "invalid" });
    } else {
      create = owner === undefined ? {} : { ownerUserId: owner as string };
      for (const key of CATEGORY_FIELDS) {
        if (!keys.includes(key)) issues.push({ path: `fields.${key}`, problem: "missing" });
      }
    }
  } else if (keys.length === 0 && change.deleted === undefined) {
    issues.push({ path: "fields", problem: "missing" });
  }
  if (issues.length > 0) return null;
  return {
    kind: "category",
    id: change.id as string,
    ...(create ? { create } : {}),
    fields,
    ...(change.deleted !== undefined ? { deleted: change.deleted as boolean } : {}),
    changedAt: change.changedAt as number,
  };
}

function checkRecipeCategory(change: Fields, issues: RecipeIssue[]): RecipeCategoryChange | null {
  if (!isId(change.recipeId)) issues.push({ path: "recipeId", problem: "invalid" });
  if (!isId(change.categoryId)) issues.push({ path: "categoryId", problem: "invalid" });
  if (typeof change.deleted !== "boolean") issues.push({ path: "deleted", problem: "invalid" });
  if (issues.length > 0) return null;
  return {
    kind: "recipeCategory",
    recipeId: change.recipeId as string,
    categoryId: change.categoryId as string,
    deleted: change.deleted as boolean,
    changedAt: change.changedAt as number,
  };
}

/** Checks one change from a push. Every problem is reported, by path. */
export function checkChange(value: unknown): Checked<SyncChange> {
  if (!isObject(value)) return { ok: false, issues: [{ path: "", problem: "invalid" }] };
  const issues: RecipeIssue[] = [];
  if (!isTime(value.changedAt)) issues.push({ path: "changedAt", problem: "invalid" });
  const check = {
    recipe: checkRecipe,
    opinion: checkOpinion,
    made: checkMade,
    category: checkCategory,
    recipeCategory: checkRecipeCategory,
  }[value.kind as SyncChange["kind"]] as
    ((change: Fields, issues: RecipeIssue[]) => SyncChange | null) | undefined;
  if (!check) return { ok: false, issues: [{ path: "kind", problem: "invalid" }] };
  const change = check(value, issues);
  return change && issues.length === 0 ? { ok: true, value: change } : { ok: false, issues };
}

/** The outside of a push (the changes inside are checked one by one with checkChange). */
export function checkPushEnvelope(
  value: unknown,
): { ok: true; value: Omit<PushRequest, "changes"> & { changes: unknown[] } } | { ok: false } {
  if (!isObject(value)) return { ok: false };
  const { deviceId, schemaVersion, sentAt, changes } = value;
  if (
    typeof deviceId !== "string" ||
    !Number.isSafeInteger(schemaVersion) ||
    !isTime(sentAt) ||
    !Array.isArray(changes)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: { deviceId, schemaVersion: schemaVersion as number, sentAt, changes },
  };
}

/** Whether an app sending this schema version can sync, or what it should do instead. */
export function schemaVersionProblem(version: number): "upgrade_required" | "server_behind" | null {
  if (version < MIN_CLIENT_SCHEMA_VERSION) return "upgrade_required";
  if (version > RECIPE_SCHEMA_VERSION) return "server_behind";
  return null;
}
