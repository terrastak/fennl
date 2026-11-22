import {
  CATEGORY_SEPARATOR,
  DIFFICULTIES,
  NUTRIENTS,
  NUTRITION_SOURCES,
  RECIPE_FIELDS,
  SOURCE_KINDS,
  emptyRecipeContent,
  isCategoryName,
  recipeBytes,
  isId,
  type RecipeContent,
  type RecipeField,
} from "./recipe";

// Drafts (U27 part 3, owner's choices 2026-11-21 and 22). Every change in the recipe editor is
// kept as a draft, in the person's account, about a second after typing stops; the recipe in the
// recipe box doesn't change until Done. One draft per person per recipe, with no time limit; a
// draft goes when its recipe goes to Trash. A partner sees nothing of a draft until Done.
//
// A draft holds only what the person changed: the changed fields, the intended gallery and the
// intended categories, plus the saved value each changed part started from (so Done can tell
// whether a partner changed the same part meanwhile). Kept on the server in recipe_draft
// (worker/drafts/), and on the device in its own copy (app/sync/).

/**
 * Sanity caps per person and per draft (not plan limits: every plan gets the same). How big one
 * draft may be follows the plan's per-recipe size (draftFits).
 */
export const MAX_DRAFTS = 200;
/** A draft's stored size (JSON) is always allowed up to this, whatever the plan. */
export const MAX_DRAFT_BYTES = 900_000;
/** The most any request to keep a draft may carry, whatever the plan. */
export const MAX_DRAFT_REQUEST_BYTES = 4_000_000;
export const MAX_DRAFT_PHOTOS = 60;
export const MAX_DRAFT_CATEGORIES = 100;
/** Longest text a draft keeps in one string (what's typed may be longer than a recipe allows). */
const MAX_DRAFT_TEXT = 100_000;
/** Most lines in a draft's ingredient or direction list. */
const MAX_DRAFT_LINES = 2000;
/** Deepest category path ("Desserts › Cakes › Chocolate"). */
const MAX_CATEGORY_DEPTH = 10;

/** A photo in a draft's gallery, in order (the first is the cover). */
export interface DraftPhoto {
  /** The recipe photo's id: a saved photo's own, or a new one made on the device. */
  id: string;
  /** SHA-256 of the image, uploaded for the recipe's owner. */
  imageHash: string;
  width: number;
  height: number;
  /** When it was taken, if the photo says (as RecipePhoto.takenAt). */
  takenAt: number | null;
}

export interface DraftData {
  /** What the person changed. A new recipe: every field. */
  fields: Partial<RecipeContent>;
  /** Each changed field's saved value when the draft first changed it ({} for a new recipe). */
  base: Partial<RecipeContent>;
  /** The intended gallery in order, or null when the photos weren't changed. */
  photos: DraftPhoto[] | null;
  /** The saved gallery's photo ids in order when the photos were first changed. */
  basePhotos: string[] | null;
  /** The person moved a photo or chose the cover in this draft. */
  photosArranged: boolean;
  /** The intended categories as paths of names, or null when they weren't changed. */
  categories: string[][] | null;
  /** The saved categories' path keys (categoryPathKey) when the categories were first changed. */
  baseCategories: string[] | null;
}

/** A draft as the server answers it (GET and PUT /api/drafts). Times are the server's. */
export interface RecipeDraft {
  recipeId: string;
  /** The recipe's owner; for a new recipe, the person. */
  ownerUserId: string;
  /** No recipe exists yet: Done creates it. */
  isNew: boolean;
  data: DraftData;
  startedAt: string;
  editedAt: string;
  updatedAt: string;
}

/** GET /api/drafts?since=<cursor>. */
export interface DraftsResponse {
  /** The person's drafts changed after the cursor. */
  drafts: RecipeDraft[];
  /** Every draft the person has now, so a device can drop the ones that went. */
  ids: { recipeId: string; editedAt: string }[];
  /** For the next ?since. */
  cursor: number;
  /** More drafts are waiting: ask again with the cursor. */
  more: boolean;
}

/** PUT /api/drafts/:recipeId. */
export interface DraftPutRequest {
  draft: DraftData;
  /** When the draft began and was last edited, and when this was sent, by the device's clock. */
  startedAt: number;
  editedAt: number;
  sentAt: number;
}

