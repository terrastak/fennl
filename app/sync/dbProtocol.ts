import type { Recipe, RecipeMade, RecipeOpinion } from "../../shared/recipe";
import type { Cursors, PullResponse, SyncChange } from "../../shared/sync";

/**
 * Messages between a tab and its local database worker (phase C4). Each message also carries
 * the request's own `id` (app/sync/dbClient.ts), so no request has a field named `id`.
 */

/** A recipe as the list shows it. */
export interface RecipeSummary {
  id: string;
  title: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  /** Total time in minutes, when known. */
  totalMinutes: number | null;
  /** Category paths ("Desserts › Cakes"), sorted. */
  categories: string[];
  /** Who added it, when that's someone else in the household. */
  addedBy: string | null;
  /** Changed here, and the server hasn't confirmed it yet. */
  waiting: boolean;
}

/** A person in the household. */
export interface Member {
  userId: string;
  name: string;
}

/** Everything the recipe page shows (phase C5). */
export interface RecipeDetail {
  recipe: Recipe;
  waiting: boolean;
  /** Each person's rating, favorite and note (only those not removed). */
  opinions: RecipeOpinion[];
  /** "Made it" records, newest first (only those not taken back). */
  made: RecipeMade[];
  categories: string[];
  /** The household, the signed-in person first. */
  members: Member[];
}

/** A change waiting to be sent, in the order it was made. */
export interface OutboxEntry {
  seq: number;
  change: SyncChange;
}

export type DbRequest =
  | { op: "open"; userId: string }
  | { op: "snapshot" }
  | { op: "enqueue"; change: SyncChange; now: string }
  | { op: "ack"; seqs: number[] }
  | { op: "applyPull"; page: PullResponse; now: string }
  | { op: "recheck"; now: string }
  | { op: "listRecipes" }
  | { op: "getRecipe"; recipeId: string }
  | { op: "wipe" };

export interface DbResults {
  open: null;
  snapshot: { cursors: Cursors; outbox: OutboxEntry[] };
  enqueue: { seq: number };
  ack: null;
  applyPull: null;
  recheck: null;
  listRecipes: RecipeSummary[];
  getRecipe: RecipeDetail | null;
  wipe: null;
}

export type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; busy: boolean; message: string };
