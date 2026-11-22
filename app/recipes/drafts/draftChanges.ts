import {
  FIELD_PART,
  categoryPathKey,
  sameValue,
  type DraftData,
  type DraftPart,
  type DraftPhoto,
} from "../../../shared/drafts";
import {
  RECIPE_FIELDS,
  emptyRecipeContent,
  type RecipeContent,
  type RecipePhoto,
} from "../../../shared/recipe";
import type { PhotoChange, RecipeChange, SyncChange } from "../../../shared/sync";
import {
  fileRecipeUnder,
  unfileRecipes,
  type CategoryNode,
  type CategoryTree,
} from "../../categories/tree";
import { orderAfter } from "../../photos/order";

// Done (U27 part 3, owner's choices 2026-11-21 and 22): a draft turned into ordinary sync changes.
// Only the parts this person changed, each stamped with Done's time, so a partner's change to
// another part meanwhile stays. A new recipe is created first, then its photos, then its
// categories (the owner's missing categories are made now, so a discarded draft leaves none).

export interface DraftChangesInput {
  recipeId: string;
  /** No recipe exists yet: Done creates it. */
  isNew: boolean;
  /** When the draft began: a new recipe's createdAt. */
  startedAt: number;
  data: DraftData;
  /** The recipe box's version: its words and its gallery photos in order. Null for a new one. */
  saved: { content: RecipeContent; gallery: RecipePhoto[] } | null;
  tree: CategoryTree;
  me: string;
  /** Done's time. */
  now: number;
  /** Parts left out (Keep Sarah's). */
  skip?: ReadonlySet<DraftPart>;
  /** New ids (tests set it). */
  newId?: () => string;
}

export function draftChanges(input: DraftChangesInput): SyncChange[] {
  const { recipeId, data, now } = input;
  const skip = input.skip ?? new Set<DraftPart>();
  const changes: SyncChange[] = [];

  // The words.
  if (input.isNew || !input.saved) {
    const recipe: RecipeChange = {
      kind: "recipe",
      id: recipeId,
      create: { createdAt: new Date(input.startedAt).toISOString(), import: null },
      fields: { ...emptyRecipeContent(), ...data.fields },
      changedAt: now,
    };
    changes.push(recipe);
  } else {
    const saved = input.saved.content;
    const fields: Partial<RecipeContent> = {};
    for (const field of RECIPE_FIELDS) {
      if (!(field in data.fields) || skip.has(FIELD_PART[field])) continue;
      if (sameValue(data.fields[field], saved[field])) continue;
      Object.assign(fields, { [field]: data.fields[field] });
    }
    if (Object.keys(fields).length > 0) {
      changes.push({ kind: "recipe", id: recipeId, fields, changedAt: now });
    }
  }

  if (data.photos && !skip.has("Photos")) {
    changes.push(...photoChanges(input, data.photos));
  }
  if (data.categories && !skip.has("Categories")) {
    changes.push(...categoryChanges(input, data.categories));
  }
  return changes;
}

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The gallery as the draft has it: photos taken out first, then new ones, then places. When the
 * photos kept are still in their order and new ones come after them, the new ones simply go at
 * the end and nothing moves; otherwise every photo takes its place, moved ones marked as the
 * person's when they arranged them (Fennl then leaves the order alone, phase D4).
 */
function photoChanges(input: DraftChangesInput, intended: DraftPhoto[]): PhotoChange[] {
  const { recipeId, now, data } = input;
  const gallery = input.saved?.gallery ?? [];
  const savedById = new Map(gallery.map((photo) => [photo.id, photo]));
  // A photo that was on the recipe when the draft began but has since been removed (by a
  // partner) comes back as a new photo of the same image.
  const wasSaved = new Set(data.basePhotos ?? []);
  const newId = input.newId ?? (() => crypto.randomUUID());
  const wanted = intended.map((photo) =>
    !savedById.has(photo.id) && wasSaved.has(photo.id) ? { ...photo, id: newId() } : photo,
  );
  const wantedIds = new Set(wanted.map((photo) => photo.id));
  const changes: PhotoChange[] = [];
  for (const photo of gallery) {
    if (wantedIds.has(photo.id)) continue;
    changes.push({
      kind: "photo",
      id: photo.id,
      recipeId,
      fields: {},
      deleted: true,
      changedAt: now,
    });
  }
  const keptIds = wanted.filter((photo) => savedById.has(photo.id)).map((photo) => photo.id);
  const simple =
    sameOrder(
      keptIds,
      gallery.filter((photo) => wantedIds.has(photo.id)).map((photo) => photo.id),
    ) && wanted.slice(0, keptIds.length).every((photo) => savedById.has(photo.id));
  const create = (photo: DraftPhoto, fields: PhotoChange["fields"]): PhotoChange => ({
    kind: "photo",
    id: photo.id,
    recipeId,
    create: {
      imageHash: photo.imageHash,
      role: "photo",
      width: photo.width,
      height: photo.height,
      takenAt: photo.takenAt,
    },
    fields,
    changedAt: now,
  });
  if (simple) {
    const orders = keptIds.map((id) => savedById.get(id)?.sortOrder ?? 0);
    for (const photo of wanted) {
      if (savedById.has(photo.id)) continue;
      const sortOrder = orderAfter(orders);
      orders.push(sortOrder);
      changes.push(create(photo, { sortOrder }));
    }
    return changes;
  }
  const mark = data.photosArranged ? { arrangedBy: "person" as const } : {};
  wanted.forEach((photo, i) => {
    const sortOrder = i + 1;
    const stored = savedById.get(photo.id);
    if (!stored) changes.push(create(photo, { sortOrder, ...mark }));
    else if (stored.sortOrder !== sortOrder) {
      changes.push({
        kind: "photo",
        id: photo.id,
        recipeId,
        fields: { sortOrder, ...mark },
        changedAt: now,
      });
    }
  });
  return changes;
}

/**
 * Categories added (the owner's made where missing) and taken out: only what the draft itself
 * added to or took out of the categories it started from (`baseCategories`), so a category
 * renamed, deleted or added elsewhere meanwhile stays as it now is, and none is made again under
 * its old name. A new recipe (no starting point): every category the draft has.
 */
function categoryChanges(input: DraftChangesInput, intended: string[][]): SyncChange[] {
  const { tree, recipeId } = input;
  const ctx = { me: input.me, now: input.now, ...(input.newId ? { newId: input.newId } : {}) };
  const current = new Map<string, CategoryNode>();
  for (const link of tree.links) {
    if (link.recipeId !== recipeId) continue;
    const node = tree.byId.get(link.categoryId);
    if (node) current.set(node.key, node);
  }
  const wantedKeys = new Set(intended.map(categoryPathKey));
  const base = input.isNew ? null : input.data.baseCategories;
  const startedWith = new Set(base ?? current.keys());
  const added = intended.filter((names) => {
    const key = categoryPathKey(names);
    return !startedWith.has(key) && !current.has(key);
  });
  const changes: SyncChange[] = [...fileRecipeUnder(tree, recipeId, added, ctx).changes];
  for (const [key, node] of current) {
    if (startedWith.has(key) && !wantedKeys.has(key)) {
      changes.push(...unfileRecipes(tree, [recipeId], node, ctx).changes);
    }
  }
  return changes;
}
