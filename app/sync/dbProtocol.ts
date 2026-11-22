import type { DraftData, DraftPart, RecipeDraft } from "../../shared/drafts";
import type { DuplicateMatch, DuplicatePair, DuplicateQuery } from "../../shared/duplicates";
import type {
  ImportSource,
  Recipe,
  RecipeImport,
  RecipeMade,
  RecipeNote,
  RecipeOpinion,
  RecipePhoto,
} from "../../shared/recipe";
import type { LinkedRecipe } from "../../shared/subRecipes";
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
  /** The cover: the first gallery photo (phase D2), or null for none. */
  cover: PhotoRef | null;
  /** For the list's filters (phase C13a). Null when the recipe doesn't say. */
  prepMinutes: number | null;
  cookMinutes: number | null;
  /** How many it serves (`servings.count`). */
  servings: number | null;
  /** Where it came from: the site, cookbook or person. */
  sourceName: string | null;
  hasNutrition: boolean;
  /** The latest day anyone in the household made it ("2026-10-03"), or null if never. */
  lastMadeOn: string | null;
  /**
   * A new recipe still a draft (U27 part 3): in the person's own list with its Draft tag until
   * Done adds it to the recipe box. Absent for a recipe.
   */
  draft?: true;
}

/** Enough to show a photo: its image, and its size to make room for it. */
export interface PhotoRef {
  hash: string;
  width: number;
  height: number;
}

/** A recipe in Trash (phase C9). */
export interface TrashItem {
  id: string;
  title: string;
  /** When it went to Trash: it's deleted for good 30 days later. */
  deletedAt: string;
  /** Who added it, when that's someone else in the household. */
  addedBy: string | null;
  /** For its card on a laptop (U24), as the recipe list's: the cover, time and categories. */
  cover: PhotoRef | null;
  totalMinutes: number | null;
  categories: string[];
  myRating: number | null;
  favorite: boolean;
  /** Changed here, and the server hasn't confirmed it yet. */
  waiting: boolean;
}

/** A recipe imported from somewhere (phase E13), to match when importing from there again. */
export interface ImportedRecipe {
  id: string;
  ownerUserId: string;
  title: string;
  import: RecipeImport;
  inTrash: boolean;
  /** Gallery photos it has now. */
  galleryPhotos: number;
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
  /** Each person's rating and favorite (only those not removed). */
  opinions: RecipeOpinion[];
  /** "Made it" records, newest first (only those not taken back). */
  made: RecipeMade[];
  /** Notes added in Fennl, oldest first (U7; only those not removed). */
  notes: RecipeNote[];
  categories: string[];
  /** The household, the signed-in person first. */
  members: Member[];
  /** Photos not removed, in order: the first gallery photo is the cover (phase D2). */
  photos: RecipePhoto[];
  /** The recipes its ingredients link to, and theirs, by ID (phase F3). */
  linked: Record<string, LinkedRecipe>;
  /**
   * Who changed its gallery photos and its categories, and when (removed ones too), for Done's
   * question on a draft (U27 part 3). Only changes that say who made them.
   */
  changes?: { photos: ChangeMark[]; categories: ChangeMark[] };
}

/** Someone changed a photo or a category link, at this time. */
export interface ChangeMark {
  userId: string;
  at: string;
}

/** A recipe as printed (phase F6). */
export interface PrintedRecipe {
  recipe: Recipe;
  /** The recipe whose ingredient links to this one, when it's printed because of that. */
  linkedFrom: string | null;
  /** Each person's rating (only those not removed). */
  opinions: RecipeOpinion[];
  /** Notes added in Fennl, oldest first (U7). */
  notes: RecipeNote[];
  categories: string[];
  cover: RecipePhoto | null;
  /** The titles of the working recipes its ingredients link to, by ID (phase F3). */
  links: Record<string, string>;
}

/** Recipes to print, in order, and the household whose names sign their notes. */
export interface PrintSet {
  members: Member[];
  recipes: PrintedRecipe[];
}

/** A draft as this device keeps it (U27 part 3; app/sync/schema.ts, table draft). */
export interface LocalDraft {
  recipeId: string;
  /** The recipe's owner; for a new recipe, the person. */
  ownerUserId: string;
  /** No recipe exists yet: Done creates it. */
  isNew: boolean;
  data: DraftData;
  /** When the draft began and was last edited, in milliseconds. */
  startedAt: number;
  editedAt: number;
  /** This version is in the account ("Draft saved"). */
  inAccount: boolean;
  /** The server turned this version away (too many drafts, too large); kept here meanwhile. */
  problem: string | null;
  /** Counts every write here: the editor acts (Done, Discard) only on the version it shows. */
  version: number;
  /** The latest write came from the account (a newer draft from another device). */
  fromServer: boolean;
}

