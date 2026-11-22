import {
  categoryPathKey,
  draftParts,
  isEmptyDraft,
  sameValue,
  type DraftData,
  type DraftPart,
  type DraftPhoto,
  type SavedForDraft,
} from "../../shared/drafts";
import { tooLarge } from "../../shared/limits";
import {
  RECIPE_FIELDS,
  emptyRecipeContent,
  recipeBytes,
  recipeIssues,
  type DirectionStep,
  type IngredientLine,
  type RecipeContent,
  type RecipeField,
  type RecipeIssue,
} from "../../shared/recipe";
import {
  directionsFromText,
  ingredientsFromText,
  setHeading,
  textFromLines,
} from "../../shared/recipeLines";
import { formatServesOrMakes, parseServesOrMakes } from "../../shared/servings";
import type { RecipeChange } from "../../shared/sync";
import { changedFields, pick, timeFromText } from "./editing";
import { timeText } from "./format";

/**
 * One open recipe editor (phase C6): what's being typed, what's been saved, and undo. Kept apart
 * from the screen so it can be tested on its own; the screen (RecipeEditor.tsx) shows its state
 * and calls its methods.
 *
 * Saving: a moment after typing stops, the fields that changed since the last save go to the
 * sync engine as one change (CLAUDE.md, "Write paths"). A field with a problem (a web address
 * that isn't one) waits until it's fixed; the others still save. A new recipe is created by its
 * first save, once it has a title.
 *
 * Undo goes back one save at a time, for this session only (saved history across sessions is
 * Premium's version history, later).
 *
 * Changes from elsewhere (another device, a partner) arrive through receive(): a field this
 * editor hasn't touched since its last save takes the new value; one being edited here keeps
 * what's typed, which then saves over it (last change wins).
 *
 * Draft mode (U27 part 3, owner's choices 2026-11-21 and 22; the recipe editor): nothing goes to
 * the recipe box while editing. A moment after typing stops, everything that differs from the
 * saved recipe (words, photos, categories) is kept as the person's draft (shared/drafts.ts),
 * each changed part with the saved value it started from; Done (drafts/finish.ts) applies it.
 * Fields with a problem are kept too (nothing typed is lost); Done holds the checks. A new
 * recipe with nothing typed or added is never kept, and a draft that's back to the saved recipe
 * goes. Undo steps back through what was kept, photos and categories included, this session
 * only. The import review screen uses the first mode.
 */

/** Text boxes whose words become structured fields: the lists, the times, servings. */
export type BoxName = "ingredients" | "directions" | "prep" | "cook" | "total" | "servings";
export type Boxes = Record<BoxName, string>;

const BOX_FIELD: Record<BoxName, RecipeField> = {
  ingredients: "ingredients",
  directions: "directions",
  prep: "times",
  cook: "times",
  total: "times",
  servings: "servings",
};

/** The text boxes, as a recipe reads. */
export function boxesFrom(content: RecipeContent): Boxes {
  return {
    ingredients: textFromLines(content.ingredients),
    directions: textFromLines(content.directions),
    prep: timeText(content.times.prep) ?? "",
    cook: timeText(content.times.cook) ?? "",
    total: timeText(content.times.total) ?? "",
    // One "Serves or makes" box for the count and the words (U27, shared/servings.ts).
    servings: formatServesOrMakes(content.servings),
  };
}