export interface DraftPutResponse {
  /** The draft as stored: this one, or a newer one from another device. */
  draft: RecipeDraft;
  /** Whether this one was kept (false: the stored draft is newer). */
  kept: boolean;
}

export type DraftError =
  | "invalid_request"
  | "invalid_draft"
  | "too_large"
  | "too_many"
  | "in_trash"
  | "not_found"
  | "rate_limited"
  /** A new recipe's draft with no room left under the plan's recipe or text limits. */
  | "limit";

/**
 * A draft's text as recipeBytes counts it (shared/recipe.ts), for the plan's limits: its fields
 * over an empty recipe (a saved recipe's draft holds only the changed fields).
 */
export function draftTextBytes(data: DraftData): number {
  return recipeBytes({ ...emptyRecipeContent(), ...data.fields });
}

/**
 * Whether a draft is small enough to keep in the account, by the plan's per-recipe size
 * (max_recipe_bytes, null: no limit): its text up to twice that (what's typed may be over the
 * size while the person cuts it down; Done still holds the limit), and its stored size up to
 * four times that (a field and the saved value it started from, with line ids), never less than
 * MAX_DRAFT_BYTES and never more than MAX_DRAFT_REQUEST_BYTES.
 */
export function draftFits(storedBytes: number, textBytes: number, maxRecipeBytes: number | null) {
  if (storedBytes > MAX_DRAFT_REQUEST_BYTES) return false;
  if (maxRecipeBytes === null) return true;
  return (
    textBytes <= 2 * maxRecipeBytes && storedBytes <= Math.max(MAX_DRAFT_BYTES, 4 * maxRecipeBytes)
  );
}

// ---------------------------------------------------------------------------------------------
// Parts, as the editor names them
// ---------------------------------------------------------------------------------------------

export type DraftPart =
  | "Title"
  | "About this recipe"
  | "Time and servings"
  | "Ingredients"
  | "Directions"
  | "Photos"
  | "Categories"
  | "Notes"
  | "Where it’s from"
  | "Nutrition per serving";

/**
 * In the order they're named on a card and in Done's question: words first. Each is the editor's
 * own name for the section ("Time and servings" heads the times, Serves or makes and Difficulty).
 */
export const DRAFT_PARTS: readonly DraftPart[] = [
  "Title",
  "About this recipe",
  "Time and servings",
  "Ingredients",
  "Directions",
  "Photos",
  "Categories",
  "Notes",
  "Where it’s from",
  "Nutrition per serving",
];

export const FIELD_PART: Record<RecipeField, DraftPart> = {
  title: "Title",
  description: "About this recipe",
  times: "Time and servings",
  servings: "Time and servings",
  difficulty: "Time and servings",
  difficultyText: "Time and servings",
  ingredients: "Ingredients",
  directions: "Directions",
  notes: "Notes",
  source: "Where it’s from",
  nutrition: "Nutrition per serving",
};

/** Parts in DRAFT_PARTS order, each once. */
export function sortParts(parts: Iterable<DraftPart>): DraftPart[] {
  const set = new Set(parts);
  return DRAFT_PARTS.filter((part) => set.has(part));
}

/**
 * Parts as words. "list": "Ingredients, Photos" (a card's "Changed today: …"). "sentence":
 * "Ingredients and Notes", "Ingredients, Directions and Notes" (Done's question).
 */
