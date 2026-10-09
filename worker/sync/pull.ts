import { and, asc, eq, gt } from "drizzle-orm";
import type {
  Category,
  Difficulty,
  Recipe,
  RecipeCategory,
  RecipeMade,
  RecipeOpinion,
  RecipePhoto,
  PhotoRole,
} from "../../shared/recipe";
import { SYNC_RULES, type Cursors, type PullResponse } from "../../shared/sync";
import type { Database } from "../db/client";
import {
  category,
  member,
  recipe,
  recipeCategory,
  recipeMade,
  recipeOpinion,
  recipePhoto,
  user,
} from "../db/schema";

// Handing out changes (phase C3). Data is owned per person and a household only grants
// visibility, so a device keeps one cursor per person in its household and asks for "everything
// owned by X after N" (CLAUDE.md, "Data model rules"). Someone who just joined has no cursor yet
// and starts from 0; someone who left is no longer in `members`, and devices drop their rows.

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function sync(row: { updatedAt: Date; deletedAt: Date | null; serverSeq: number }) {
  return {
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
    serverSeq: row.serverSeq,
  };
}

export function toRecipe(row: typeof recipe.$inferSelect): Recipe {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    updatedByUserId: row.updatedByUserId ?? row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    copiedFrom: row.copiedFrom,
    import: row.import ? (JSON.parse(row.import) as Recipe["import"]) : null,
    title: row.title,
    description: row.description,
    ingredients: JSON.parse(row.ingredients) as Recipe["ingredients"],
    directions: JSON.parse(row.directions) as Recipe["directions"],
    times: JSON.parse(row.times) as Recipe["times"],
    servings: JSON.parse(row.servings) as Recipe["servings"],
    source: JSON.parse(row.source) as Recipe["source"],
    notes: row.notes,
    difficulty: row.difficulty as Difficulty | null,
    difficultyText: row.difficultyText,
    nutrition: row.nutrition ? (JSON.parse(row.nutrition) as Recipe["nutrition"]) : null,
    expungedAt: iso(row.expungedAt),
    ...sync(row),
  };
}

function toOpinion(row: typeof recipeOpinion.$inferSelect): RecipeOpinion {
  return {
    recipeId: row.recipeId,
    userId: row.userId,
    rating: row.rating,
    favorite: row.favorite,
    note: row.note,
    ...sync(row),
  };
}

function toMade(row: typeof recipeMade.$inferSelect): RecipeMade {
  return {
    id: row.id,
    recipeId: row.recipeId,
    userId: row.userId,
    madeOn: row.madeOn,
    ...sync(row),
  };
}

function toCategory(row: typeof category.$inferSelect): Category {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    parentId: row.parentId,
    name: row.name,
    sortOrder: row.sortOrder,
    ...sync(row),
  };
}

function toRecipeCategory(row: typeof recipeCategory.$inferSelect): RecipeCategory {
  return { recipeId: row.recipeId, categoryId: row.categoryId, ...sync(row) };
}

function toPhoto(row: typeof recipePhoto.$inferSelect): RecipePhoto {
  return {
    id: row.id,
    recipeId: row.recipeId,
    imageHash: row.imageHash,
    role: row.role as PhotoRole,
    width: row.width,
    height: row.height,
    sortOrder: row.sortOrder,
    addedByUserId: row.addedByUserId,
    ...sync(row),
  };
}

type Item =
  | { kind: "recipes"; seq: number; value: Recipe }
  | { kind: "opinions"; seq: number; value: RecipeOpinion }
  | { kind: "made"; seq: number; value: RecipeMade }
  | { kind: "categories"; seq: number; value: Category }
  | { kind: "recipeCategories"; seq: number; value: RecipeCategory }
  | { kind: "photos"; seq: number; value: RecipePhoto };

