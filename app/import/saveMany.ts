import { draftContent, type RecipeDraft } from "../../shared/importDraft";
import type { ImportJobDetail } from "../../shared/importJobs";
import { recipeIssues } from "../../shared/recipe";
import type { SyncChange } from "../../shared/sync";
import { fileRecipeUnder, type CategoryTree } from "../categories/tree";
import { addPhotos } from "../photos/addPhotos";
import type { PhotoCache } from "../photos/cache";
import { activeSyncClient, saveChanges } from "../sync/useSync";
import { importJob, inputUrl } from "./api";
import { keepOriginals, originalHashes } from "./originals";
import { createChange, fieldsToCheck, pathNames } from "./review";

// Several drafts saved at once from the Import page's Waiting for review list (phases E12 and
// U19). Each draft says where it stands: ready to save, or something Fennl would leave for the
// person to look at (parts it wasn't sure of, a recipe that may already be in the box, photos to
// choose), or one that can't be saved as it is (it fails the editor's checks). Ready drafts are
// saved as Fennl read them. The others stay waiting unless the person says to save them anyway:
// then a possible duplicate is saved as a new recipe beside the one there (never replacing it),
// and only Fennl's cover photo is kept. A draft that fails the editor's checks is never saved.

/** Where a draft stands, for its label on the Import page. */
export type Standing = "ready" | "check" | "duplicate" | "photos" | "blocked";

export interface DraftStanding {
  standing: Standing;
  /** "3 things Fennl wasn't sure of", "no title": said after the label. */
  detail: string | null;
}

/** Why a chosen draft was left waiting. */
export type LeftReason = "check" | "duplicate" | "photos" | "blocked" | "gone" | "not_saved";

export interface SaveManyResult {
  saved: string[];
  left: { id: string; title: string; reason: LeftReason }[];
  /** The page photos of a saved recipe couldn't all be kept with it. */
  originalsMissed: number;
  /** Saved anyway, but its cover photo couldn't be added. */
  photosMissed: number;
}

/** The photos a draft offers to keep in the recipe's gallery, by input; the first is the cover. */
export function photoInputs(draft: RecipeDraft): number[] {
  return draft.photos.filter((p) => p.role === "photo").map((p) => p.input);
}

/** How many places Fennl wasn't sure of: fields, lines, words, notes. */
export function unsureCount(draft: RecipeDraft): number {
  const lines = [
    ...(draft.lineConfidence.ingredients ?? []),
    ...(draft.lineConfidence.directions ?? []),
  ].filter((c) => c !== "high").length;
  const words = Object.values(draft.unsureWords ?? {}).reduce((n, list) => n + list.length, 0);
  return fieldsToCheck(draft).length + lines + words + draft.warnings.length;
}

/** What makes a draft need its own review, or null when it can be saved as it is. */
export function needsReview(
  draft: RecipeDraft,
  premium: boolean,
): "blocked" | "check" | "photos" | null {
  if (recipeIssues(draftContent(draft), null).length > 0) return "blocked";
  if (unsureCount(draft) > 0) return "check";
  if (premium && photoInputs(draft).length > 0) return "photos";
  return null;
}

/** Why a draft can't be saved as it is, in a few words. */
function blockedDetail(draft: RecipeDraft): string {
  const issues = recipeIssues(draftContent(draft), null);
  return issues.some((i) => i.path === "title" && i.problem === "missing")
    ? "no title"
    : "something to fix";
}

/** Where a draft stands without the duplicate check, which needs the device's copy. */
export function draftStanding(draft: RecipeDraft, premium: boolean): DraftStanding {
  const reason = needsReview(draft, premium);
  if (reason === "blocked") return { standing: "blocked", detail: blockedDetail(draft) };
  if (reason === "check") {
    const n = unsureCount(draft);
    return {
      standing: "check",
      detail: n === 1 ? "1 thing Fennl wasn’t sure of" : `${n} things Fennl wasn’t sure of`,
    };
  }
  if (reason === "photos") {
    const n = photoInputs(draft).length;
    return { standing: "photos", detail: n === 1 ? "1 photo" : `${n} photos` };
  }
  return { standing: "ready", detail: null };
}

/** Whether the recipe box already has a recipe like this draft's. */
async function maybeDuplicate(job: ImportJobDetail): Promise<boolean> {
  const content = draftContent(job.draft);
  const matches = await activeSyncClient()
    ?.findDuplicates({
      title: content.title,
      urls: [job.page.url, job.draft.externalId, content.source.url],
      ingredients: content.ingredients.filter((l) => !l.heading).map((l) => l.text),
    })
    .catch(() => []);
  return (matches?.length ?? 0) > 0;
}

/**
 * Where a draft stands, for its label: null when it's gone (saved or discarded elsewhere),
 * undefined when it can't be fetched just now.
 */
export async function checkDraft(
  id: string,
  premium: boolean,
): Promise<DraftStanding | null | undefined> {
  const job = await importJob(id);
  if (!job) return job;
  if (job.status === "saved") return null;
  const found = draftStanding(job.draft, premium);
  // A draft that can't be saved, or has parts to check, says that first.
  if (found.standing === "blocked" || found.standing === "check") return found;
  if (await maybeDuplicate(job)) return { standing: "duplicate", detail: null };
  return found;
}

