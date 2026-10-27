import { draftContent } from "../../shared/importDraft";
import { addBlockedBy, type Usage } from "../../shared/limits";
import { readPaprikaRecipe, paprikaProblemText, type PaprikaRecipe } from "../../shared/paprika";
import {
  PaprikaEntryError,
  paprikaEntries,
  readPaprikaEntry,
  type ByteSource,
  type PaprikaEntry,
} from "../../shared/paprikaFile";
import { recipeBytes, recipeIssues, type RecipeImport } from "../../shared/recipe";
import type { PhotoChange, RecipeChange, SyncChange } from "../../shared/sync";
import { VERSION_RULES } from "../../shared/versions";
import { fileRecipeUnder, type CategoryTree } from "../categories/tree";
import { photoEncoder, uploadPrepared, UploadProblem } from "../photos/addPhotos";
import type { PhotoCache } from "../photos/cache";
import { orderAfter } from "../photos/order";
import { preparePhoto } from "../photos/prepare";
import { keepVersions } from "../recipes/versionsApi";
import type { ImportedRecipe, RecipeDetail } from "../sync/dbProtocol";
import type { PhotoPlan } from "../sync/status";
import { updateChange } from "./review";

// Importing a Paprika 3 library (phase E13; spec.md E13). The file is opened on this device and
// read one recipe at a time (shared/paprikaFile.ts): first all of it for the preview, then again,
// a batch at a time, to import. Recipes come in as ordinary changes through sync and photos as
// ordinary uploads, so the server checks them like anything typed or added by hand.
//
// Owner's choices (2026-10-21): a recipe imported before (the same Paprika id) is updated when it
// changed in Paprika, if the person says so, and the version it had is kept first (every plan) so
// it can be compared and put back; the rest come in as new. Free imports up to its recipe limit,
// text only. Photos are added until the photo allowance is full; importing again fills in the
// ones missing. An import that stops part way picks up where it left off when the file is
// chosen again, since everything already imported matches.

/** Recipes saved in one go. */
const BATCH = 25;

/** How long to wait when the server says photos are coming too fast, and how many times. */
const RATE_WAIT_MS = 30_000;
const RATE_TRIES = 6;

export type PaprikaItemStatus =
  /** Not imported before. */
  | "new"
  /** Imported before and changed in Paprika since. */
  | "changed"
  /** Imported before, the same in Paprika. */
  | "unchanged"
  /** Imported before, and in Trash here: left there. */
  | "in_trash";

export interface PaprikaItem {
  entry: PaprikaEntry;
  uid: string;
  hash: string | null;
  title: string;
  /** Its text, as the recipe limits count it. */
  bytes: number;
  /** Its photos: Paprika's hash and size. */
  photos: { hash: string; bytes: number }[];
  status: PaprikaItemStatus;
  /** The recipe it was imported as before. */
  existing: ImportedRecipe | null;
  /** Its photos not brought in yet. */
  missingPhotos: string[];
}

export interface PaprikaPreview {
  fileName: string;
  items: PaprikaItem[];
  /** Recipes in the file that couldn't be read, in words. */
  problems: { name: string; text: string }[];
  /** Entries in the file that aren't recipes (ignored). */
  others: number;
}

/** What an import would do, from the preview, the plan's limits and the person's choice. */
export interface PaprikaPlan {
  /** New recipes there's room for. */
  add: PaprikaItem[];
  /** New recipes past the plan's recipe limit. */
  needRoom: PaprikaItem[];
  /** Changed in Paprika since they were imported. */
  changed: PaprikaItem[];
  unchanged: number;
  inTrash: number;
  /** Photos to bring in (none without photos on the plan), and about how many bytes. */
  photos: number;
  photoBytes: number;
}