/** One owner's changes after `after`, in order, and whether there may be more than these. */
async function changesFor(
  db: Database,
  owner: string,
  after: number,
): Promise<{ items: Item[]; complete: boolean }> {
  const rows = SYNC_RULES.pullRows;
  const [recipes, opinions, made, categories, links, photos] = await db.batch([
    db
      .select()
      .from(recipe)
      .where(and(eq(recipe.ownerUserId, owner), gt(recipe.serverSeq, after)))
      .orderBy(asc(recipe.serverSeq))
      .limit(SYNC_RULES.pullRecipes),
    db
      .select()
      .from(recipeOpinion)
      .where(and(eq(recipeOpinion.ownerUserId, owner), gt(recipeOpinion.serverSeq, after)))
      .orderBy(asc(recipeOpinion.serverSeq))
      .limit(rows),
    db
      .select()
      .from(recipeMade)
      .where(and(eq(recipeMade.ownerUserId, owner), gt(recipeMade.serverSeq, after)))
      .orderBy(asc(recipeMade.serverSeq))
      .limit(rows),
    db
      .select()
      .from(category)
      .where(and(eq(category.ownerUserId, owner), gt(category.serverSeq, after)))
      .orderBy(asc(category.serverSeq))
      .limit(rows),
    db
      .select()
      .from(recipeCategory)
      .where(and(eq(recipeCategory.ownerUserId, owner), gt(recipeCategory.serverSeq, after)))
      .orderBy(asc(recipeCategory.serverSeq))
      .limit(rows),
    db
      .select()
      .from(recipePhoto)
      .where(and(eq(recipePhoto.ownerUserId, owner), gt(recipePhoto.serverSeq, after)))
      .orderBy(asc(recipePhoto.serverSeq))
      .limit(rows),
  ]);

  // A table that filled its page may have more after its last row, so only rows up to the
  // earliest such "last row" are certainly in order with everything else.
  let horizon = Infinity;
  const full = (list: { serverSeq: number }[], limit: number) => {
    const last = list[list.length - 1];
    if (list.length === limit && last) horizon = Math.min(horizon, last.serverSeq);
  };
  full(recipes, SYNC_RULES.pullRecipes);
  full(opinions, rows);
  full(made, rows);
  full(categories, rows);
  full(links, rows);
  full(photos, rows);

  const items: Item[] = [
    ...recipes.map((r): Item => ({ kind: "recipes", seq: r.serverSeq, value: toRecipe(r) })),
    ...opinions.map((r): Item => ({ kind: "opinions", seq: r.serverSeq, value: toOpinion(r) })),
    ...made.map((r): Item => ({ kind: "made", seq: r.serverSeq, value: toMade(r) })),
    ...categories.map((r): Item => ({
      kind: "categories",
      seq: r.serverSeq,
      value: toCategory(r),
    })),
    ...links.map((r): Item => ({
      kind: "recipeCategories",
      seq: r.serverSeq,
      value: toRecipeCategory(r),
    })),
    ...photos.map((r): Item => ({ kind: "photos", seq: r.serverSeq, value: toPhoto(r) })),
  ]
    .filter((item) => item.seq <= horizon)
    .sort((a, b) => a.seq - b.seq);
  return { items, complete: horizon === Infinity };
}

/** The household's members, with names, the caller first. */
export async function householdPeople(
  db: Database,
  householdId: string,
  callerId: string,
): Promise<PullResponse["members"]> {
  const rows = await db
    .select({ userId: member.userId, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, householdId))
    .all();
  return rows.sort((a, b) => Number(b.userId === callerId) - Number(a.userId === callerId));
}

/**
 * One page of changes for the caller's household. `since` holds the device's cursors; cursors
 * for people not in the household are ignored.
 */
export async function pullChanges(
  db: Database,
  householdId: string,
  callerId: string,
  since: Cursors,
): Promise<Omit<PullResponse, "usage">> {
  const members = await householdPeople(db, householdId, callerId);
  const page: Omit<PullResponse, "usage"> = {
    members,
    recipes: [],
    opinions: [],
    made: [],
    categories: [],
    recipeCategories: [],
    photos: [],
    cursors: Object.fromEntries(members.map((m) => [m.userId, since[m.userId] ?? 0])),
    more: false,
  };
  let count = 0;
  let bytes = 0;
  for (const { userId } of members) {
    if (count >= SYNC_RULES.pullRows || bytes >= SYNC_RULES.pullBytes) {
      page.more = true;
      break;
    }
    const { items, complete } = await changesFor(db, userId, page.cursors[userId] ?? 0);
    let taken = 0;
    for (const item of items) {
      const size = JSON.stringify(item.value).length;
      // Always send at least one row, however big, so a device never gets stuck.
      if (count > 0 && (count >= SYNC_RULES.pullRows || bytes + size > SYNC_RULES.pullBytes)) break;
      (page[item.kind] as unknown[]).push(item.value);
      page.cursors[userId] = item.seq;
      count += 1;
      bytes += size;
      taken += 1;
    }
    if (taken < items.length || !complete) {
      page.more = true;
      break;
    }
  }
  return page;
}
