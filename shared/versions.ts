import type { RecipeContent } from "./recipe";

/**
 * Earlier versions of a recipe (phase E13; the first piece of G2's version history). Importing
 * again from Paprika updates the recipes that changed there; the version each had before is kept,
 * on every plan (owner's choice 2026-10-21), until someone in the household chooses which one to
 * keep: the recipe page says it was updated, with a way to compare and to put the earlier one
 * back.
 */

export const VERSION_REASONS = ["paprika_update"] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

/** Not plan limits: what one request handles. */
export const VERSION_RULES = {
  /** Recipes kept in one request (an import keeps them a batch at a time; D1 binds 100 values). */
  recipesPerRequest: 50,
} as const;

/** A recipe as it was: its content, and the importing person's own stars and note on it. */
export interface VersionSnapshot {
  content: RecipeContent;
  opinion: { userId: string; rating: number | null; note: string } | null;
}

export interface RecipeVersion {
  id: string;
  recipeId: string;
  reason: VersionReason;
  /** When it was replaced (ISO). */
  createdAt: string;
  /** Who replaced it, or null when that account is gone. */
  authorUserId: string | null;
  snapshot: VersionSnapshot;
}

/** POST /api/recipes/versions: keep these recipes' current versions before changing them. */
export interface KeepVersionsRequest {
  recipeIds: string[];
  reason: VersionReason;
}

export interface KeepVersionsResponse {
  /** The recipes whose version was kept now, or already had one waiting to be decided. */
  kept: string[];
}

export const isVersionReason = (value: unknown): value is VersionReason =>
  (VERSION_REASONS as readonly unknown[]).includes(value);
