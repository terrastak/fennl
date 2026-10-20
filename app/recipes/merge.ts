import {
  CATEGORY_SEPARATOR,
  recipeBytes,
  type Recipe,
  type RecipeContent,
  type RecipeField,
  type RecipeMade,
  type RecipeOpinion,
  type RecipePhoto,
} from "../../shared/recipe";
import { servingsText, sourceLine, timeText } from "../../shared/recipeText";
import type {
  MadeChange,
  OpinionChange,
  PhotoChange,
  RecipeChange,
  SyncChange,
} from "../../shared/sync";
import { fileRecipes, pathKey, type CategoryTree, type Plan } from "../categories/tree";
import type { RecipeDetail } from "../sync/dbProtocol";
import type { PhotoPlan } from "../sync/status";

// Merging two copies of a recipe (phase C14): one is kept, with whatever the person picks from
// the other, and the other goes to Trash (where it stays for 30 days). Nothing is deleted: the
// plan is a list of changes and the list that takes them all back, shown to the person first.
// Only a person's own recipes are merged (both have the same owner), so photos can move across
// (they are the owner's) and so can their "made it" days and their own rating and notes.

/** The rows of the comparison: each is one thing to choose between, possibly several fields. */
export type MergeRow =
  | "title"
  | "description"
  | "ingredients"
  | "directions"
  | "times"
  | "servings"
  | "source"
  | "notes"
  | "difficulty"
  | "nutrition";

export const MERGE_ROWS: { id: MergeRow; label: string; fields: RecipeField[] }[] = [
  { id: "title", label: "Title", fields: ["title"] },
  { id: "description", label: "About", fields: ["description"] },
  { id: "ingredients", label: "Ingredients", fields: ["ingredients"] },
  { id: "directions", label: "Method", fields: ["directions"] },
  { id: "times", label: "Times", fields: ["times"] },
  { id: "servings", label: "Servings", fields: ["servings"] },
  { id: "source", label: "Source", fields: ["source"] },
  { id: "notes", label: "Notes", fields: ["notes"] },
  { id: "difficulty", label: "Difficulty", fields: ["difficulty", "difficultyText"] },
  { id: "nutrition", label: "Nutrition", fields: ["nutrition"] },
];

export type Side = "keeper" | "other";

const rowFields = (row: MergeRow): RecipeField[] =>
  MERGE_ROWS.find((r) => r.id === row)?.fields ?? [];

/** A row's value in a form that is the same when the recipes say the same thing. */
function normalized(content: RecipeContent, row: MergeRow): string {
  const value = (field: RecipeField): unknown => {
    switch (field) {
      case "title":
      case "description":
      case "notes":
        return (content[field] as string).replace(/\s+/g, " ").trim();
      case "ingredients":
      case "directions":
        return content[field]
          .map((line) => [line.text.replace(/\s+/g, " ").trim(), line.heading])
          .filter(([text]) => text !== "");
      default:
        return content[field];
    }
  };
  return JSON.stringify(rowFields(row).map(value));
}

/** Whether the two recipes say the same thing in this row. */
export function sameRow(a: RecipeContent, b: RecipeContent, row: MergeRow): boolean {
  return normalized(a, row) === normalized(b, row);
}

/** Whether a recipe says nothing in this row. */
export function emptyRow(content: RecipeContent, row: MergeRow): boolean {
  switch (row) {
    case "title":
    case "description":
    case "notes":
      return content[row].trim() === "";
    case "ingredients":
    case "directions":
      return content[row].every((line) => line.text.trim() === "");
    case "times":
      return (["prep", "cook", "total"] as const).every(
        (k) => content.times[k].minutes === null && !content.times[k].text?.trim(),
      );
    case "servings":
      return content.servings.count === null && !content.servings.yield?.trim();
    case "source":
      return Object.values(content.source).every((v) => v === null || v === "");
    case "difficulty":
      return content.difficulty === null && !content.difficultyText?.trim();
    case "nutrition":
      return content.nutrition === null;
  }
}

/** A row's value as lines of words, for showing side by side. */
export function rowLines(content: RecipeContent, row: MergeRow): string[] {
  if (emptyRow(content, row)) return [];
  switch (row) {
    case "title":
    case "description":
    case "notes":
      return content[row].split("\n").filter((line) => line.trim() !== "");
    case "ingredients":
    case "directions":
      return content[row].map((line) => line.text).filter((text) => text.trim() !== "");
    case "times": {
      const parts = (["prep", "cook", "total"] as const).map((k) => {
        const text = timeText(content.times[k]);
        return text ? `${k[0]?.toUpperCase()}${k.slice(1)} ${text}` : null;
      });
      return parts.filter((p): p is string => p !== null);
    }
    case "servings":
      return [servingsText(content.servings) ?? ""].filter(Boolean);
    case "source": {
      const line = sourceLine(content.source);
      return [line ?? content.source.name ?? "", content.source.url ?? ""].filter(Boolean);
    }
    case "difficulty":
      return [content.difficulty ?? content.difficultyText ?? ""].filter(Boolean);
    case "nutrition": {
      const n = content.nutrition;
      if (!n) return [];
      const values = Object.entries(n.perServing).map(([k, v]) => `${k} ${v}`);
      return [n.text?.trim() || values.join(" · ")].filter(Boolean);
    }
  }
}