function fromBox(draft: RecipeContent, box: BoxName, text: string): RecipeContent {
  switch (box) {
    case "ingredients":
      return { ...draft, ingredients: ingredientsFromText(text, draft.ingredients) };
    case "directions":
      return { ...draft, directions: directionsFromText(text, draft.directions) };
    case "servings":
      return { ...draft, servings: parseServesOrMakes(text) };
    default:
      return { ...draft, times: { ...draft.times, [box]: timeFromText(text) } };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How saving stands, for the words at the top of the editor. */
export type SaveState =
  /** Everything typed is saved. */
  | "saved"
  /** Changes are about to save, or saving. */
  | "saving"
  /** A new recipe saves once it has a title. */
  | "needs_title"
  /** Some changes can't save until a problem is fixed. */
  | "problems"
  /** Editing is paused (no connection, without offline editing); changes save when it's back. */
  | "paused"
  /** Saving failed; it will be tried again. */
  | "failed"
  /** The recipe is over the plan's per-recipe size (phase C11): nothing saves until it shrinks. */
  | "too_large";

/** The recipe box's version, as the draft editor compares against it (U27 part 3). */
export interface SavedState {
  content: RecipeContent;
  /** The gallery in order (the cover first). */
  photos: DraftPhoto[];
  /** Category paths, as names. */
  categories: string[][];
}

/** What the draft editor keeps: the draft, and when it began and was last edited. */
export interface DraftWrite {
  data: DraftData;
  startedAt: number;
  editedAt: number;
}

/** How keeping the draft stands, for the words at the top of the editor. */
export type DraftSaveState =
  /** Nothing differs from the saved recipe (or, new, nothing is typed). */
  | "unchanged"
  /** Changes are about to be kept, or being kept. */
  | "saving"
  /** What's shown is kept. */
  | "kept"
  /** Keeping is paused (no connection, without offline editing). */
  | "paused"
  /** Keeping failed; it will be tried again. */
  | "failed";

export interface DraftEditorState {
  /** No recipe exists yet: Done creates it. */
  isNew: boolean;
  /** The parts that differ from the saved recipe now ("Draft saved · 3 changes"). */
  parts: DraftPart[];
  photos: DraftPhoto[];
  /** The person moved a photo or chose the cover in this draft. */
  arranged: boolean;
  categories: string[][];
  save: DraftSaveState;
}

export interface EditorState {
  draft: RecipeContent;
  boxes: Boxes;
  /** The recipe exists (it's been saved at least once, or was opened for editing). */
  created: boolean;
  /** Every problem with what's typed, for showing beside the fields. */
  issues: RecipeIssue[];
  /** Bigger than the plan's per-recipe size, and bigger than what's saved (phase C11). */
  tooLarge: boolean;
  save: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  /** Draft mode only. */
  drafting: DraftEditorState | null;
}

export interface DraftOptions {
  /** The recipe box's version, or null for a new recipe. */
  saved: SavedState | null;
  /** The person's draft of it, kept earlier. */
  existing: { data: DraftData; startedAt: number } | null;
  /** Keeps the draft, or (null) removes it. Throws when it can't be kept. */
  keep: (write: DraftWrite | null) => Promise<void>;
}

export interface EditorOptions {
  id: string;
  /** The recipe as it is, or null for a new one (ignored in draft mode: see `draft`). */
  initial: RecipeContent | null;
  /** Hands a change to the sync engine (it throws when the change can't be kept). */
  save?: (change: RecipeChange) => Promise<void>;
  /** Draft mode (U27 part 3): what's typed is kept as a draft, not saved. */
  draft?: DraftOptions;
  /** How long after typing stops a save happens. */
  delayMs?: number;
  /** The device's clock (tests set it). */
  now?: () => number;
}

/** Undo steps kept per session. */
const UNDO_LIMIT = 200;

/** What the draft editor shows: the words, the gallery and the categories. */
interface Shown {
  content: RecipeContent;
  photos: DraftPhoto[];
  categories: string[][];
  arranged: boolean;
}

/** One undo step in draft mode: the parts as they were. */
interface DraftStep {
  fields: Partial<RecipeContent>;
  photos?: DraftPhoto[];
  categories?: string[][];
  arranged?: boolean;
}

const photoIds = (photos: DraftPhoto[]) => photos.map((photo) => photo.id);
const categoryKeys = (paths: string[][]) => paths.map(categoryPathKey);
const samePhotos = (a: DraftPhoto[], b: DraftPhoto[]) => sameValue(a, b);
const sameCategories = (a: string[][], b: string[][]) => {
  const x = [...new Set(categoryKeys(a))].sort();
  const y = [...new Set(categoryKeys(b))].sort();
  return sameValue(x, y);
};

/** The parts of `from` that differ from `to`, as an undo step back to `from`. */
function stepBetween(from: Shown, to: Shown): DraftStep | null {
  const fields = RECIPE_FIELDS.filter(
    (field) => !sameValue(from.content[field], to.content[field]),
  );
  const step: DraftStep = { fields: pick(from.content, fields) };
  if (!samePhotos(from.photos, to.photos) || from.arranged !== to.arranged) {
    step.photos = from.photos;
    step.arranged = from.arranged;
  }
  if (!sameCategories(from.categories, to.categories)) step.categories = from.categories;
  return fields.length > 0 || step.photos || step.categories ? step : null;
}

/** The same parts of `shown`, to go back to (redo). */
function stepOf(shown: Shown, like: DraftStep): DraftStep {
  const step: DraftStep = {
    fields: pick(shown.content, Object.keys(like.fields) as RecipeField[]),
  };
  if (like.photos) {
    step.photos = shown.photos;
    step.arranged = shown.arranged;
  }
  if (like.categories) step.categories = shown.categories;
  return step;
}

export class EditorSession {
  private readonly id: string;
  private readonly saveChange: (change: RecipeChange) => Promise<void>;
  /** Draft mode (U27 part 3): how drafts are kept, else null. */
  private readonly drafts: DraftOptions | null;
  private readonly delayMs: number;
  private readonly now: () => number;

  private draft: RecipeContent;
  private boxes: Boxes;
  /** What the sync engine has, as far as this editor knows. */
  private saved: RecipeContent;
  private created: boolean;
  private undoStack: Partial<RecipeContent>[] = [];
  /** The plan's per-recipe size (max_recipe_bytes); null: no limit, or not known yet. */
  private maxBytes: number | null = null;
  private redoStack: Partial<RecipeContent>[] = [];
  private editable = true;
  private failed = false;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  // Draft mode.
  private savedState: SavedState = { content: emptyRecipeContent(), photos: [], categories: [] };
  private isNew = false;
  private photos: DraftPhoto[] = [];
  private categories: string[][] = [];
  private arranged = false;
  /** Each changed field's saved value when the draft first changed it. */
  private base: Partial<RecipeContent> = {};
  private basePhotos: string[] | null = null;
  private baseCategories: string[] | null = null;
  /** What's kept now (null: no draft), and what was shown when it was kept. */
  private keptData: DraftData | null = null;
  private keptShown!: Shown;
  private startedAt: number | null = null;
  private draftUndo: DraftStep[] = [];
  private draftRedo: DraftStep[] = [];
  private closed = false;

  private snapshot: EditorState;
  private readonly listeners = new Set<() => void>();

  constructor(options: EditorOptions) {
    this.id = options.id;
    this.saveChange =
      options.save ??
      (() => Promise.reject(new Error("This editor keeps drafts; it doesn't save changes.")));
    this.drafts = options.draft ?? null;
    this.delayMs = options.delayMs ?? 800;
    this.now = options.now ?? Date.now;
    if (options.draft) {
      const { saved, existing } = options.draft;
      this.isNew = saved === null;
      this.savedState = saved ?? this.savedState;
      const data = existing?.data;
      this.draft = { ...this.savedState.content, ...data?.fields };
      this.photos = data?.photos ?? this.savedState.photos;
      this.categories = data?.categories ?? this.savedState.categories;
      this.arranged = data?.photosArranged ?? false;
      this.base = { ...data?.base };
      this.basePhotos = data?.basePhotos ?? null;
      this.baseCategories = data?.baseCategories ?? null;
      this.keptData = data ?? null;
      this.startedAt = existing?.startedAt ?? null;
      this.saved = this.savedState.content;
      this.created = !this.isNew;
      this.keptShown = this.shown();
    } else {
      const content = options.initial ? pick(options.initial, [...RECIPE_FIELDS]) : null;
      this.draft = (content as RecipeContent | null) ?? emptyRecipeContent();
      this.saved = this.draft;
      this.created = options.initial !== null;
    }
    this.boxes = boxesFrom(this.draft);
    this.snapshot = this.makeSnapshot();
  }

  // --- For the screen ------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorState => this.snapshot;

  /** The title as last saved (what the recipe is called elsewhere, Trash included). */
  savedTitle(): string {
    return this.saved.title.trim();
  }

  /** Fields typed directly (title, notes, source…). */
  set(patch: Partial<RecipeContent>): void {
    this.draft = { ...this.draft, ...patch };
    this.changed();
  }

  /** A text box that becomes structured fields (the lists, a time, servings). */
  setBox(box: BoxName, text: string): void {
    this.boxes = { ...this.boxes, [box]: text };
    this.draft = fromBox(this.draft, box, text);
    this.changed();
  }

  /**
   * A change to a text box that's an undo step of its own (U27: a step split, joined, pasted or
   * moved in Directions): what was typed before it saves first, then the change saves at once.
   * `alone` false: the change saves with what's typed after it (a letter typed over words
   * selected across steps, and the letters that follow).
   */
  setBoxApart(box: BoxName, text: string, alone = true): void {
    void this.flush();
    this.setBox(box, text);
    if (alone) void this.flush();
  }

  /** Leaving a text box: it shows what was understood ("90" → "1 hr 30 min"; bullets gone). */
  tidyBox(box: BoxName): void {
    const tidy = boxesFrom(this.draft)[box];
    if (tidy === this.boxes[box]) return;
    this.boxes = { ...this.boxes, [box]: tidy };
    this.publish();
  }

  /** The heading button: a list's line becomes a heading, or stops being one. */
  toggleHeading(list: "ingredients" | "directions", index: number): void {
    const line = this.draft[list][index];
    if (!line) return;
    this.draft = { ...this.draft, [list]: setHeading(this.draft[list], line.id, !line.heading) };
    this.changed();
  }

  /**
   * Links an ingredient line (phase F3) or a step (U27) to a recipe in the household, or unlinks
   * it.
   */
  setLink(list: "ingredients" | "directions", lineId: string, recipeId: string | null): void {
    const lines: readonly (IngredientLine | DirectionStep)[] = this.draft[list];
    if (!lines.some((line) => line.id === lineId && !line.heading)) return;
    this.draft = {
      ...this.draft,
      [list]: lines.map((line) =>
        line.id === lineId ? { ...line, linkedRecipeId: recipeId } : line,
      ),
    };
    this.changed();
  }

  /** Whether changes may be handed to the sync engine (CLAUDE.md, "Write paths"). */
  setEditable(editable: boolean): void {
    if (editable === this.editable) return;
    this.editable = editable;
    if (editable) this.schedule(0);
    this.publish();
  }

  /** A newer copy of the recipe from the local store (see the top of this file). */
  receive(recipe: RecipeContent): void {
    if (this.drafts) {
      this.receiveSaved({
        ...this.savedState,
        content: pick(recipe, [...RECIPE_FIELDS]) as RecipeContent,
      });
      return;
    }
    if (!this.created) return;
    const fields = RECIPE_FIELDS.filter(
      (field) =>
        same(this.draft[field], this.saved[field]) && !same(recipe[field], this.saved[field]),
    );
    if (fields.length === 0) return;
    const values = pick(recipe, fields);
    this.saved = { ...this.saved, ...values };
    this.draft = { ...this.draft, ...values };
    this.refreshBoxes(fields);
    this.publish();
  }

  /** Saves what's waiting now (leaving the editor, "Done", the page closing). */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.commit("edit");
  }

  async undo(): Promise<void> {
    await this.flush();
    if (this.drafts) {
      const step = this.draftUndo.pop();
      if (!step) return;
      this.draftRedo.push(stepOf(this.keptShown, step));
      this.restoreStep(step);
      await this.commit("history");
      return;
    }
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(pick(this.saved, Object.keys(entry) as RecipeField[]));
    this.restore(entry);
    await this.commit("history");
  }

  async redo(): Promise<void> {
    await this.flush();
    if (this.drafts) {
      const step = this.draftRedo.pop();
      if (!step) return;
      this.draftUndo.push(stepOf(this.keptShown, step));
      this.restoreStep(step);
      await this.commit("history");
      return;
    }
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(pick(this.saved, Object.keys(entry) as RecipeField[]));
    this.restore(entry);
    await this.commit("history");
  }

  // --- Draft mode (U27 part 3) ---------------------------------------------------------------

  /**
   * The gallery as the person arranged it: a photo removed, moved, made the cover (`arranged`:
   * the order is theirs from now on, phase D4), or put back. An undo step of its own.
   */
  setPhotos(photos: DraftPhoto[], arranged = false): void {
    void this.flush();
    this.photos = photos;
    if (arranged) this.arranged = true;
    this.publish();
    void this.flush();
  }

  /** A photo just uploaded, added at the end (several can arrive one after another). */
  addPhoto(photo: DraftPhoto): void {
    if (this.photos.some((p) => p.id === photo.id)) return;
    this.setPhotos([...this.photos, photo]);
  }

  /** The recipe's categories as paths of names (a new category is made at Done). */
  setCategories(paths: string[][]): void {
    void this.flush();
    this.categories = paths;
    this.publish();
    void this.flush();
  }

  /** The recipe box's version changed (another device, a partner): see receive(). */
  receiveSaved(saved: SavedState): void {
    if (!this.drafts || this.isNew) return;
    const old = this.savedState;
    const fields = RECIPE_FIELDS.filter(
      (field) =>
        sameValue(this.draft[field], old.content[field]) &&
        !sameValue(saved.content[field], old.content[field]),
    );
    const followPhotos =
      samePhotos(this.photos, old.photos) && !samePhotos(saved.photos, old.photos);
    const followCategories =
      sameCategories(this.categories, old.categories) &&
      !sameCategories(saved.categories, old.categories);
    // Categories the draft changed, changed in the recipe box too (renamed, deleted or added
    // elsewhere): the recipe box's, with what the draft added and took out (as Done applies it).
    const rebaseCategories =
      !followCategories &&
      !sameCategories(this.categories, old.categories) &&
      !sameCategories(saved.categories, old.categories);
    this.savedState = saved;
    this.saved = saved.content;
    if (fields.length > 0 || followPhotos || followCategories || rebaseCategories) {
      // Parts not in the draft follow the recipe box; what's typed stays.
      const values = pick(saved.content, fields);
      this.draft = { ...this.draft, ...values };
      const kept = { ...this.keptShown, content: { ...this.keptShown.content, ...values } };
      if (followPhotos) this.photos = kept.photos = saved.photos;
      if (followCategories) this.categories = kept.categories = saved.categories;
      if (rebaseCategories) {
        const startedWith = new Set(this.baseCategories ?? categoryKeys(old.categories));
        const mine = new Set(categoryKeys(this.categories));
        const savedKeys = new Set(categoryKeys(saved.categories));
        this.categories = kept.categories = [
          ...saved.categories.filter((path) => {
            const key = categoryKeys([path])[0] as string;
            return !startedWith.has(key) || mine.has(key);
          }),
          ...this.categories.filter((path) => {
            const key = categoryKeys([path])[0] as string;
            return !startedWith.has(key) && !savedKeys.has(key);
          }),
        ];
        this.baseCategories = categoryKeys(saved.categories);
      }
      this.keptShown = kept;
      this.refreshBoxes(fields);
    }
    this.publish();
    // What's kept no longer matches (the same change arrived from elsewhere, or a part now
    // follows the recipe box): keep it again now, which removes a draft left with nothing.
    if (this.editable && !this.closed && this.keptData !== null) {
      const data = this.draftData(this.shown());
      const empty = this.nothingIn(data);
      if (empty || !sameValue(data, this.keptData)) this.schedule(0);
    }
  }

  /**
   * Discard changes: back to the saved recipe (a new recipe: empty), the draft removed and this
   * session's undo forgotten.
   */
  async discard(): Promise<void> {
    if (!this.drafts) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.draft = this.savedState.content;
    this.photos = this.savedState.photos;
    this.categories = this.savedState.categories;
    this.arranged = false;
    this.base = {};
    this.basePhotos = null;
    this.baseCategories = null;
    this.draftUndo = [];
    this.draftRedo = [];
    this.keptShown = this.shown();
    this.boxes = boxesFrom(this.draft);
    const keep = this.drafts.keep;
    this.chain = this.chain.then(async () => {
      this.keptData = null;
      this.startedAt = null;
      await keep(null);
    });
    this.publish();
    await this.chain;
    this.publish();
  }

  /** The draft as it stands (after flush()), for Done. */
  draftNow(): { data: DraftData; startedAt: number; isNew: boolean } {
    return {
      data: this.draftData(this.shown()),
      startedAt: this.startedAt ?? this.now(),
      isNew: this.isNew,
    };
  }

  /** After Done, Discard of a new recipe, or Move to Trash: nothing more is kept. */
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private shown(): Shown {
    return {
      content: this.draft,
      photos: this.photos,
      categories: this.categories,
      arranged: this.arranged,
    };
  }

  private savedForDraft(): SavedForDraft | null {
    if (this.isNew) return null;
    return {
      content: this.savedState.content,
      galleryIds: photoIds(this.savedState.photos),
      categoryKeys: categoryKeys(this.savedState.categories),
    };
  }

  /** What differs from the saved recipe, as a draft (a new recipe: everything). */
  private draftData(shown: Shown): DraftData {
    const saved = this.savedState;
    const fields: Partial<RecipeContent> = {};
    const base: Partial<RecipeContent> = {};
    for (const field of RECIPE_FIELDS) {
      if (!this.isNew && sameValue(shown.content[field], saved.content[field])) continue;
      Object.assign(fields, pick(shown.content, [field]));
      if (!this.isNew) {
        Object.assign(
          base,
          field in this.base
            ? pick(this.base as RecipeContent, [field])
            : pick(saved.content, [field]),
        );
      }
    }
    const photosChanged = this.isNew
      ? shown.photos.length > 0
      : !samePhotos(shown.photos, saved.photos);
    const categoriesChanged = this.isNew
      ? shown.categories.length > 0
      : !sameCategories(shown.categories, saved.categories);
    return {
      fields,
      base,
      photos: photosChanged ? shown.photos : null,
      basePhotos: photosChanged && !this.isNew ? (this.basePhotos ?? photoIds(saved.photos)) : null,
      photosArranged: photosChanged && shown.arranged,
      categories: categoriesChanged ? shown.categories : null,
      baseCategories:
        categoriesChanged && !this.isNew
          ? (this.baseCategories ?? categoryKeys(saved.categories))
          : null,
    };
  }

  /** Nothing to keep: a new recipe with nothing in it, or a draft back to the saved recipe. */
  private nothingIn(data: DraftData): boolean {
    return this.isNew ? isEmptyDraft(data) : draftParts(this.savedForDraft(), data).length === 0;
  }

  private restoreStep(step: DraftStep): void {
    this.draft = { ...this.draft, ...step.fields };
    if (step.photos) this.photos = step.photos;
    if (step.arranged !== undefined) this.arranged = step.arranged;
    if (step.categories) this.categories = step.categories;
    this.refreshBoxes(Object.keys(step.fields) as RecipeField[]);
    this.publish();
  }

  private async keepNow(mode: "edit" | "history", shown: Shown): Promise<void> {
    const drafts = this.drafts;
    if (!drafts || this.closed || !this.editable) return;
    const data = this.draftData(shown);
    const empty = this.nothingIn(data);
    const unchanged = empty ? this.keptData === null : sameValue(data, this.keptData);
    if (!unchanged) {
      const startedAt = empty ? null : (this.startedAt ?? this.now());
      this.busy = true;
      this.publish();
      try {
        await drafts.keep(
          empty || startedAt === null ? null : { data, startedAt, editedAt: this.now() },
        );
        this.keptData = empty ? null : data;
        this.startedAt = startedAt;
        this.base = data.base;
        this.basePhotos = data.basePhotos;
        this.baseCategories = data.baseCategories;
        this.failed = false;
      } catch {
        // Paused or refused: try again shortly (the sync engine says when editing is back).
        this.failed = this.editable;
        if (this.editable) this.schedule(5000);
        this.busy = false;
        this.publish();
        return;
      }
      this.busy = false;
    }
    if (mode === "edit") {
      const step = stepBetween(this.keptShown, shown);
      if (step) {
        this.draftUndo.push(step);
        if (this.draftUndo.length > UNDO_LIMIT) this.draftUndo.shift();
        this.draftRedo = [];
      }
    }
    this.keptShown = shown;
    this.publish();
  }

  private draftSnapshot(): DraftEditorState {
    const shown = this.shown();
    const data = this.draftData(shown);
    const parts = this.nothingIn(data) ? [] : draftParts(this.savedForDraft(), data);
    const pending = parts.length === 0 ? this.keptData !== null : !sameValue(data, this.keptData);
    let save: DraftSaveState;
    if (!pending && !this.busy) save = parts.length === 0 ? "unchanged" : "kept";
    else if (!this.editable) save = "paused";
    else if (this.failed) save = "failed";
    else save = "saving";
    return {
      isNew: this.isNew,
      parts,
      photos: this.photos,
      arranged: this.arranged,
      categories: this.categories,
      save,
    };
  }

  // --- Inside --------------------------------------------------------------------------------

  private changed(): void {
    this.publish();
    this.schedule(this.delayMs);
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.commit("edit");
    }, delay);
  }

  private restore(entry: Partial<RecipeContent>): void {
    this.draft = { ...this.draft, ...entry };
    this.refreshBoxes(Object.keys(entry) as RecipeField[]);
    this.publish();
  }

  private refreshBoxes(fields: RecipeField[]): void {
    const fresh = boxesFrom(this.draft);
    const boxes = { ...this.boxes };
    for (const box of Object.keys(BOX_FIELD) as BoxName[]) {
      if (fields.includes(BOX_FIELD[box])) boxes[box] = fresh[box];
    }
    this.boxes = boxes;
  }

  /** The plan's per-recipe size, from the sync engine (phase C11). */
  setMaxBytes(maxBytes: number | null): void {
    if (maxBytes === this.maxBytes) return;
    this.maxBytes = maxBytes;
    this.publish();
    this.schedule(this.delayMs);
  }

  /**
   * Over the per-recipe size: nothing saves until it's back under (or no bigger than what's
   * saved, for a recipe that was already over it). Recipes this big are very rare.
   */
  private tooLarge(): boolean {
    return tooLarge(recipeBytes(this.draft), recipeBytes(this.saved), this.maxBytes);
  }

  /** Fields with a problem, which wait until it's fixed. */
  private blocked(issues: RecipeIssue[]): Set<string> {
    return new Set(issues.map((issue) => issue.path.split(".")[0] ?? ""));
  }

  /**
   * One save at a time, in order, each of what was typed when it was asked for (so a step split
   * in Directions is an undo step of its own). It keeps what was saved then too, so a field this
   * editor didn't change is never sent back from an older copy: a newer value from elsewhere
   * that arrived while an earlier save was going stays.
   */
  private commit(mode: "edit" | "history"): Promise<void> {
    if (this.drafts) {
      const shown = this.shown();
      this.chain = this.chain.then(() => this.keepNow(mode, shown));
      return this.chain;
    }
    const draft = this.draft;
    const from = this.saved;
    this.chain = this.chain.then(() => this.commitNow(mode, draft, from));
    return this.chain;
  }

  private async commitNow(
    mode: "edit" | "history",
    draft: RecipeContent,
    from: RecipeContent,
  ): Promise<void> {
    if (!this.editable || this.tooLarge()) return;
    const base = this.saved;
    const blocked = this.blocked(recipeIssues(draft, null));
    let change: RecipeChange;
    let sent: RecipeContent;
    if (!this.created) {
      if (blocked.has("title")) return;
      // Everything is sent with a new recipe; a field with a problem goes as it was (empty).
      sent = { ...draft };
      for (const field of RECIPE_FIELDS) {
        if (blocked.has(field)) Object.assign(sent, pick(base, [field]));
      }
      change = {
        kind: "recipe",
        id: this.id,
        create: { createdAt: new Date(this.now()).toISOString(), import: null },
        fields: sent,
        changedAt: this.now(),
      };
    } else {
      const edited = new Set(changedFields(from, draft));
      const fields = changedFields(base, draft).filter(
        (field) => edited.has(field) && !blocked.has(field),
      );
      if (fields.length === 0) return;
      const values = pick(draft, fields);
      sent = { ...base, ...values };
      change = { kind: "recipe", id: this.id, fields: values, changedAt: this.now() };
    }

    this.busy = true;
    this.publish();
    try {
      await this.saveChange(change);
      const fields = changedFields(base, sent);
      // Only what was sent: a value received while this save was going stays.
      this.saved = { ...this.saved, ...pick(sent, fields) };
      if (this.created && mode === "edit" && fields.length > 0) {
        this.undoStack.push(pick(base, fields));
        if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
        this.redoStack = [];
      }
      this.created = true;
      this.failed = false;
    } catch {
      // Paused or refused: try again shortly (the sync engine says when editing is back).
      this.failed = this.editable;
      if (this.editable) this.schedule(5000);
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  private makeSnapshot(): EditorState {
    if (this.drafts) {
      const drafting = this.draftSnapshot();
      return {
        draft: this.draft,
        boxes: this.boxes,
        created: this.created,
        issues: recipeIssues(this.draft, null),
        tooLarge: drafting.parts.length > 0 && this.tooLarge(),
        save: "saved",
        canUndo: this.draftUndo.length > 0 || stepBetween(this.keptShown, this.shown()) !== null,
        canRedo: this.draftRedo.length > 0,
        drafting,
      };
    }
    const issues = recipeIssues(this.draft, null);
    const blocked = this.blocked(issues);
    const unsaved = !this.created || changedFields(this.saved, this.draft).length > 0;
    const unsavedOk = this.created
      ? changedFields(this.saved, this.draft).some((field) => !blocked.has(field))
      : !blocked.has("title");
    const tooLarge = unsaved && this.tooLarge();
    let save: SaveState = "saved";
    if (tooLarge) save = "too_large";
    else if (!this.created && blocked.has("title")) save = "needs_title";
    else if (unsavedOk || this.busy) {
      save = !this.editable ? "paused" : this.failed ? "failed" : "saving";
    } else if (unsaved) save = "problems";
    return {
      draft: this.draft,
      boxes: this.boxes,
      created: this.created,
      issues,
      tooLarge,
      save,
      canUndo: this.undoStack.length > 0 || (this.created && unsavedOk),
      canRedo: this.redoStack.length > 0,
      drafting: null,
    };
  }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
}
