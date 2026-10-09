import type {
  Category,
  Recipe,
  RecipeContent,
  RecipeCategory,
  RecipeMade,
  RecipeOpinion,
  RecipePhoto,
} from "../../shared/recipe";
import type { CategoryFields, PullResponse, SyncChange } from "../../shared/sync";

// What the browser keeps (phase C4). Every synced row is a "record": the last copy the server
// sent, plus the changes made here that the server hasn't confirmed yet, applied on top. What
// people see is that combination. When the server sends a newer copy, the pending changes are
// applied to it again, so nothing typed here is lost while it waits to be sent.

export type RecordKind = "recipe" | "opinion" | "made" | "category" | "recipeCategory" | "photo";

export type RecordValue =
  Recipe | RecipeOpinion | RecipeMade | Category | RecipeCategory | RecipePhoto;

/** Who is working here, and how to find a recipe's owner (for opinions, links and "made it"). */
export interface ApplyContext {
  userId: string;
  now: string;
  ownerOf(recipeId: string): string | null;
}

/** Which record a change is about: its kind and key. Opinions are the caller's own. */
export function recordOf(change: SyncChange, userId: string): { kind: RecordKind; key: string } {
  switch (change.kind) {
    case "recipe":
      return { kind: "recipe", key: change.id };
    case "opinion":
      return { kind: "opinion", key: `${change.recipeId}|${userId}` };
    case "made":
      return { kind: "made", key: change.id };
    case "category":
      return { kind: "category", key: change.id };
    case "recipeCategory":
      return { kind: "recipeCategory", key: `${change.recipeId}|${change.categoryId}` };
    case "photo":
      return { kind: "photo", key: change.id };
  }
}

/** The key of a record the server sent. */
export function keyOf(kind: RecordKind, value: RecordValue): string {
  switch (kind) {
    case "opinion": {
      const o = value as RecipeOpinion;
      return `${o.recipeId}|${o.userId}`;
    }
    case "recipeCategory": {
      const l = value as RecipeCategory;
      return `${l.recipeId}|${l.categoryId}`;
    }
    default:
      return (value as { id: string }).id;
  }
}

/** The server's rows in a pull, by kind. */
export function pulledRecords(page: PullResponse): { kind: RecordKind; value: RecordValue }[] {
  return [
    ...page.recipes.map((value) => ({ kind: "recipe" as const, value })),
    ...page.categories.map((value) => ({ kind: "category" as const, value })),
    ...page.opinions.map((value) => ({ kind: "opinion" as const, value })),
    ...page.made.map((value) => ({ kind: "made" as const, value })),
    ...page.recipeCategories.map((value) => ({ kind: "recipeCategory" as const, value })),
    ...(page.photos ?? []).map((value) => ({ kind: "photo" as const, value })),
  ];
}

/** The owner of a record: the recipe's owner for opinions, links, "made it" and photos. */
export function ownerOfRecord(kind: RecordKind, value: RecordValue, ctx: ApplyContext): string {
  if (kind === "recipe" || kind === "category") return (value as Recipe | Category).ownerUserId;
  return ctx.ownerOf((value as { recipeId: string }).recipeId) ?? "";
}

const unsynced = (now: string) => ({ updatedAt: now, serverSeq: 0 });

/**
 * One change applied to a record (null: no record yet). Returns the new record, or null when
 * the change doesn't make one (an edit of something not here).
 */
export function applyChange(
  current: RecordValue | null,
  change: SyncChange,
  ctx: ApplyContext,
): RecordValue | null {
  const deletedAt = (deleted: boolean | undefined, was: string | null) =>
    deleted === undefined ? was : deleted ? ctx.now : null;
  switch (change.kind) {
    case "recipe": {
      const base = current as Recipe | null;
      if (!base) {
        if (!change.create) return null;
        return {
          id: change.id,
          ownerUserId: ctx.userId,
          updatedByUserId: ctx.userId,
          createdAt: change.create.createdAt,
          copiedFrom: null,
          import: change.create.import,
          ...(change.fields as RecipeContent),
          deletedAt: deletedAt(change.deleted, null),
          ...unsynced(ctx.now),
        };
      }
      return {
        ...base,
        ...change.fields,
        updatedByUserId: ctx.userId,
        updatedAt: ctx.now,
        deletedAt: deletedAt(change.deleted, base.deletedAt),
      };
    }
    case "opinion": {
      const base = (current as RecipeOpinion | null) ?? {
        recipeId: change.recipeId,
        userId: ctx.userId,
        rating: null,
        favorite: false,
        note: "",
        deletedAt: null,
        ...unsynced(ctx.now),
      };
      return { ...base, ...change.fields, updatedAt: ctx.now };
    }
    case "made": {
      const base = current as RecipeMade | null;
      if (change.deleted) return base ? { ...base, deletedAt: ctx.now, updatedAt: ctx.now } : null;
      return (
        base ?? {
          id: change.id,
          recipeId: change.recipeId,
          userId: ctx.userId,
          madeOn: change.madeOn,
          deletedAt: null,
          ...unsynced(ctx.now),
        }
      );
    }
    case "category": {
      const base = current as Category | null;
      if (!base) {
        if (!change.create) return null;
        return {
          id: change.id,
          ownerUserId: change.create.ownerUserId ?? ctx.userId,
          ...(change.fields as CategoryFields),
          deletedAt: deletedAt(change.deleted, null),
          ...unsynced(ctx.now),
        };
      }
      return {
        ...base,
        ...change.fields,
        updatedAt: ctx.now,
        deletedAt: deletedAt(change.deleted, base.deletedAt),
      };
    }
    case "recipeCategory": {
      const base = current as RecipeCategory | null;
      return {
        recipeId: change.recipeId,
        categoryId: change.categoryId,
        ...(base ?? unsynced(ctx.now)),
        updatedAt: ctx.now,
        deletedAt: change.deleted ? ctx.now : null,
      };
    }
    case "photo": {
      const base = current as RecipePhoto | null;
      if (!base) {
        if (!change.create) return null;
        return {
          id: change.id,
          recipeId: change.recipeId,
          ...change.create,
          sortOrder: change.fields.sortOrder ?? 0,
          addedByUserId: ctx.userId,
          deletedAt: deletedAt(change.deleted, null),
          ...unsynced(ctx.now),
        };
      }
      return {
        ...base,
        ...change.fields,
        updatedAt: ctx.now,
        deletedAt: deletedAt(change.deleted, base.deletedAt),
      };
    }
  }
}

/** The server's copy with the waiting changes applied, in the order they were made. */
export function withPending(
  server: RecordValue | null,
  pending: SyncChange[],
  ctx: ApplyContext,
): RecordValue | null {
  return pending.reduce<RecordValue | null>(
    (record, change) => applyChange(record, change, ctx),
    server,
  );
}

/**
 * Without offline editing, changes go out as made when sent (app/sync/engine.ts pushBody). They
 * keep their order, a millisecond apart, so the later of two changes to one field wins.
 */
export function stampedAsSent(changes: SyncChange[], sentAt: number): SyncChange[] {
  return changes.map((change, i) => ({ ...change, changedAt: sentAt - (changes.length - 1 - i) }));
}

/** Splits waiting changes into pushes that fit the protocol's sizes. */
export function batches<T extends { change: SyncChange }>(
  entries: T[],
  maxChanges: number,
  maxBytes: number,
): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = JSON.stringify(entry.change).length + 1;
    if (current.length > 0 && (current.length >= maxChanges || bytes + size > maxBytes)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}