/** The rows where the two recipes say different things. */
export function differingRows(keeper: RecipeContent, other: RecipeContent): MergeRow[] {
  return MERGE_ROWS.map((r) => r.id).filter((row) => !sameRow(keeper, other, row));
}

/**
 * What to take in each row to begin with, so a merge needs no choosing unless the person wants
 * to: keep the kept recipe's, except where it says nothing and the other does.
 */
export function defaultChoices(
  keeper: RecipeContent,
  other: RecipeContent,
): Record<MergeRow, Side> {
  const choices = {} as Record<MergeRow, Side>;
  for (const { id } of MERGE_ROWS) {
    choices[id] = emptyRow(keeper, id) && !emptyRow(other, id) ? "other" : "keeper";
  }
  return choices;
}

/** Which of two recipes to keep to begin with: the fuller one, then the older, then by id. */
export function suggestKeeper(a: Recipe, b: Recipe): [keeper: Recipe, other: Recipe] {
  const [sa, sb] = [recipeBytes(a), recipeBytes(b)];
  if (sa !== sb) return sa > sb ? [a, b] : [b, a];
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}

/** What the kept recipe's content would be after taking the chosen rows from the other. */
export function mergedContent(
  keeper: RecipeContent,
  other: RecipeContent,
  choices: Record<MergeRow, Side>,
): RecipeContent {
  const merged: RecipeContent = { ...keeper };
  for (const row of MERGE_ROWS) {
    if (choices[row.id] !== "other") continue;
    for (const field of row.fields)
      (merged as unknown as Record<string, unknown>)[field] = other[field];
  }
  return merged;
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

export interface MergeInput {
  keeper: RecipeDetail;
  other: RecipeDetail;
  /** For each differing row, which recipe's to use. */
  choices: Record<MergeRow, Side>;
  /** The signed-in person: only their own "made it" days, rating and notes are carried. */
  me: string;
  now: number;
  tree: CategoryTree;
  /** Whether photos can be added and how many fit, or null when not known. */
  photos: PhotoPlan | null;
  newId?: () => string;
}

export interface MergePlan extends Plan {
  /** What it will do, in words, for the person to read before agreeing. */
  willDo: string[];
  /** What it can't carry across, and why, so nothing goes unsaid. */
  cannot: string[];
}

const GALLERY = "photo";

/**
 * The changes that merge `other` into `keeper`, and the changes that undo them. The last change
 * moves `other` to Trash, so if something fails along the way both recipes are still there.
 */
export function planMerge(input: MergeInput): MergePlan {
  const { keeper, other, choices, me, now, tree, photos } = input;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const changes: SyncChange[] = [];
  const undo: SyncChange[] = [];
  const willDo: string[] = [];
  const cannot: string[] = [];

  // 1. The rows taken from the other recipe.
  const fields: Partial<RecipeContent> = {};
  const before: Partial<RecipeContent> = {};
  const taken: string[] = [];
  for (const row of MERGE_ROWS) {
    if (choices[row.id] !== "other" || sameRow(keeper.recipe, other.recipe, row.id)) continue;
    for (const field of row.fields) {
      (fields as Record<string, unknown>)[field] = other.recipe[field];
      (before as Record<string, unknown>)[field] = keeper.recipe[field];
    }
    taken.push(row.label.toLowerCase());
  }
  if (taken.length > 0) {
    const edit = (content: Partial<RecipeContent>): RecipeChange => ({
      kind: "recipe",
      id: keeper.recipe.id,
      fields: content,
      changedAt: now,
    });
    changes.push(edit(fields));
    undo.push(edit(before));
    willDo.push(`Use the other recipe's ${taken.join(", ")}.`);
  }

  // 2. Categories: the kept recipe joins the other's.
  const have = new Set(keeper.categories.map((path) => path.toLocaleLowerCase()));
  const joined: string[] = [];
  for (const path of other.categories) {
    if (have.has(path.toLocaleLowerCase())) continue;
    const names = path.split(CATEGORY_SEPARATOR);
    if (!tree.byKey.has(pathKey(names))) continue;
    const plan = fileRecipes(tree, [keeper.recipe.id], names, { me, now, newId });
    changes.push(...plan.changes);
    undo.push(...plan.undo);
    joined.push(path);
    have.add(path.toLocaleLowerCase());
  }
  if (joined.length > 0) willDo.push(`File it under ${joined.join(", ")} too.`);

  // 3. Photos: the other's, except any the kept recipe already shows. They are the owner's, so
  // they can be shown on the kept recipe as they are.
  const shown = new Set(keeper.photos.map((photo) => photo.imageHash));
  const wanted = other.photos.filter((photo) => !shown.has(photo.imageHash));
  if (wanted.length > 0) {
    if (!photos?.enabled) {
      cannot.push(
        `${count(wanted.length, "photo")} can't be added to the kept recipe on this plan; they stay with the other recipe in Trash.`,
      );
    } else {
      let room = Infinity;
      if (photos.maxPerRecipe !== null) {
        const gallery = keeper.photos.filter((p) => p.role === GALLERY).length;
        room = Math.max(0, photos.maxPerRecipe - gallery);
      }
      let order = Math.max(-1, ...keeper.photos.map((p) => p.sortOrder)) + 1;
      let added = 0;
      let left = 0;
      for (const photo of [...wanted].sort(bySortOrder)) {
        const countsToward = photo.role === GALLERY;
        if (countsToward && room <= 0) {
          left++;
          continue;
        }
        if (countsToward) room--;
        const id = newId();
        const add: PhotoChange = {
          kind: "photo",
          id,
          recipeId: keeper.recipe.id,
          create: {
            imageHash: photo.imageHash,
            role: photo.role,
            width: photo.width,
            height: photo.height,
          },
          fields: { sortOrder: order++ },
          changedAt: now,
        };
        changes.push(add);
        undo.push({
          kind: "photo",
          id,
          recipeId: keeper.recipe.id,
          fields: {},
          deleted: true,
          changedAt: now,
        });
        added++;
      }
      if (added > 0) willDo.push(`Add ${count(added, "photo")}.`);
      if (left > 0) {
        cannot.push(
          `${count(left, "photo")} won't fit under the limit of ${photos.maxPerRecipe} on one recipe; they stay with the other recipe in Trash.`,
        );
      }
    }
  }

  // 3b. "Made it" days: the person's own, on days the kept recipe doesn't already have.
  const days = new Set(keeper.made.map((made) => made.madeOn));
  const mine = other.made.filter((made) => made.userId === me);
  const newDays: RecipeMade[] = [];
  for (const made of mine) {
    if (days.has(made.madeOn)) continue;
    days.add(made.madeOn);
    newDays.push(made);
  }
  for (const made of newDays) {
    const id = newId();
    const add: MadeChange = {
      kind: "made",
      id,
      recipeId: keeper.recipe.id,
      madeOn: made.madeOn,
      changedAt: now,
    };
    changes.push(add);
    undo.push({
      kind: "made",
      id,
      recipeId: keeper.recipe.id,
      madeOn: made.madeOn,
      deleted: true,
      changedAt: now,
    });
  }
  if (newDays.length > 0) willDo.push(`Add ${count(newDays.length, "“made it” day")}.`);
  const others = other.made.filter((made) => made.userId !== me).length;
  if (others > 0) {
    cannot.push(
      `${count(others, "“made it” day")} by other people can't move; they stay with the other recipe in Trash.`,
    );
  }

  // 3c. The person's own rating, favorite and note, where the kept recipe has none.
  const opinionOf = (detail: RecipeDetail): RecipeOpinion | undefined =>
    detail.opinions.find((o) => o.userId === me);
  const theirs = opinionOf(other);
  const mineHere = opinionOf(keeper);
  if (theirs) {
    const carry: OpinionChange["fields"] = {};
    const back: OpinionChange["fields"] = {};
    const said: string[] = [];
    if (theirs.rating !== null && (mineHere?.rating ?? null) === null) {
      carry.rating = theirs.rating;
      back.rating = null;
      said.push("rating");
    }
    if (theirs.favorite && !mineHere?.favorite) {
      carry.favorite = true;
      back.favorite = false;
      said.push("favorite");
    }
    if (theirs.note.trim() !== "" && (mineHere?.note ?? "").trim() === "") {
      carry.note = theirs.note;
      back.note = mineHere?.note ?? "";
      said.push("note");
    }
    if (said.length > 0) {
      changes.push({ kind: "opinion", recipeId: keeper.recipe.id, fields: carry, changedAt: now });
      undo.push({ kind: "opinion", recipeId: keeper.recipe.id, fields: back, changedAt: now });
      willDo.push(`Keep your ${said.join(", ")} from the other recipe.`);
    }
  }
  const theirsOnly = other.opinions.filter((o) => o.userId !== me).length;
  if (theirsOnly > 0) {
    cannot.push(
      `${count(theirsOnly, "other person's rating or note", "other people's ratings or notes")} can't move; they stay with the other recipe in Trash.`,
    );
  }

  // 4. Last: the other recipe goes to Trash, where it can be put back for 30 days.
  changes.push({
    kind: "recipe",
    id: other.recipe.id,
    fields: {},
    deleted: true,
    changedAt: now,
  });
  undo.push({ kind: "recipe", id: other.recipe.id, fields: {}, deleted: false, changedAt: now });
  willDo.push(`Move “${other.recipe.title}” to Trash, where you can put it back for 30 days.`);

  // Undo in the opposite order: put the other recipe back first.
  return { changes, undo: undo.reverse(), willDo, cannot };
}

function bySortOrder(a: RecipePhoto, b: RecipePhoto): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
