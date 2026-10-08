import type { Recipe, RecipeMade, RecipeOpinion } from "../../shared/recipe";
import type { Cursors, PullResponse, SyncChange } from "../../shared/sync";
import type { CategoryData } from "../categories/tree";
import type { SearchResults } from "./search";

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
  /** The signed-in person's own rating and favorite (phase C8's filter). */
  myRating: number | null;
  favorite: boolean;
}

/** A recipe in Trash (phase C9). */
export interface TrashItem {
  id: string;
  title: string;
  /** When it went to Trash: it's deleted for good 30 days later. */
  deletedAt: string;
  /** Who added it, when that's someone else in the household. */
  addedBy: string | null;
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
  /** file: which copy, the account's own or an admin's while acting as them (phase C12). */
  | { op: "open"; userId: string; file: string }
  | { op: "snapshot" }
  | { op: "enqueue"; changes: SyncChange[]; now: string }
  | { op: "ack"; seqs: number[] }
  | { op: "applyPull"; page: PullResponse; now: string }
  | { op: "recheck"; now: string }
  | { op: "listRecipes" }
  | { op: "getRecipe"; recipeId: string }
  | { op: "getCategories" }
  | { op: "search"; query: string }
  | { op: "listTrash" }
  | { op: "wipe" };

export interface DbResults {
  open: null;
  snapshot: { cursors: Cursors; outbox: OutboxEntry[] };
  enqueue: { seqs: number[] };
  ack: null;
  applyPull: null;
  recheck: null;
  listRecipes: RecipeSummary[];
  getRecipe: RecipeDetail | null;
  getCategories: CategoryData;
  search: SearchResults;
  listTrash: TrashItem[];
  wipe: null;
}

export type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; busy: boolean; message: string };