/** A draft as written by the editor. */
export interface LocalDraftWrite {
  recipeId: string;
  ownerUserId: string;
  isNew: boolean;
  data: DraftData;
  startedAt: number;
  editedAt: number;
}

/** A draft waiting to go to the account: sent whole, or removed (Done, Discard). */
export interface DraftToSend {
  recipeId: string;
  deleting: boolean;
  data: DraftData;
  startedAt: number;
  editedAt: number;
  /**
   * For a removal, the newest version it may remove: the server's own time for the version this
   * device has, or (written here and not yet confirmed) this device's time for it.
   */
  upTo: { editedAt: number } | { deviceEditedAt: number };
}

/** A draft as the Drafts page, the left panel and the recipe page show it (U27 part 3). */
export interface DraftItem {
  recipeId: string;
  ownerUserId: string;
  isNew: boolean;
  /** The draft's title, else the saved recipe's; "" for an untitled new recipe. */
  title: string;
  /** What an untitled new recipe's card says after "Untitled · " (shared/drafts.ts). */
  untitledHint: string | null;
  /** The parts it changes (a saved recipe), or has something in (a new one). */
  parts: DraftPart[];
  startedAt: number;
  editedAt: number;
  inAccount: boolean;
  /** For its card, the draft's over the saved recipe's. */
  cover: PhotoRef | null;
  totalMinutes: number | null;
  categories: string[];
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
  | { op: "ingredientMatches"; words: string[] }
  | { op: "suggestCategories"; recipeId: string }
  | { op: "listTrash" }
  | { op: "countTrash" }
  | { op: "photoHashes" }
  | { op: "findDuplicates"; query: DuplicateQuery }
  | { op: "findDuplicatePairs" }
  | { op: "importedRecipes"; source: ImportSource }
  | { op: "recipeLinks" }
  | { op: "printRecipes"; recipeIds: string[]; withLinked: boolean }
  | { op: "putDraft"; draft: LocalDraftWrite }
  /** version: the version the editor shows; another one here (newer) stays. */
  | { op: "dropDraft"; recipeId: string; version: number | null }
  | {
      op: "finishDraft";
      recipeId: string;
      changes: SyncChange[];
      now: string;
      version: number | null;
    }
  /** Done's changes the server refused for good: their drafts come back. */
  | { op: "finishRefused"; seqs: number[] }
  | { op: "getDraft"; recipeId: string }
  | { op: "listDrafts" }
  | { op: "draftsToSend" }
  | { op: "draftSent"; recipeId: string; editedAt: number; server: RecipeDraft; kept: boolean }
  | { op: "draftRefused"; recipeId: string; editedAt: number; problem: string }
  | { op: "draftGone"; recipeId: string }
  | {
      op: "applyDrafts";
      drafts: RecipeDraft[];
      ids: { recipeId: string; editedAt: string }[] | null;
    }
  | { op: "tidyDrafts" }
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
  ingredientMatches: Record<string, string[]>;
  /** Category paths worth suggesting for a recipe (phase C13c). */
  suggestCategories: string[];
  listTrash: TrashItem[];
  /** How many recipes are in Trash, for the left panel's Trash link (U21). */
  countTrash: number;
  /** Every image a photo here shows (phase D2), so each device can keep their small copies. */
  photoHashes: string[];
  /** Recipes an import may duplicate (phase E4). */
  findDuplicates: DuplicateMatch[];
  /** Pairs of recipes in the library that may be the same recipe (phase C14). */
  findDuplicatePairs: DuplicatePair[];
  /** Recipes in the household imported from a source, Trash included (phase E13). */
  importedRecipes: ImportedRecipe[];
  /** Every recipe's linked recipes, by recipe ID (phase F3). */
  recipeLinks: Record<string, string[]>;
  /** Recipes to print, each chosen one followed by those it links to when asked (phase F6). */
  printRecipes: PrintSet;
  /** The version written. */
  putDraft: { version: number };
  /** stale: a newer version is here than the one the editor showed; nothing was removed. */
  dropDraft: { stale: boolean };
  /** The outbox's new entries, as enqueue; stale as dropDraft (nothing queued). */
  finishDraft: { seqs: number[]; stale: boolean };
  finishRefused: null;
  getDraft: LocalDraft | null;
  /** Newest change first. */
  listDrafts: DraftItem[];
  draftsToSend: DraftToSend[];
  draftSent: null;
  draftRefused: null;
  draftGone: null;
  applyDrafts: null;
  tidyDrafts: null;
  wipe: null;
}

export type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; busy: boolean; message: string };
