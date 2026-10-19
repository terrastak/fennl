import type { RecipeDraft } from "../../shared/importDraft";
import type { RecipePhoto } from "../../shared/recipe";
import type { PhotoChange } from "../../shared/sync";
import { orderAfter } from "../photos/order";
import type { PhotoCache } from "../photos/cache";
import { saveChanges } from "../sync/useSync";

// The photos a recipe was read from (a card's two sides, cookbook pages: phase E9), kept with the
// saved recipe as import originals, out of its gallery (CLAUDE.md: original photos are always
// kept). They were uploaded to the importer's photos before reading, so on their own recipe they
// are only linked; on a partner's recipe ("Update the existing recipe") the photo has to be the
// recipe owner's (decided 2026-10-09), so a copy is uploaded for them.

/** The draft's photos to keep as originals: input hashes, in order. */
export function originalHashes(draft: RecipeDraft): string[] {
  return draft.photos.flatMap((photo) => {
    const hash = photo.role === "import_original" ? draft.inputs[photo.input]?.imageHash : null;
    return hash ? [hash] : [];
  });
}

async function sizeOf(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/**
 * Adds the draft's page photos to the recipe as import originals. Returns false when they
 * couldn't all be kept (the recipe itself is saved either way).
 */
export async function keepOriginals(input: {
  draft: RecipeDraft;
  recipeId: string;
  ownerUserId: string;
  me: string;
  /** The recipe's photos already there (updating a recipe). */
  existing: RecipePhoto[];
  cache: PhotoCache;
}): Promise<boolean> {
  const { recipeId, ownerUserId, me, cache } = input;
  const already = new Set(input.existing.map((p) => p.imageHash));
  const orders = input.existing.filter((p) => p.role === "import_original").map((p) => p.sortOrder);
  const changes: PhotoChange[] = [];
  try {
    for (const hash of originalHashes(input.draft)) {
      if (already.has(hash)) continue;
      already.add(hash);
      const blob = await cache.get(hash, "full");
      if (ownerUserId !== me) {
        const res = await fetch(`/api/images/upload?owner=${encodeURIComponent(ownerUserId)}`, {
          method: "POST",
          body: blob,
          credentials: "same-origin",
        });
        if (!res.ok) return false;
      }
      const { width, height } = await sizeOf(blob);
      const sortOrder = orderAfter(orders);
      orders.push(sortOrder);
      changes.push({
        kind: "photo",
        id: crypto.randomUUID(),
        recipeId,
        create: { imageHash: hash, role: "import_original", width, height },
        fields: { sortOrder },
        changedAt: Date.now(),
      });
    }
  } catch {
    return false;
  }
  return changes.length === 0 || saveChanges(changes);
}