/** The recipe's name in the file, for the problems list: "Fajitas.paprikarecipe" → "Fajitas". */
const entryTitle = (entry: PaprikaEntry) =>
  entry.name.replace(/^.*\//, "").replace(/\.paprikarecipe$/i, "");

/** The recipe a Paprika recipe was imported as before, by Paprika's id. */
function matchOf(existing: ImportedRecipe[]): Map<string, ImportedRecipe> {
  const byId = new Map<string, ImportedRecipe>();
  for (const recipe of existing) {
    const id = recipe.import.externalId;
    // A recipe out of Trash beats one in it (imported again after deleting the first).
    if (id && (!byId.has(id) || byId.get(id)?.inTrash)) byId.set(id, recipe);
  }
  return byId;
}

export function itemFor(
  entry: PaprikaEntry,
  recipe: PaprikaRecipe,
  existing: ImportedRecipe | undefined,
): PaprikaItem {
  const content = draftContent(recipe.draft);
  const brought = new Set(existing?.import.photos ?? []);
  const status: PaprikaItemStatus = !existing
    ? "new"
    : existing.inTrash
      ? "in_trash"
      : existing.import.externalHash !== recipe.hash
        ? "changed"
        : "unchanged";
  return {
    entry,
    uid: recipe.uid,
    hash: recipe.hash,
    title: content.title,
    bytes: recipeBytes(content),
    photos: recipe.photos.map((p) => ({ hash: p.hash, bytes: p.bytes })),
    status,
    existing: existing ?? null,
    missingPhotos: recipe.photos.map((p) => p.hash).filter((hash) => !brought.has(hash)),
  };
}

/**
 * Reads the whole file for the preview: every recipe checked, matched with what was imported
 * before, photos counted (and not kept: they're read again when importing). Throws
 * PaprikaFileError when the file isn't a Paprika export.
 */
export async function previewPaprika(
  source: ByteSource,
  fileName: string,
  existing: ImportedRecipe[],
  maxRecipeBytes: number | null,
  onProgress: (done: number, total: number) => void,
): Promise<PaprikaPreview> {
  const { recipes: entries, others } = await paprikaEntries(source);
  const matches = matchOf(existing);
  const items: PaprikaItem[] = [];
  const problems: PaprikaPreview["problems"] = [];
  const seen = new Set<string>();
  for (const [i, entry] of entries.entries()) {
    if (i % 25 === 0) {
      onProgress(i, entries.length);
      // Let the page draw between batches.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const name = entryTitle(entry);
    let json: unknown;
    try {
      json = await readPaprikaEntry(source, entry);
    } catch (error) {
      const problem = error instanceof PaprikaEntryError ? error.problem : "damaged";
      problems.push({
        name,
        text: paprikaProblemText(problem === "too_large" ? "too_large" : "damaged"),
      });
      continue;
    }
    const recipe = readPaprikaRecipe(json, entry.name);
    if ("problem" in recipe) {
      problems.push({ name, text: paprikaProblemText(recipe.problem) });
      continue;
    }
    if (seen.has(recipe.uid)) {
      problems.push({ name, text: paprikaProblemText("same_recipe") });
      continue;
    }
    seen.add(recipe.uid);
    const content = draftContent(recipe.draft);
    const issues = recipeIssues(content, maxRecipeBytes);
    if (issues.length > 0) {
      problems.push({
        name,
        text: issues.some((issue) => issue.problem === "too_large")
          ? "it's larger than one recipe can be"
          : "part of it is longer than a recipe can hold",
      });
      continue;
    }
    items.push(itemFor(entry, recipe, matches.get(recipe.uid)));
  }
  onProgress(entries.length, entries.length);
  return { fileName, items, problems, others };
}

/**
 * What importing would do: new recipes while the plan has room for them (in the file's order),
 * changed ones, and the photos to bring in when the plan has photos.
 */
export function planPaprika(
  preview: PaprikaPreview,
  usage: Usage | null,
  photos: PhotoPlan | null,
): PaprikaPlan {
  const room: Usage | null = usage ? { ...usage } : null;
  const plan: PaprikaPlan = {
    add: [],
    needRoom: [],
    changed: [],
    unchanged: 0,
    inTrash: 0,
    photos: 0,
    photoBytes: 0,
  };
  const photosOn = photos?.enabled ?? false;
  for (const item of preview.items) {
    if (item.status === "new") {
      if (room && addBlockedBy(room)) {
        plan.needRoom.push(item);
        continue;
      }
      if (room) {
        room.recipes += 1;
        room.textBytes += item.bytes;
      }
      plan.add.push(item);
    } else if (item.status === "changed") plan.changed.push(item);
    else if (item.status === "unchanged") plan.unchanged += 1;
    else plan.inTrash += 1;
    if (photosOn && item.status !== "in_trash") {
      const wanted = item.photos.filter((p) => item.missingPhotos.includes(p.hash));
      plan.photos += wanted.length;
      plan.photoBytes += wanted.reduce((sum, p) => sum + p.bytes, 0);
    }
  }
  return plan;
}

/** What the sync layer and the page give the import. */
export interface ImportContext {
  me: string;
  tree: CategoryTree;
  cache: PhotoCache | null;
  photos: PhotoPlan | null;
  /** Saves changes through sync; false when they couldn't be saved. */
  save(changes: SyncChange[]): Promise<boolean>;
  /** Sends everything waiting and waits until the server has it; false when it can't. */
  settle(): Promise<boolean>;
  getRecipe(id: string): Promise<RecipeDetail | null>;
  /** Puts a recipe's photos in Fennl's order (phase D4). */
  arrange(recipeId: string): Promise<void>;
  now(): number;
  wait(ms: number): Promise<void>;
  onProgress(text: string): void;
}

export type PaprikaStop =
  /** The connection went, or saving failed: what's done is saved; choose the file again. */
  | "offline"
  /** Earlier versions couldn't be kept, so changed recipes were left as they were. */
  | "versions";

export interface PaprikaResult {
  added: number;
  updated: number;
  photosAdded: number;
  /** Photos not brought in because the allowance is full, or another problem. */
  photosLeft: number;
  photoProblem: "quota_full" | "failed" | null;
  stopped: PaprikaStop | null;
}

function importRecord(recipe: PaprikaRecipe, now: number, photos: string[]): RecipeImport {
  return {
    source: "paprika",
    importJobId: null,
    externalId: recipe.uid,
    externalHash: recipe.hash,
    importedAt: new Date(now).toISOString(),
    photos,
  };
}

/** The whole recipe, every field set, for a new one. */
function createChange(recipeId: string, recipe: PaprikaRecipe, now: number): RecipeChange {
  // The draft's content has every field, empty where Paprika has nothing.
  const fields = draftContent(recipe.draft);
  return {
    kind: "recipe",
    id: recipeId,
    create: {
      createdAt: recipe.createdAt ?? new Date(now).toISOString(),
      import: importRecord(recipe, now, []),
    },
    fields,
    changedAt: now,
  };
}

/**
 * Paprika's stars and notes, as the importing person's own, where Paprika has them. The notes
 * come as a note of theirs (U7); an update whose notes they don't already have adds them as a new
 * one, so nothing they wrote is replaced.
 */
function opinionChange(
  recipeId: string,
  recipe: PaprikaRecipe,
  mine: { rating: number | null; notes: string[] } | null,
  now: number,
): SyncChange[] {
  const changes: SyncChange[] = [];
  if (recipe.rating !== null && recipe.rating !== mine?.rating) {
    changes.push({ kind: "opinion", recipeId, fields: { rating: recipe.rating }, changedAt: now });
  }
  const note = recipe.note.trim();
  if (note && !(mine?.notes ?? []).some((text) => text.trim() === note)) {
    changes.push({ kind: "note", id: crypto.randomUUID(), recipeId, text: note, changedAt: now });
  }
  return changes;
}

function base64Blob(data: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

/**
 * Prepares and uploads one of a recipe's photos for its owner, waiting when photos are coming
 * too fast. Returns the uploaded photo, or why not.
 */
async function addPhoto(
  data: string,
  owner: string,
  ctx: ImportContext,
): Promise<
  | { hash: string; width: number; height: number; takenAt: number | null }
  | "unusable"
  | "offline"
  | "quota_full"
  | "failed"
> {
  const cache = ctx.cache;
  if (!cache) return "failed";
  for (let tries = 0; tries < RATE_TRIES; tries++) {
    try {
      const prepared = await preparePhoto(
        base64Blob(data),
        "dish",
        photoEncoder(),
        ctx.photos?.maxFileBytes ?? null,
      ).catch(() => {
        throw new UploadProblem("not_a_photo");
      });
      const hash = await uploadPrepared(prepared, owner, cache);
      return { hash, width: prepared.width, height: prepared.height, takenAt: prepared.takenAt };
    } catch (error) {
      const problem = error instanceof UploadProblem ? error.problem : "failed";
      if (problem === "rate_limited") {
        ctx.onProgress("Fennl is taking photos a little slower for a moment…");
        await ctx.wait(RATE_WAIT_MS);
        continue;
      }
      if (problem === "offline") return "offline";
      if (problem === "quota_full" || problem === "not_premium") return "quota_full";
      if (problem === "not_a_photo" || problem === "too_large") return "unusable";
      return "failed";
    }
  }
  return "failed";
}

/**
 * Imports what the plan says, a batch at a time. Returns what was done; anything not done is
 * picked up by choosing the file again.
 */
export async function runPaprikaImport(
  source: ByteSource,
  plan: PaprikaPlan,
  /** Also update the recipes that changed in Paprika (the person's choice in the preview). */
  updateChanged: boolean,
  /** Recipes already imported with photos still to bring in. */
  fillPhotos: PaprikaItem[],
  ctx: ImportContext,
): Promise<PaprikaResult> {
  const result: PaprikaResult = {
    added: 0,
    updated: 0,
    photosAdded: 0,
    photosLeft: 0,
    photoProblem: null,
    stopped: null,
  };
  const photosOn = Boolean(ctx.photos?.enabled && ctx.cache);
  const made = new Map<string, string>();
  const work = [
    ...plan.add.map((item) => ({ item, kind: "add" as const })),
    ...(updateChanged ? plan.changed.map((item) => ({ item, kind: "update" as const })) : []),
    ...(photosOn ? fillPhotos.map((item) => ({ item, kind: "photos" as const })) : []),
  ];
  const total = work.length;
  let done = 0;
  const toArrange: string[] = [];

  for (let start = 0; start < work.length; start += BATCH) {
    const batch = work.slice(start, start + BATCH);
    const now = ctx.now();
    const changes: SyncChange[] = [];
    /** Each recipe's photos to bring in once its text is saved. */
    const photoJobs: {
      recipeId: string;
      owner: string;
      recipe: PaprikaRecipe;
      /** The Paprika version the recipe holds once this batch is saved. */
      hash: string | null;
      brought: string[];
      /** sortOrders of its gallery photos now: new ones go after them. */
      orders: number[];
    }[] = [];

    // Changed recipes: the server must have everything first, then keeps them as they are.
    const updates = batch.filter((w) => w.kind === "update" && w.item.existing);
    if (updates.length > 0) {
      if (!(await ctx.settle())) {
        result.stopped = "offline";
        return result;
      }
      const ids = updates.map((w) => w.item.existing?.id as string);
      const kept = new Set<string>();
      for (let i = 0; i < ids.length; i += VERSION_RULES.recipesPerRequest) {
        const answer = await keepVersions(
          ids.slice(i, i + VERSION_RULES.recipesPerRequest),
          "paprika_update",
        );
        if (!answer) {
          result.stopped = "versions";
          return result;
        }
        answer.forEach((id) => kept.add(id));
      }
      if (ids.some((id) => !kept.has(id))) {
        result.stopped = "versions";
        return result;
      }
    }

    for (const { item, kind } of batch) {
      ctx.onProgress(
        kind === "photos"
          ? `Adding photos to ${item.title} (${done + 1} of ${total})…`
          : `Importing ${item.title} (${done + 1} of ${total})…`,
      );
      done += 1;
      let recipe: PaprikaRecipe;
      try {
        const read = readPaprikaRecipe(await readPaprikaEntry(source, item.entry), item.entry.name);
        if ("problem" in read) continue;
        recipe = read;
      } catch {
        continue;
      }
      if (kind === "add") {
        const recipeId = crypto.randomUUID();
        changes.push(createChange(recipeId, recipe, now));
        changes.push(...opinionChange(recipeId, recipe, null, now));
        changes.push(
          ...fileRecipeUnder(ctx.tree, recipeId, recipe.categories, { me: ctx.me, now }, made)
            .changes,
        );
        result.added += 1;
        photoJobs.push({
          recipeId,
          owner: ctx.me,
          recipe,
          hash: recipe.hash,
          brought: [],
          orders: [],
        });
        continue;
      }
      const existing = item.existing as ImportedRecipe;
      const detail = await ctx.getRecipe(existing.id);
      if (!detail) continue;
      if (kind === "update") {
        const imported = draftContent(recipe.draft);
        const update = updateChange(existing.id, detail.recipe, imported, now) ?? {
          kind: "recipe" as const,
          id: existing.id,
          fields: {},
          changedAt: now,
        };
        changes.push({
          ...update,
          import: { ...importRecord(recipe, now, existing.import.photos ?? []) },
        });
        const rating = detail.opinions.find((o) => o.userId === ctx.me)?.rating ?? null;
        const notes = detail.notes.filter((n) => n.userId === ctx.me).map((n) => n.text);
        changes.push(...opinionChange(existing.id, recipe, { rating, notes }, now));
        const tree = {
          ...ctx.tree,
          recipeOwners: { ...ctx.tree.recipeOwners, [existing.id]: existing.ownerUserId },
        };
        changes.push(
          ...fileRecipeUnder(tree, existing.id, recipe.categories, { me: ctx.me, now }, made)
            .changes,
        );
        result.updated += 1;
      }
      photoJobs.push({
        recipeId: existing.id,
        owner: existing.ownerUserId,
        recipe,
        // Filling in photos only: the recipe still holds the version it had.
        hash: kind === "update" ? recipe.hash : existing.import.externalHash,
        brought: existing.import.photos ?? [],
        orders: detail.photos.filter((p) => p.role === "photo").map((p) => p.sortOrder),
      });
    }

    if (changes.length > 0 && !(await ctx.save(changes))) {
      result.stopped = "offline";
      return result;
    }

    // Photos, recipe by recipe, once the recipes are saved.
    for (const job of photoJobs) {
      const wanted = job.recipe.photos.filter((p) => !job.brought.includes(p.hash));
      if (wanted.length === 0) continue;
      if (!photosOn || !ctx.cache || result.photoProblem) {
        result.photosLeft += photosOn ? wanted.length : 0;
        continue;
      }
      const brought = [...job.brought];
      const orders = [...job.orders];
      const max = ctx.photos?.maxPerRecipe ?? null;
      const photoChanges: PhotoChange[] = [];
      for (const photo of wanted) {
        if (!photo.data) continue;
        if (max !== null && orders.length >= max) break;
        ctx.onProgress(`Adding photos to ${job.recipe.draft.fields.title?.value ?? "a recipe"}…`);
        const added = await addPhoto(photo.data, job.owner, ctx);
        if (added === "unusable") {
          // A photo Fennl can't use (damaged, not an image): counted as brought, not tried again.
          brought.push(photo.hash);
          continue;
        }
        if (added === "offline") result.stopped = "offline";
        else if (added === "quota_full" || added === "failed") result.photoProblem = added;
        if (typeof added === "string") break;
        const sortOrder = orderAfter(orders);
        orders.push(sortOrder);
        photoChanges.push({
          kind: "photo",
          id: crypto.randomUUID(),
          recipeId: job.recipeId,
          create: {
            imageHash: added.hash,
            role: "photo",
            width: added.width,
            height: added.height,
            takenAt: added.takenAt,
          },
          fields: { sortOrder },
          changedAt: ctx.now(),
        });
        brought.push(photo.hash);
        result.photosAdded += 1;
      }
      result.photosLeft += wanted.filter((p) => !brought.includes(p.hash)).length;
      if (brought.length > job.brought.length) {
        const record = { ...importRecord(job.recipe, ctx.now(), brought), externalHash: job.hash };
        const saved = await ctx.save([
          ...photoChanges,
          { kind: "recipe", id: job.recipeId, import: record, fields: {}, changedAt: ctx.now() },
        ]);
        if (!saved) {
          result.stopped = "offline";
          return result;
        }
        if (orders.length > 1) toArrange.push(job.recipeId);
      }
      if (result.stopped) return result;
    }
  }
  await ctx.settle();
  // Recipes with several photos are put in order once they're all in (phase D4).
  for (const recipeId of toArrange) await ctx.arrange(recipeId);
  return result;
}