export function partsText(parts: DraftPart[], form: "list" | "sentence" = "list"): string {
  const sorted = sortParts(parts);
  if (form === "list" || sorted.length < 2) return sorted.join(", ");
  return `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

// ---------------------------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------------------------

/** Deep equality of JSON values, ignoring key order; an absent key equals undefined. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((value, i) => sameValue(value, other[i]));
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const key of keys) {
    if (x[key] === undefined && y[key] === undefined) continue;
    if (!sameValue(x[key], y[key])) return false;
  }
  return true;
}

/** A category path's key: its names joined and lower-cased (app/categories/tree.ts pathKey). */
export const categoryPathKey = (names: string[]) =>
  names.join(CATEGORY_SEPARATOR).toLocaleLowerCase();

const sameKeys = (a: string[], b: string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((key, i) => key === y[i]);
};

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The recipe box's version of a recipe, as drafts compare against it. */
export interface SavedForDraft {
  content: RecipeContent;
  /** Gallery photo ids in order (the cover first; import originals left out). */
  galleryIds: string[];
  /** Category path keys (categoryPathKey). */
  categoryKeys: string[];
}

const EMPTY = emptyRecipeContent();

/** Nothing written in a field: blank words, no lines with words, nothing chosen. */
function fieldIsEmpty(field: RecipeField, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (field === "ingredients" || field === "directions") {
    return (value as { text?: unknown }[]).every(
      (line) => typeof line.text !== "string" || line.text.trim() === "",
    );
  }
  if (field === "times") {
    const times = value as RecipeContent["times"];
    return (["prep", "cook", "total"] as const).every(
      (which) => times[which]?.minutes == null && !times[which]?.text?.trim(),
    );
  }
  if (field === "servings") {
    const servings = value as RecipeContent["servings"];
    return servings.count == null && !servings.yield?.trim();
  }
  if (field === "source") {
    const source = value as RecipeContent["source"];
    return (
      source.kind === null &&
      [source.name, source.url, source.author, source.page].every((v) => !v?.trim())
    );
  }
  return sameValue(value, EMPTY[field]);
}

/** A new recipe with nothing typed or added: never kept as a draft. */
export function isEmptyDraft(data: DraftData): boolean {
  return (
    RECIPE_FIELDS.every((field) => fieldIsEmpty(field, data.fields[field])) &&
    !data.photos?.length &&
    !data.categories?.length
  );
}

/**
 * The parts a draft changes now: for a saved recipe, those that differ from the recipe box's
 * version; for a new recipe (`saved` null), those with something in them. Empty: nothing to
 * apply (a saved recipe's draft that has become the same as the recipe can go).
 */
export function draftParts(saved: SavedForDraft | null, data: DraftData): DraftPart[] {
  const parts = new Set<DraftPart>();
  for (const field of RECIPE_FIELDS) {
    if (!(field in data.fields)) continue;
    const value = data.fields[field];
    const changed = saved ? !sameValue(value, saved.content[field]) : !fieldIsEmpty(field, value);
    if (changed) parts.add(FIELD_PART[field]);
  }
  if (data.photos) {
    const ids = data.photos.map((photo) => photo.id);
    if (saved ? !sameOrder(ids, saved.galleryIds) : ids.length > 0) parts.add("Photos");
  }
  if (data.categories) {
    const keys = data.categories.map(categoryPathKey);
    if (saved ? !sameKeys(keys, saved.categoryKeys) : keys.length > 0) parts.add("Categories");
  }
  return sortParts(parts);
}

/** The recipe box's version at Done, with who last changed each field (recipe.field_by). */
export interface SavedAtDone extends SavedForDraft {
  fieldBy?: Partial<Record<RecipeField, string>>;
  /** Who last changed the recipe at all: for fields changed before field_by was kept. */
  updatedByUserId: string;
  /** Who changed the recipe's gallery photos since the draft began, by who changed each one. */
  photosBy: string[];
  /** Who added or took out the recipe's categories since the draft began. */
  categoriesBy: string[];
}

export interface DraftConflict {
  /** The partner who also changed these parts. */
  userId: string;
  parts: DraftPart[];
}

/**
 * Parts someone else in the household changed while this draft waited, which the draft changes
 * too (owner's choice 2026-11-21: Done asks once, naming the parts). A part conflicts when its
 * saved value is no longer the one the draft started from, isn't already what the draft has, and
 * was changed by another current member. Fields know who changed them (`fieldBy`, else the
 * recipe's last changer); photos and categories by who changed them since the draft began
 * (`photosBy`, `categoriesBy`), so the person's own changes outside the draft (on the recipe page,
 * on another device) are never asked about. A person on their own is never asked. Grouped by
 * person, parts in order.
 */
export function draftConflicts(args: {
  me: string;
  /** The household's current members, the caller included. */
  members: string[];
  saved: SavedAtDone;
  data: DraftData;
}): DraftConflict[] {
  const { me, members, saved, data } = args;
  const others = members.filter((id) => id !== me);
  if (others.length === 0) return [];
  const byPerson = new Map<string, Set<DraftPart>>();
  const add = (userId: string, part: DraftPart) => {
    const parts = byPerson.get(userId) ?? new Set<DraftPart>();
    parts.add(part);
    byPerson.set(userId, parts);
  };
  for (const field of RECIPE_FIELDS) {
    if (!(field in data.fields) || !(field in data.base)) continue;
    const now = saved.content[field];
    if (sameValue(now, data.base[field]) || sameValue(now, data.fields[field])) continue;
    const who = saved.fieldBy?.[field] ?? saved.updatedByUserId;
    if (others.includes(who)) add(who, FIELD_PART[field]);
  }
  const partnerOf = (by: string[]) => by.find((id) => others.includes(id));
  if (data.photos && data.basePhotos) {
    const ids = data.photos.map((photo) => photo.id);
    const who = partnerOf(saved.photosBy);
    if (who && !sameOrder(saved.galleryIds, data.basePhotos) && !sameOrder(saved.galleryIds, ids)) {
      add(who, "Photos");
    }
  }
  if (data.categories && data.baseCategories) {
    const keys = data.categories.map(categoryPathKey);
    const who = partnerOf(saved.categoriesBy);
    if (
      who &&
      !sameKeys(saved.categoryKeys, data.baseCategories) &&
      !sameKeys(saved.categoryKeys, keys)
    ) {
      add(who, "Categories");
    }
  }
  return [...byPerson].map(([userId, parts]) => ({ userId, parts: sortParts(parts) }));
}

// ---------------------------------------------------------------------------------------------
// An untitled new recipe's label
// ---------------------------------------------------------------------------------------------

/** About how long the words after "Untitled · " may be. */
const HINT_LENGTH = 40;

function cut(text: string): string {
  const tidy = text.replace(/\s+/g, " ").trim();
  if (tidy.length <= HINT_LENGTH) return tidy;
  const head = tidy.slice(0, HINT_LENGTH + 1);
  const space = head.lastIndexOf(" ");
  const words = (space > 10 ? head.slice(0, space) : tidy.slice(0, HINT_LENGTH)).replace(
    /[\s,;:.\-–—]+$/,
    "",
  );
  return `${words}…`;
}

const lineWords = (lines: { text?: unknown; heading?: unknown }[] | undefined) =>
  (lines ?? [])
    .filter((line) => !line.heading && typeof line.text === "string" && line.text.trim())
    .map((line) => (line.text as string).trim());

/**
 * What an untitled new recipe's card says after "Untitled · " (approved 2026-11-22): its first
 * ingredients ("2 cups flour, 1 tsp salt…"), else the start of its first step ("Heat the oven to
 * 350°F…"), else its notes, else its About text; null when none has words (the card shows its
 * first photo, if any, and just "Untitled").
 */
export function untitledHint(data: DraftData): string | null {
  const ingredients = lineWords(data.fields.ingredients);
  if (ingredients.length > 0) return cut(ingredients.join(", "));
  const steps = lineWords(data.fields.directions);
  if (steps.length > 0) return cut(steps[0] as string);
  for (const text of [data.fields.notes, data.fields.description]) {
    if (typeof text === "string" && text.trim()) return cut(text);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Checking what a device sends
// ---------------------------------------------------------------------------------------------

const HASH = /^[0-9a-f]{64}$/;

const isText = (value: unknown) => typeof value === "string" && value.length <= MAX_DRAFT_TEXT;
const isTextOrNull = (value: unknown) => value === null || isText(value);
const isNumberOrNull = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isFinite(value));
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = (value: unknown, allowed: readonly string[]) =>
  typeof value === "string" && allowed.includes(value);

function isLines(value: unknown, ingredients: boolean): boolean {
  if (!Array.isArray(value) || value.length > MAX_DRAFT_LINES) return false;
  return value.every(
    (line: unknown) =>
      isObject(line) &&
      typeof line.id === "string" &&
      line.id.length <= 100 &&
      isText(line.text) &&
      typeof line.heading === "boolean" &&
      (line.headingByHand === undefined || typeof line.headingByHand === "boolean") &&
      (line.linkedRecipeId == null || isId(line.linkedRecipeId)) &&
      (!ingredients || line.parsed == null || isObject(line.parsed)),
  );
}

/** Each field's shape, as stored on a recipe (what's typed is kept even with a problem). */
const FIELD_SHAPES: Record<RecipeField, (value: unknown) => boolean> = {
  title: isText,
  description: isText,
  notes: isText,
  ingredients: (value) => isLines(value, true),
  directions: (value) => isLines(value, false),
  times: (value) =>
    isObject(value) &&
    (["prep", "cook", "total"] as const).every((which) => {
      const time = value[which];
      return isObject(time) && isNumberOrNull(time.minutes) && isTextOrNull(time.text);
    }),
  servings: (value) => isObject(value) && isNumberOrNull(value.count) && isTextOrNull(value.yield),
  source: (value) =>
    isObject(value) &&
    (value.kind === null || oneOf(value.kind, SOURCE_KINDS)) &&
    (["name", "url", "author", "page"] as const).every((key) => isTextOrNull(value[key])),
  difficulty: (value) => value === null || oneOf(value, DIFFICULTIES),
  difficultyText: isTextOrNull,
  nutrition: (value) =>
    value === null ||
    (isObject(value) &&
      oneOf(value.source, NUTRITION_SOURCES) &&
      isTextOrNull(value.text) &&
      isObject(value.perServing) &&
      Object.entries(value.perServing).every(
        ([key, amount]) => key in NUTRIENTS && isNumberOrNull(amount),
      )),
};

function isContent(value: unknown): boolean {
  if (!isObject(value)) return false;
  return Object.entries(value).every(
    ([key, field]) =>
      (RECIPE_FIELDS as readonly string[]).includes(key) && FIELD_SHAPES[key as RecipeField](field),
  );
}

function isPhotos(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_DRAFT_PHOTOS) return false;
  const ids = new Set<string>();
  return value.every((photo: unknown) => {
    if (!isObject(photo) || !isId(photo.id) || ids.has(photo.id)) return false;
    ids.add(photo.id);
    return (
      typeof photo.imageHash === "string" &&
      HASH.test(photo.imageHash) &&
      Number.isInteger(photo.width) &&
      (photo.width as number) > 0 &&
      Number.isInteger(photo.height) &&
      (photo.height as number) > 0 &&
      isNumberOrNull(photo.takenAt ?? null)
    );
  });
}

const isIdList = (value: unknown, max: number, item: (id: unknown) => boolean) =>
  Array.isArray(value) && value.length <= max && value.every(item);

function isCategories(value: unknown): boolean {
  return isIdList(
    value,
    MAX_DRAFT_CATEGORIES,
    (path) =>
      Array.isArray(path) &&
      path.length > 0 &&
      path.length <= MAX_CATEGORY_DEPTH &&
      path.every(isCategoryName),
  );
}

/**
 * Whether a device sent a draft of the right shape: known fields of the right kinds (what's typed
 * is kept even with a problem: Done holds the editor's checks), within the caps above. Its size
 * in bytes is checked separately (MAX_DRAFT_BYTES).
 */
export function isDraftData(value: unknown): value is DraftData {
  if (!isObject(value)) return false;
  const known = [
    "fields",
    "base",
    "photos",
    "basePhotos",
    "photosArranged",
    "categories",
    "baseCategories",
  ];
  if (!Object.keys(value).every((key) => known.includes(key))) return false;
  return (
    isContent(value.fields) &&
    isContent(value.base) &&
    (value.photos === null || isPhotos(value.photos)) &&
    (value.basePhotos === null || isIdList(value.basePhotos, MAX_DRAFT_PHOTOS, (id) => isId(id))) &&
    typeof value.photosArranged === "boolean" &&
    (value.categories === null || isCategories(value.categories)) &&
    (value.baseCategories === null ||
      isIdList(
        value.baseCategories,
        MAX_DRAFT_CATEGORIES,
        (key) => typeof key === "string" && key.length <= 1200,
      ))
  );
}

/** A draft with nothing in it, to start from. */
export function emptyDraftData(): DraftData {
  return {
    fields: {},
    base: {},
    photos: null,
    basePhotos: null,
    photosArranged: false,
    categories: null,
    baseCategories: null,
  };
}

/** The image hashes a draft's gallery shows (for photo housekeeping and export). */
export function draftImageHashes(data: DraftData): string[] {
  return [...new Set((data.photos ?? []).map((photo) => photo.imageHash))];
}
