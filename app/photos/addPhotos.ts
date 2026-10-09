import type { PhotoChange } from "../../shared/sync";
import { saveChanges } from "../sync/useSync";
import { PhotoCache } from "./cache";
import { orderAfter } from "./order";
import { preparePhoto } from "./prepare";
import type { PhotoKind } from "./settings";
import { WebpEncoder } from "./webpEncoder";

// Adding photos to a recipe (phase D2), one at a time: prepare it on this device, upload it (for
// the recipe's owner, who owns the photo: decided 2026-10-09), upload its small copy, keep both
// here so they show at once, then save the photo on the recipe through the usual sync. Adding a
// photo needs a connection (decided 2026-10-09); text edits still work offline on Premium.

/** Why adding stopped, in words the screens turn into a message. */
export type AddPhotoProblem =
  | "offline"
  | "not_premium"
  | "quota_full"
  | "too_many"
  | "too_large"
  | "not_a_photo"
  | "rate_limited"
  | "failed";

export interface AddPhotosRequest {
  files: File[];
  recipeId: string;
  /** The recipe's owner: the photos are theirs. */
  ownerUserId: string;
  kind: PhotoKind;
  /** sortOrders of the photos already there (the new ones go after them). */
  existingOrders: number[];
  /** How many more the recipe may have. Null: no limit. */
  room: number | null;
  maxFileBytes: number | null;
  cache: PhotoCache;
  onProgress?(done: number, total: number): void;
}

export interface AddPhotosResult {
  added: number;
  problem: AddPhotoProblem | null;
}

let encoder: WebpEncoder | null = null;

class UploadProblem extends Error {
  constructor(readonly problem: AddPhotoProblem) {
    super(problem);
  }
}

async function send(url: string, body: Blob): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body, credentials: "same-origin" });
  } catch {
    throw new UploadProblem("offline");
  }
  if (response.ok) return response;
  const error = ((await response.json().catch(() => ({}))) as { error?: string }).error;
  if (error === "images_not_included") throw new UploadProblem("not_premium");
  if (error === "image_quota_full") throw new UploadProblem("quota_full");
  if (response.status === 413) throw new UploadProblem("too_large");
  if (response.status === 415) throw new UploadProblem("not_a_photo");
  if (response.status === 429) throw new UploadProblem("rate_limited");
  throw new UploadProblem("failed");
}

export async function addPhotos(request: AddPhotosRequest): Promise<AddPhotosResult> {
  const { files, recipeId, ownerUserId, cache } = request;
  if (!navigator.onLine) return { added: 0, problem: "offline" };
  const wanted = request.room === null ? files : files.slice(0, Math.max(0, request.room));
  const orders = [...request.existingOrders];
  let added = 0;
  encoder ??= new WebpEncoder();
  try {
    for (const file of wanted) {
      request.onProgress?.(added, wanted.length);
      const prepared = await preparePhoto(file, request.kind, encoder, request.maxFileBytes).catch(
        () => {
          throw new UploadProblem("not_a_photo");
        },
      );
      const owner = `?owner=${encodeURIComponent(ownerUserId)}`;
      const uploaded = await send(`/api/images/upload${owner}`, prepared.file);
      const { hash } = (await uploaded.json()) as { hash: string };
      await send(`/api/images/${hash}/thumb${owner}`, prepared.thumb);
      await cache.keep(hash, "full", prepared.file);
      await cache.keep(hash, "thumb", prepared.thumb);
      const sortOrder = orderAfter(orders);
      orders.push(sortOrder);
      const change: PhotoChange = {
        kind: "photo",
        id: crypto.randomUUID(),
        recipeId,
        create: { imageHash: hash, role: "photo", width: prepared.width, height: prepared.height },
        fields: { sortOrder },
        changedAt: Date.now(),
      };
      if (!(await saveChanges([change]))) throw new UploadProblem("failed");
      added += 1;
    }
  } catch (error) {
    return {
      added,
      problem: error instanceof UploadProblem ? error.problem : "failed",
    };
  }
  request.onProgress?.(added, wanted.length);
  return {
    added,
    problem: wanted.length < files.length ? "too_many" : null,
  };
}

/** What to tell people when adding photos stopped. */
export function problemText(problem: AddPhotoProblem, maxPerRecipe: number | null): string {
  switch (problem) {
    case "offline":
      return "Adding photos needs a connection. Your recipe is saved; try again when you're back online.";
    case "not_premium":
      return "Photos are a Premium feature.";
    case "quota_full":
      return "Your photo storage is full. Remove some photos to add more.";
    case "too_many":
      return `A recipe can have up to ${maxPerRecipe ?? "a limited number of"} photos.`;
    case "too_large":
      return "That photo is too large to add.";
    case "not_a_photo":
      return "That file isn't a photo Fennl can use. Try a JPEG, PNG, WebP or GIF.";
    case "rate_limited":
      return "That's a lot of photos at once. Wait a minute, then add the rest.";
    case "failed":
      return "The photo couldn't be added. Please try again.";
  }
}
