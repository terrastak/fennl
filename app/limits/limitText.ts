import type { AddLimit, MemberPhotos, PhotoUsage, Usage } from "../../shared/limits";
import { formatBytes } from "../pages/plan";

// What the app says about plan limits (phase C11; rules in shared/limits.ts). Plain and kind:
// over a limit nothing is lost, only adding waits for room.

const recipes = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

/** "87 of 100 recipes", or "412 recipes" with no limit. */
export function recipesLine(usage: Usage): string {
  return usage.maxRecipes === null
    ? recipes(usage.recipes)
    : `${usage.recipes} of ${recipes(usage.maxRecipes)}`;
}

/** "1.2 MB of 3 MB of recipe text", or "1.2 MB of recipe text" with no limit. */
export function textLine(usage: Usage): string {
  const used = formatBytes(usage.textBytes);
  return usage.maxTextBytes === null
    ? `${used} of recipe text`
    : `${used} of ${formatBytes(usage.maxTextBytes)} of recipe text`;
}

/** Said wherever adding is blocked. */
export const NOTHING_LOST = "Everything you have stays yours to read, change and download.";

function countText(usage: Usage): string {
  const max = usage.maxRecipes ?? 0;
  return usage.recipes > max
    ? `You have ${recipes(usage.recipes)}, and your plan includes ${max}.`
    : `You have ${recipes(usage.recipes)}, as many as your plan includes.`;
}

/** Why a new recipe can't be added, and how to make room. */
export function addBlockedText(limit: AddLimit, usage: Usage): string {
  if (limit === "max_recipes") {
    return `${countText(usage)} To add another, move one you don’t need to Trash.`;
  }
  return `Your recipes hold ${formatBytes(usage.textBytes)} of text, and your plan includes ${formatBytes(
    usage.maxTextBytes ?? 0,
  )}. To add another, delete recipes you don’t need for good: move them to Trash, then empty it.`;
}

/** Why a recipe in Trash can't be put back yet. */
export function restoreBlockedText(usage: Usage): string {
  return `${countText(usage)} To put this one back, move another recipe to Trash first.`;
}

/** New recipes kept on this device because the server turned them away for a limit. */
export const HELD_TEXT =
  "A new recipe made on this device isn’t in your account yet, because your plan’s limit is reached. It’s kept here and saved as soon as there’s room.";

/** The editor's word for a recipe over the per-recipe cap. */
export const TOO_LARGE_TEXT =
  "This recipe is unusually large, so changes can’t be saved. Shorten it, or split it into two recipes.";

// Photos (phase D3).

const photoCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`;

/** "1.2 GB of 5 GB of photos", or "1.2 GB of photos" without a quota (or without photos). */
export function photosLine(photos: PhotoUsage): string {
  const used = formatBytes(photos.bytes);
  return photos.enabled && photos.maxBytes !== null
    ? `${used} of ${formatBytes(photos.maxBytes)} of photos`
    : `${used} of photos`;
}

/** "14,200 of 15,000 photos". */
export function photoCountLine(photos: PhotoUsage): string {
  return photos.maxCount === null
    ? photoCount(photos.count)
    : `${photos.count.toLocaleString()} of ${photoCount(photos.maxCount)}`;
}

/** One member's share: "Sarah: 400 MB, 102 photos". */
export function memberPhotosLine(member: MemberPhotos): string {
  return `${member.name || "Someone"}: ${formatBytes(member.bytes)}, ${photoCount(member.count)}`;
}

const longDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/**
 * During the 90-day grace period: until when photos are kept. `yours`: the household is just
 * this person.
 */
export function graceText(member: MemberPhotos, yours: boolean): string {
  const date = longDate(member.deleteAfter ?? 0);
  return `${yours ? "Your photos are" : `Photos added by ${member.name || "a member"} are`} kept until ${date}, then deleted, because the plan no longer includes photos. Until then they can be viewed and downloaded with your recipes. With Premium again before then, they stay.`;
}

/** Said in the photo editor when the household's photos are near or at the quota. */
export function photosNearText(photos: PhotoUsage, full: boolean): string {
  const line = `Photo storage: ${photosLine(photos)}.`;
  return full
    ? `${line} It’s full, so photos can’t be added. Remove some photos to make room.`
    : line;
}
