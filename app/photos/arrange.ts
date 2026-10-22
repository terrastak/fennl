import { arrangedByHand, arrangedOrder, type PhotoOrderResponse } from "../../shared/photoOrder";
import type { RecipePhoto } from "../../shared/recipe";
import type { PhotoChange } from "../../shared/sync";
import { activeSyncClient, saveChanges } from "../sync/useSync";
import { orderAt } from "./order";

// Photos arranged by Fennl (phase D4; spec.md D4): after photos are added to a recipe (by hand or
// by an import), the server says Fennl's order (shared/photoOrder.ts: what the AI sees, else when
// they were taken), and the app saves it as ordinary photo changes, marked as Fennl's. A gallery
// someone has arranged by hand is left alone, here and on the server.

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends what's waiting, so the server has the photos just added. False when it can't. */
async function settled(): Promise<boolean> {
  const client = activeSyncClient();
  if (!client) return false;
  for (let i = 0; i < 40; i++) {
    await client.syncNow();
    const status = client.getStatus();
    if (status.phase === "saved" && status.pending === 0) return true;
    if (["offline", "signed_out", "upgrade", "unavailable"].includes(status.phase)) return false;
    await wait(500);
  }
  return false;
}

/** The changes that put a gallery in `order` (photo ids), each marked as arranged by Fennl. */
export function arrangeChanges(
  gallery: RecipePhoto[],
  order: string[],
  now: number,
): PhotoChange[] {
  const byId = new Map(gallery.map((p) => [p.id, p]));
  const ordered = order.flatMap((id) => {
    const photo = byId.get(id);
    return photo ? [photo] : [];
  });
  // Photos the answer didn't know (added since) keep their place after the rest.
  for (const photo of gallery) if (!order.includes(photo.id)) ordered.push(photo);
  const same =
    ordered.every((photo, i) => photo.id === gallery[i]?.id) &&
    gallery.every((photo) => photo.arrangedBy === "fennl");
  if (same) return [];
  // Evenly spaced from the start, so later moves have room between them.
  const orders: number[] = [];
  return ordered.map((photo, i) => {
    const sortOrder = orderAt(orders, i);
    orders.push(sortOrder);
    return {
      kind: "photo",
      id: photo.id,
      recipeId: photo.recipeId,
      fields: { sortOrder, arrangedBy: "fennl" },
      changedAt: now + i,
    };
  });
}

/**
 * Puts a recipe's photos in Fennl's order, unless someone has arranged them by hand. Quiet: when
 * the server can't be reached, they're put in the order they were taken, here.
 */
export async function arrangeRecipePhotos(recipeId: string): Promise<void> {
  const client = activeSyncClient();
  if (!client) return;
  const before = await client.getRecipe(recipeId);
  const gallery = before?.photos.filter((p) => p.role === "photo") ?? [];
  if (gallery.length < 2 || arrangedByHand(gallery)) return;

  let order: string[] | null = null;
  if (await settled()) {
    try {
      const res = await fetch("/api/photos/arrange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipeId }),
      });
      if (res.ok) {
        const answer = (await res.json()) as PhotoOrderResponse;
        if (answer.by === "person" || answer.by === "unchanged") return;
        order = answer.order;
      }
    } catch {
      // No answer: by when they were taken, below.
    }
  }
  // Someone may have moved a photo meanwhile: theirs wins.
  const now = await client.getRecipe(recipeId);
  const current = now?.photos.filter((p) => p.role === "photo") ?? [];
  if (current.length < 2 || arrangedByHand(current)) return;
  const changes = arrangeChanges(
    current,
    order ?? arrangedOrder(current, null).map((p) => p.id),
    Date.now(),
  );
  if (changes.length > 0) await saveChanges(changes);
}
