import { sql } from "drizzle-orm";
import type { Entitlements } from "../../shared/entitlements";
import type { Usage } from "../../shared/limits";
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

/** Usage with the limits that apply to it. */
export function usageWithLimits(counts: UsageCounts, plan: Entitlements): Usage {
  return {
    ...counts,
    maxRecipes: plan.max_recipes,
    maxTextBytes: plan.max_text_bytes,
    maxRecipeBytes: plan.max_recipe_bytes,
  };
}
