import { UNUSED_DAYS } from "../images/housekeeping";

// Photos a draft lets go of (U27 part 3, owner's choice 2026-11-22): once a discarded draft leaves
// nothing showing a photo, the usual 7-day housekeeping removes it. Housekeeping counts 7 days
// from when a recipe stopped showing a photo; a draft keeps no such time, so whenever drafts are
// removed (Done, Discard, Trash, deleted for good, no longer visible) their photos are held for 7
// days from then (image.held_until), in the same batch, just before the drafts go.

const DAY = 24 * 60 * 60 * 1000;

/**
 * Holds the photos shown by the drafts that `where` picks out (a condition on recipe_draft, with
 * its own numbered parameters in `params`) for UNUSED_DAYS from `now`. Run it just before the
 * statement that removes them, with the same condition.
 */
export function holdDraftPhotos(
  where: string,
  params: unknown[],
  now: number,
): { sql: string; params: unknown[] } {
  const until = Math.round(now + UNUSED_DAYS * DAY);
  return {
    sql: `update image set held_until = max(coalesce(held_until, 0), ${until})
      where deleted_at is null and (owner_user_id, hash) in (
        select recipe_draft.owner_user_id, json_extract(e.value, '$.imageHash')
        from recipe_draft, json_each(recipe_draft.content, '$.photos') e
        where ${where})`,
    params,
  };
}
