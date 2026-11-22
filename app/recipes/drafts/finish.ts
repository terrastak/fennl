import {
  draftConflicts,
  type DraftData,
  type DraftPart,
  type DraftPhoto,
} from "../../../shared/drafts";
import { arrangedByHand } from "../../../shared/photoOrder";
import {
  CATEGORY_SEPARATOR,
  RECIPE_FIELDS,
  type RecipeContent,
  type RecipePhoto,
} from "../../../shared/recipe";
import { categoryTree } from "../../categories/tree";
import { arrangeRecipePhotos } from "../../photos/arrange";
import type { ChangeMark, RecipeDetail } from "../../sync/dbProtocol";
import type { SyncClient } from "../../sync/tabs";
import type { SavedState } from "../editorSession";
import { firstName } from "../format";
import { draftChanges } from "./draftChanges";

// Done in the recipe editor (U27 part 3, owner's choices 2026-11-21 and 22): the draft applied to
// the recipe box through sync, only the parts this person changed, each stamped with Done's time.
// When a partner changed one of the same parts while the draft waited, Done asks first, naming
// them ("Sarah also changed Ingredients while you were editing.").

/** The recipe's gallery photos, in order (import originals left out). */
export const galleryOf = (photos: RecipePhoto[]) => photos.filter((p) => p.role === "photo");

const draftPhoto = (photo: RecipePhoto): DraftPhoto => ({
  id: photo.id,
  imageHash: photo.imageHash,
  width: photo.width,
  height: photo.height,
  takenAt: photo.takenAt ?? null,
});

/** The recipe box's version of a recipe, as the draft editor compares against it. */
export function savedState(detail: RecipeDetail): SavedState {
  const content = Object.fromEntries(
    RECIPE_FIELDS.map((field) => [field, detail.recipe[field]]),
  ) as unknown as RecipeContent;
  return {
    content,
    photos: galleryOf(detail.photos).map(draftPhoto),
    categories: detail.categories.map((path) => path.split(CATEGORY_SEPARATOR)),
  };
}

/** A partner who changed parts the draft changes too. */
export interface PartnerChange {
  name: string;
  parts: DraftPart[];
}

/** Who made the changes marked at or after `since` (milliseconds). */
const changedSince = (marks: ChangeMark[] | undefined, since: number) => [
  ...new Set((marks ?? []).filter((m) => Date.parse(m.at) >= since).map((m) => m.userId)),
];

/**
 * The parts a partner changed meanwhile that the draft changes too (none for a new recipe).
 * Photos and categories are put down to whoever changed them since the draft began (`startedAt`).
 */
export async function partnerChanges(
  client: SyncClient,
  recipeId: string,
  data: DraftData,
  startedAt: number,
): Promise<PartnerChange[]> {
  const detail = await client.getRecipe(recipeId);
  if (!detail) return [];
  const conflicts = draftConflicts({
    me: client.userId,
    members: detail.members.map((m) => m.userId),
    saved: {
      content: savedState(detail).content,
      galleryIds: galleryOf(detail.photos).map((p) => p.id),
      categoryKeys: detail.categories.map((path) => path.toLocaleLowerCase()),
      ...(detail.recipe.fieldBy ? { fieldBy: detail.recipe.fieldBy } : {}),
      updatedByUserId: detail.recipe.updatedByUserId,
      photosBy: changedSince(detail.changes?.photos, startedAt),
      categoriesBy: changedSince(detail.changes?.categories, startedAt),
    },
    data,
  });
  return conflicts.map((conflict) => ({
    // The first name, as "Added by June" and signed notes show a partner.
    name:
      firstName(detail.members.find((m) => m.userId === conflict.userId)?.name ?? "") ||
      "Your partner",
    parts: conflict.parts,
  }));
}

/**
 * What Done did: "applied"; "gone" when the recipe went to Trash (or out of sight) meanwhile,
 * so nothing was sent; "newer" when a newer version of the draft (from another device) arrived
 * meanwhile, so nothing was sent and the editor should show that one.
 */
export type ApplyResult = "applied" | "gone" | "newer";

/**
 * Applies the draft: its changes queued and the draft removed together (the sync engine sends
 * them, then removes the draft from the account). `skip`: parts left as the partner has them.
 * `isNew`: the editor opened a new recipe (no recipe record existed). `version`: the version of
 * the draft the editor shows. Throws when it can't (editing paused).
 */
export async function applyDraft(args: {
  client: SyncClient;
  recipeId: string;
  data: DraftData;
  startedAt: number;
  skip: ReadonlySet<DraftPart>;
  isNew: boolean;
  version: number | null;
}): Promise<ApplyResult> {
  const { client, recipeId, data } = args;
  const [detail, categories] = await Promise.all([
    client.getRecipe(recipeId),
    client.getCategories(),
  ]);
  // A saved recipe that went to Trash (or out of sight) meanwhile: nothing is sent. Sending its
  // draft as a new recipe would wipe every part the draft didn't change.
  if (detail?.recipe.deletedAt || detail?.recipe.expungedAt || (!detail && !args.isNew)) {
    return "gone";
  }
  // Whether a recipe record exists decides create or change, never whether it's in Trash.
  const saved = detail;
  const gallery = saved ? galleryOf(saved.photos) : [];
  const changes = draftChanges({
    recipeId,
    isNew: !saved,
    startedAt: args.startedAt,
    data,
    saved: saved ? { content: savedState(saved).content, gallery } : null,
    tree: categoryTree(categories, client.userId),
    me: client.userId,
    now: Date.now(),
    skip: args.skip,
  });
  if (!(await client.finishDraft(recipeId, changes, args.version))) return "newer";
  // Fennl puts new photos in order (phase D4), unless the person arranged them: after Done, on
  // the photos applied.
  const savedIds = new Set(gallery.map((p) => p.id));
  const added = !args.skip.has("Photos") && (data.photos ?? []).some((p) => !savedIds.has(p.id));
  if (added && !data.photosArranged && !arrangedByHand(gallery)) void arrangeRecipePhotos(recipeId);
  return "applied";
}
