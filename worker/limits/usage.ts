import { sql } from "drizzle-orm";
import type { Entitlements } from "../../shared/entitlements";
import type { MemberPhotos, PhotoUsage, Usage } from "../../shared/limits";
import type { Database } from "../db/client";

// A household's recipe usage (phase C11): recipes not in Trash, and the bytes of recipe text,
// Trash included. Recipes are owned per person and a household shares them (CLAUDE.md, "Recipe
// ownership in households"), so it's everything its members own. Read from one index
// (recipe_owner_usage_idx), so it stays quick however many recipes there are.

export interface UsageCounts {
  recipes: number;
  textBytes: number;
}

export async function householdUsage(db: Database, householdId: string): Promise<UsageCounts> {
  const row = await db.get<{ recipes: number | null; textBytes: number | null }>(sql`
    select sum(case when deleted_at is null then 1 else 0 end) as recipes,
      sum(text_bytes) as textBytes
    from recipe
    where owner_user_id in (select user_id from member where organization_id = ${householdId})`);
  return { recipes: row?.recipes ?? 0, textBytes: row?.textBytes ?? 0 };
}

/**
 * Each member's photos (phase D3), from the same index as the quota check
 * (image_owner_usage_idx), with the end of their photo grace period if one is under way.
 */
export async function householdPhotos(db: Database, householdId: string): Promise<MemberPhotos[]> {
  const rows = await db.all<MemberPhotos>(sql`
    select m.user_id as userId, u.name as name,
      coalesce((select sum(bytes) from image i
        where i.owner_user_id = m.user_id and i.deleted_at is null), 0) as bytes,
      (select count(*) from image i
        where i.owner_user_id = m.user_id and i.deleted_at is null) as count,
      (select delete_after from photo_grace g
        where g.user_id = m.user_id and g.ended_at is null) as deleteAfter
    from member m join user u on u.id = m.user_id
    where m.organization_id = ${householdId}
    order by m.created_at, m.user_id`);
  return rows;
}

/** Usage with the limits that apply to it, and the household's photos when given. */
export function usageWithLimits(
  counts: UsageCounts,
  plan: Entitlements,
  members?: MemberPhotos[],
): Usage {
  const usage: Usage = {
    ...counts,
    maxRecipes: plan.max_recipes,
    maxTextBytes: plan.max_text_bytes,
    maxRecipeBytes: plan.max_recipe_bytes,
  };
  if (!members) return usage;
  const photos: PhotoUsage = {
    enabled: plan.images_enabled,
    bytes: members.reduce((sum, m) => sum + m.bytes, 0),
    count: members.reduce((sum, m) => sum + m.count, 0),
    maxBytes: plan.image_quota_bytes,
    maxCount: plan.image_quota_count,
    members,
  };
  return { ...usage, photos };
}
