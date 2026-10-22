import type { KeepVersionsResponse, RecipeVersion, VersionReason } from "../../shared/versions";

// Earlier versions of recipes (phase E13; worker/versions/routes.ts): kept before importing
// again changes a recipe, read by the recipe page to compare and put back.

/** Keeps these recipes as the server has them now. Null when it couldn't be reached. */
export async function keepVersions(
  recipeIds: string[],
  reason: VersionReason,
): Promise<string[] | null> {
  try {
    const res = await fetch("/api/recipes/versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeIds, reason }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as KeepVersionsResponse).kept;
  } catch {
    return null;
  }
}

/** A recipe's earlier versions nobody has decided on, oldest first; empty when offline. */
export async function recipeVersions(recipeId: string): Promise<RecipeVersion[]> {
  try {
    const res = await fetch(`/api/recipes/${encodeURIComponent(recipeId)}/versions`);
    if (!res.ok) return [];
    return ((await res.json()) as { versions: RecipeVersion[] }).versions;
  } catch {
    return [];
  }
}

/** The household chose which version to keep: the earlier one goes. */
export async function settleVersion(recipeId: string, versionId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/recipes/${encodeURIComponent(recipeId)}/versions/${encodeURIComponent(versionId)}`,
      { method: "DELETE" },
    );
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
