import { tooLarge } from "../../shared/limits";
import {
  RECIPE_FIELDS,
  emptyRecipeContent,
  recipeBytes,
  recipeIssues,
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
import type { RecipeChange } from "../../shared/sync";
import { changedFields, pick, timeFromText, wholeNumber } from "./editing";
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
    servings: content.servings.count === null ? "" : String(content.servings.count),
  };
}

function fromBox(draft: RecipeContent, box: BoxName, text: string): RecipeContent {
  switch (box) {
    case "ingredients":
      return { ...draft, ingredients: ingredientsFromText(text, draft.ingredients) };
    case "directions":
      return { ...draft, directions: directionsFromText(text, draft.directions) };
    case "servings":
      return { ...draft, servings: { ...draft.servings, count: wholeNumber(text) } };
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
}

export interface EditorOptions {
  id: string;
  /** The recipe as it is, or null for a new one. */
  initial: RecipeContent | null;
  /** Hands a change to the sync engine (it throws when the change can't be kept). */
  save: (change: RecipeChange) => Promise<void>;
  /** How long after typing stops a save happens. */
  delayMs?: number;
  /** The device's clock (tests set it). */
  now?: () => number;
}

/** Undo steps kept per session. */
const UNDO_LIMIT = 200;

export class EditorSession {
  private readonly id: string;
  private readonly saveChange: (change: RecipeChange) => Promise<void>;
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

  private snapshot: EditorState;
  private readonly listeners = new Set<() => void>();

  constructor(options: EditorOptions) {
    this.id = options.id;
    this.saveChange = options.save;
    this.delayMs = options.delayMs ?? 800;
    this.now = options.now ?? Date.now;
    const content = options.initial ? pick(options.initial, [...RECIPE_FIELDS]) : null;
    this.draft = (content as RecipeContent | null) ?? emptyRecipeContent();
    this.saved = this.draft;
    this.created = options.initial !== null;
    this.boxes = boxesFrom(this.draft);
    this.snapshot = this.makeSnapshot();
  }

  // --- For the screen ------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorState => this.snapshot;

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

  /** Whether changes may be handed to the sync engine (CLAUDE.md, "Write paths"). */
  setEditable(editable: boolean): void {
    if (editable === this.editable) return;
    this.editable = editable;
    if (editable) this.schedule(0);
    this.publish();
  }

  /** A newer copy of the recipe from the local store (see the top of this file). */
  receive(recipe: RecipeContent): void {
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
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(pick(this.saved, Object.keys(entry) as RecipeField[]));
    this.restore(entry);
    await this.commit("history");
  }

  async redo(): Promise<void> {
    await this.flush();
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(pick(this.saved, Object.keys(entry) as RecipeField[]));
    this.restore(entry);
    await this.commit("history");
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

  /** One save at a time, in order. */
  private commit(mode: "edit" | "history"): Promise<void> {
    this.chain = this.chain.then(() => this.commitNow(mode));
    return this.chain;
  }

  private async commitNow(mode: "edit" | "history"): Promise<void> {
    if (!this.editable || this.tooLarge()) return;
    const draft = this.draft;
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
      const fields = changedFields(base, draft).filter((field) => !blocked.has(field));
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
      this.saved = sent;
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
    };
  }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
}
