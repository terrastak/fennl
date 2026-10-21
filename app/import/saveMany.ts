import { draftContent, type RecipeDraft } from "../../shared/importDraft";
import type { ImportJobDetail } from "../../shared/importJobs";
import { recipeIssues } from "../../shared/recipe";
import type { SyncChange } from "../../shared/sync";
import { fileRecipeUnder, type CategoryTree } from "../categories/tree";
import type { PhotoCache } from "../photos/cache";
import { activeSyncClient, saveChanges } from "../sync/useSync";
import { importJob } from "./api";
import { keepOriginals, originalHashes } from "./originals";
import { createChange, fieldsToCheck, pathNames } from "./review";

// "Save selected" on the Import page (phase E12): several drafts saved at once, such as a PDF's
// recipes. Only drafts with nothing to look at are saved this way: a draft the importer wasn't
// sure of or has a note about, one that may already be in the recipes, one with photos to choose, or one that
// wouldn't pass the editor's checks stays waiting, to be opened and reviewed like any other.

/** Why a chosen draft was left waiting. */
export type LeftReason = "check" | "duplicate" | "photos" | "gone" | "not_saved";

export interface SaveManyResult {
  saved: string[];
  left: { id: string; title: string; reason: LeftReason }[];
  /** The page photos of a saved recipe couldn't all be kept with it. */
  originalsMissed: number;
}

/** What makes a draft need its own review, or null when it can be saved as it is. */
export function needsReview(draft: RecipeDraft, premium: boolean): "check" | "photos" | null {
  const content = draftContent(draft);
  if (recipeIssues(content, null).length > 0 || fieldsToCheck(draft).length > 0) return "check";
  const lines = [
    ...(draft.lineConfidence.ingredients ?? []),
    ...(draft.lineConfidence.directions ?? []),
  ];
  if (lines.some((c) => c !== "high")) return "check";
  if (Object.values(draft.unsureWords ?? {}).some((words) => words.length > 0)) return "check";
  if (draft.warnings.length > 0) return "check";
  if (premium && draft.photos.some((p) => p.role === "photo")) return "photos";
  return null;
}

export async function saveMany(input: {
  jobs: { id: string; title: string }[];
  tree: CategoryTree;
  me: string;
  /** Photos are part of the plan (Premium): a draft's photos are chosen on its own screen. */
  premium: boolean;
  cache: PhotoCache | null;
  now: () => number;
  onProgress: (done: number, total: number) => void;
}): Promise<SaveManyResult> {
  const { tree, me, premium, cache, now } = input;
  const result: SaveManyResult = { saved: [], left: [], originalsMissed: 0 };
  const client = activeSyncClient();
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
    if (reason) {
      result.left.push({ id, title, reason });
      continue;
    }
    const content = draftContent(job.draft);
    const matches = await client
      ?.findDuplicates({
        title: content.title,
        urls: [job.page.url, job.draft.externalId, content.source.url],
        ingredients: content.ingredients.filter((l) => !l.heading).map((l) => l.text),
      })
      .catch(() => []);
    if (matches && matches.length > 0) {
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
    if (!cache || originalHashes(job.draft).length === 0) continue;
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
  input.onProgress(input.jobs.length, input.jobs.length);
  return result;
}