export async function saveMany(input: {
  jobs: { id: string; title: string }[];
  /** Drafts the person said to save anyway: parts to check, possible duplicates, photos. */
  anyway?: ReadonlySet<string>;
  tree: CategoryTree;
  me: string;
  /** Photos are part of the plan (Premium): a draft's photos are chosen on its own screen. */
  premium: boolean;
  /** The plan's photo limits, for a cover photo kept when saving anyway. */
  photoLimits?: { maxPerRecipe: number | null; maxFileBytes: number | null };
  cache: PhotoCache | null;
  now: () => number;
  onProgress: (done: number, total: number) => void;
}): Promise<SaveManyResult> {
  const { tree, me, premium, cache, now } = input;
  const anyway = input.anyway ?? new Set<string>();
  const result: SaveManyResult = { saved: [], left: [], originalsMissed: 0, photosMissed: 0 };
  const ready: { job: ImportJobDetail; recipeId: string }[] = [];
  let done = 0;
  for (const { id, title } of input.jobs) {
    input.onProgress(done++, input.jobs.length);
    const job = await importJob(id);
    if (!job || job.status === "saved") {
      result.left.push({ id, title, reason: job === undefined ? "not_saved" : "gone" });
      continue;
    }
    const reason = needsReview(job.draft, premium);
    if (reason === "blocked" || (reason && !anyway.has(id))) {
      result.left.push({ id, title, reason });
      continue;
    }
    if (!anyway.has(id) && (await maybeDuplicate(job))) {
      result.left.push({ id, title, reason: "duplicate" });
      continue;
    }
    ready.push({ job, recipeId: crypto.randomUUID() });
  }
  if (ready.length === 0) return result;

  // One save for them all, so categories two recipes share are made once.
  const time = now();
  const ctx = { me, now: time };
  const made = new Map<string, string>();
  const changes: SyncChange[] = [];
  for (const { job, recipeId } of ready) {
    changes.push(createChange(recipeId, job, draftContent(job.draft), time));
    const paths = (job.draft.categories?.value ?? [])
      .map(pathNames)
      .filter((names) => names.length > 0);
    changes.push(...fileRecipeUnder(tree, recipeId, paths, ctx, made).changes);
  }
  if (!(await saveChanges(changes))) {
    for (const { job } of ready) {
      result.left.push({ id: job.id, title: job.title, reason: "not_saved" });
    }
    return result;
  }
  for (const { job, recipeId } of ready) {
    result.saved.push(job.id);
    if (!cache) continue;
    if (originalHashes(job.draft).length > 0) {
      const kept = await keepOriginals({
        draft: job.draft,
        recipeId,
        ownerUserId: me,
        me,
        existing: [],
        cache,
      });
      if (!kept) result.originalsMissed += 1;
    }
    const [cover] = premium && anyway.has(job.id) ? photoInputs(job.draft) : [];
    if (cover !== undefined && !(await keepCover(job.id, cover, recipeId, me, cache, input))) {
      result.photosMissed += 1;
    }
  }
  input.onProgress(input.jobs.length, input.jobs.length);
  return result;
}

/** Saving anyway keeps only Fennl's cover photo, fetched through the server like any kept photo. */
async function keepCover(
  jobId: string,
  cover: number,
  recipeId: string,
  me: string,
  cache: PhotoCache,
  input: { photoLimits?: { maxPerRecipe: number | null; maxFileBytes: number | null } },
): Promise<boolean> {
  const res = await fetch(inputUrl(jobId, cover)).catch(() => null);
  if (!res?.ok) return false;
  const blob = await res.blob();
  const result = await addPhotos({
    files: [new File([blob], `photo-${cover}`, { type: blob.type })],
    recipeId,
    ownerUserId: me,
    kind: "dish",
    existingOrders: [],
    room: input.photoLimits?.maxPerRecipe ?? null,
    maxFileBytes: input.photoLimits?.maxFileBytes ?? null,
    cache,
  });
  return result.added > 0;
}

const LEFT: Record<LeftReason, string> = {
  check: "has parts to check",
  duplicate: "may already be in your recipes",
  photos: "has photos to choose",
  blocked: "can’t be saved until it’s finished",
  gone: "was already saved or removed",
  not_saved: "couldn’t be saved just now",
};

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", `${n}`));

/** What a save did, in a sentence or two. */
export function savedText(result: SaveManyResult): string {
  const parts: string[] = [];
  if (result.saved.length > 0) {
    parts.push(`Saved ${count(result.saved.length, "1 recipe", "# recipes")}.`);
  }
  if (result.originalsMissed > 0) {
    parts.push(
      result.originalsMissed === 1
        ? "For one of them, the pages it was read from couldn’t be kept with it."
        : `For ${result.originalsMissed} of them, the pages they were read from couldn’t be kept with them.`,
    );
  }
  if (result.photosMissed > 0) {
    parts.push(
      result.photosMissed === 1
        ? "For one of them, the cover photo couldn’t be added."
        : `For ${result.photosMissed} of them, the cover photo couldn’t be added.`,
    );
  }
  if (result.left.length > 0) {
    const list = result.left.map((l) => `${l.title} (${LEFT[l.reason]})`).join("; ");
    parts.push(
      `${count(result.left.length, "One is", "# are")} still waiting for you to review: ${list}.`,
    );
  }
  return parts.join(" ");
}
