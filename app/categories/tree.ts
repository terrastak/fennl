import { CATEGORY_SEPARATOR, isCategoryName, type Category } from "../../shared/recipe";
import type { CategoryChange, RecipeCategoryChange, SyncChange } from "../../shared/sync";

/**
 * Categories as people see them (phase C7), and the changes that edit them.
 *
 * Every category belongs to one person, but a household sees one tree: categories with the same
 * full path ("Desserts › Cakes", ignoring case) show as one (CLAUDE.md, "Recipe ownership in
 * households"). So a node of the tree may stand for several categories, one per person who has
 * it. Editing a node edits all of them. A recipe is always filed under its owner's category of
 * that path, which is created if the owner doesn't have it yet.
 *
 * Nothing here talks to the sync engine: these functions work out the changes, and the screens
 * save them (and keep the changes that undo them).
 */

/** A recipe filed under a category (only those not removed, of recipes not in Trash). */
export interface CategoryLink {
  recipeId: string;
  categoryId: string;
}

/** What the tree is made from: categories not deleted, and their links. */
export interface CategoryData {
  categories: Category[];
  links: CategoryLink[];
  /** Who owns each recipe, for filing it under its owner's category. */
  recipeOwners: Record<string, string>;
}

export interface CategoryNode {
  /** The path in lower case: what makes categories one node. */
  key: string;
  /** "Desserts › Cakes". */
  path: string;
  names: string[];
  name: string;
  depth: number;
  /** The categories this node stands for (one per person who has it). */
  ids: string[];
  parent: CategoryNode | null;
  children: CategoryNode[];
  /** Recipes filed directly under it. */
  recipeIds: Set<string>;
  /** Recipes under it or anything inside it. */
  count: number;
  /**
   * Where the person put it among the categories beside it (U17): its stored sort order, mine
   * where people's differ. Below ORDER_BASE it was never placed, and goes by name.
   */
  order: number;
}

export interface CategoryTree {
  roots: CategoryNode[];
  /** Every node, in the order the tree reads (parents before their children). */
  nodes: CategoryNode[];
  byKey: Map<string, CategoryNode>;
  /** The node each category belongs to. */
  byId: Map<string, CategoryNode>;
  /** Who owns each category. */
  owners: Map<string, string>;
  /** Each category's stored sort order, for undoing a move. */
  orders: Map<string, number>;
  recipeOwners: Record<string, string>;
  links: CategoryLink[];
}

export const pathKey = (names: string[]) => names.join(CATEGORY_SEPARATOR).toLocaleLowerCase();

const byName = (a: CategoryNode, b: CategoryNode) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/**
 * Categories are in the person's own order (U17, owner's choice 2026-11-04), starting A to Z.
 * A category someone placed (by dragging, or Move up / Move down) has a sort order of at least
 * ORDER_BASE; anything below it (0 for a new category, the small numbers sample categories got)
 * was never placed. So a level nobody arranged reads A to Z, and a category added to an arranged
 * level comes after the placed ones, with any others not placed in A to Z order.
 */
export const ORDER_BASE = 1_000_000;
/** The gap between placed categories' sort orders. */
export const ORDER_STEP = 1_000;

export const isPlaced = (node: CategoryNode) => node.order >= ORDER_BASE;

/** How categories beside each other are shown: placed ones in their order, then the rest A to Z. */
export function byOrder(a: CategoryNode, b: CategoryNode): number {
  const placedA = isPlaced(a);
  const placedB = isPlaced(b);
  if (placedA && placedB) return a.order - b.order || byName(a, b);
  if (placedA !== placedB) return placedA ? -1 : 1;
  return byName(a, b);
}

/** The tree, with the signed-in person's own names preferred where people spell them differently. */
export function categoryTree(data: CategoryData, me: string): CategoryTree {
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const namesOf = (category: Category): string[] => {
    const names: string[] = [];
    let at: Category | undefined = category;
    // A parent that's missing (or a loop) ends the path there.
    for (let depth = 0; at && depth < 20; depth++) {
      names.unshift(at.name);
      at = at.parentId ? categories.get(at.parentId) : undefined;
    }
    return names;
  };

  const byKey = new Map<string, CategoryNode>();
  const byId = new Map<string, CategoryNode>();
  const owners = new Map<string, string>();
  const orders = new Map<string, number>();
  const node = (names: string[]): CategoryNode => {
    const key = pathKey(names);
    let found = byKey.get(key);
    if (!found) {
      const parent = names.length > 1 ? node(names.slice(0, -1)) : null;
      found = {
        key,
        path: names.join(CATEGORY_SEPARATOR),
        names,
        name: names[names.length - 1] ?? "",
        depth: names.length - 1,
        ids: [],
        parent,
        children: [],
        recipeIds: new Set(),
        count: 0,
        order: 0,
      };
      byKey.set(key, found);
      parent?.children.push(found);
    }
    return found;
  };

  // Mine first, so my spelling names the node.
  const ordered = [...categories.values()].sort(
    (a, b) => Number(b.ownerUserId === me) - Number(a.ownerUserId === me),
  );
  for (const category of ordered) {
    const found = node(namesOf(category));
    found.ids.push(category.id);
    byId.set(category.id, found);
    owners.set(category.id, category.ownerUserId);
    orders.set(category.id, category.sortOrder);
    // Mine come first, so where we differ the node goes where I put it.
    if (found.ids.length === 1) found.order = category.sortOrder;
  }
  const links = data.links.filter((link) => byId.has(link.categoryId));
  for (const link of links) byId.get(link.categoryId)?.recipeIds.add(link.recipeId);

  const roots = [...byKey.values()].filter((n) => !n.parent);
  const nodes: CategoryNode[] = [];
  const walk = (list: CategoryNode[]): Set<string> => {
    const all = new Set<string>();
    for (const n of list.sort(byOrder)) {
      nodes.push(n);
      const inside = new Set([...n.recipeIds, ...walk(n.children)]);
      n.count = inside.size;
      for (const id of inside) all.add(id);
    }
    return all;
  };
  walk(roots);
  return { roots, nodes, byKey, byId, owners, orders, recipeOwners: data.recipeOwners, links };
}

/** The node and everything inside it. */
export function within(node: CategoryNode): CategoryNode[] {
  return [node, ...node.children.flatMap(within)];
}

/** Whether a category path matches a filter (the category itself, or anything inside it). */
export function underPath(path: string, filter: string): boolean {
  const p = path.toLocaleLowerCase();
  const f = filter.toLocaleLowerCase();
  return p === f || p.startsWith(f + CATEGORY_SEPARATOR.toLocaleLowerCase());
}

/**
 * A path as typed: "Desserts › Cakes", or "Desserts > Cakes". Null when a part isn't a valid
 * name (empty, too long).
 */
export function parsePath(input: string): string[] | null {
  const names = input.split(/[›>]/).map((name) => name.trim().replace(/\s+/g, " "));
  if (names.length > 20) return null;
  return names.every(isCategoryName) ? names : null;
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

/** An edit, as the changes that make it and the changes that take it back. */
export interface Plan {
  changes: SyncChange[];
  undo: SyncChange[];
}

export interface PlanContext {
  me: string;
  now: number;
  newId?: () => string;
}

const category = (
  ctx: PlanContext,
  id: string,
  fields: CategoryChange["fields"],
  extra: Partial<CategoryChange> = {},
): CategoryChange => ({ kind: "category", id, fields, changedAt: ctx.now, ...extra });

const link = (
  ctx: PlanContext,
  recipeId: string,
  categoryId: string,
  deleted: boolean,
): RecipeCategoryChange => ({
  kind: "recipeCategory",
  recipeId,
  categoryId,
  deleted,
  changedAt: ctx.now,
});

/**
 * Finds the owner's category for a path, creating whatever's missing (and adding the changes
 * that create it). `made` remembers what this plan has created so far, by owner and path.
 */
function ensurePath(
  tree: CategoryTree,
  owner: string,
  names: string[],
  ctx: PlanContext,
  changes: SyncChange[],
  made: Map<string, string>,
): string {
  let parentId: string | null = null;
  for (let i = 1; i <= names.length; i++) {
    const key = pathKey(names.slice(0, i));
    const madeKey = `${owner}|${key}`;
    const existing =
      made.get(madeKey) ?? tree.byKey.get(key)?.ids.find((id) => tree.owners.get(id) === owner);
    if (existing) {
      parentId = existing;
      continue;
    }
    const id = (ctx.newId ?? (() => crypto.randomUUID()))();
    changes.push(
      category(
        ctx,
        id,
        { name: names[i - 1] ?? "", parentId, sortOrder: 0 },
        { create: owner === ctx.me ? {} : { ownerUserId: owner } },
      ),
    );
    made.set(madeKey, id);
    parentId = id;
  }
  return parentId ?? "";
}

/** A new category (and any parents it needs), for the signed-in person. */
export function createCategory(tree: CategoryTree, names: string[], ctx: PlanContext): Plan {
  const changes: SyncChange[] = [];
  ensurePath(tree, ctx.me, names, ctx, changes, new Map());
  return {
    changes,
    undo: changes.map((c) => category(ctx, (c as CategoryChange).id, {}, { deleted: true })),
  };
}

export function renameCategory(node: CategoryNode, name: string, ctx: PlanContext): Plan {
  const changes = node.ids.map((id) => category(ctx, id, { name }));
  const undo = node.ids.map((id) => category(ctx, id, { name: node.name }));
  return { changes, undo };
}

/** Whether a node can move under a target (null: the top level). Never into itself. */
export function canMove(node: CategoryNode, target: CategoryNode | null): boolean {
  if (target === null) return node.parent !== null;
  if (target === node.parent) return false;
  return !within(node).includes(target);
}

/** Puts a category inside another (null: the top level), where it goes there on its own. */
export function moveCategory(
  tree: CategoryTree,
  node: CategoryNode,
  target: CategoryNode | null,
  ctx: PlanContext,
): Plan {
  if (!canMove(node, target)) return { changes: [], undo: [] };
  const siblings = (target ? target.children : tree.roots).filter((n) => n !== node);
  // In a level someone arranged it goes last; in one nobody did, it takes its place by name.
  const last = siblings.filter(isPlaced).at(-1);
  const order = last ? last.order + ORDER_STEP : 0;
  return relocate(tree, node, target, new Map([[node, order]]), ctx);
}

/** Where a category is dropped: in a level (null: the top level), before one (null: at the end). */
export interface Place {
  parent: CategoryNode | null;
  before: CategoryNode | null;
}

/**
 * Whether a category can go there: "refused" into itself or anything inside it (owner's choice
 * 2026-11-04), "same" where it already is.
 */
export function checkPlace(tree: CategoryTree, node: CategoryNode, place: Place): PlaceCheck {
  if (place.parent && within(node).includes(place.parent)) return "refused";
  if (place.before === node) return "same";
  if (place.before && place.before.parent !== place.parent) return "refused";
  if (node.parent !== place.parent) return "ok";
  const siblings = place.parent ? place.parent.children : tree.roots;
  const next = siblings[siblings.indexOf(node) + 1] ?? null;
  return next === place.before ? "same" : "ok";
}

export type PlaceCheck = "ok" | "same" | "refused";

/** Whether a category can be dropped onto another, to go inside it. */
export function checkInside(node: CategoryNode, target: CategoryNode): PlaceCheck {
  if (within(node).includes(target)) return "refused";
  return target === node.parent ? "same" : "ok";
}

/**
 * Puts a category at a place among others (dragged between two, or Move up / Move down), with
 * everything inside it. The level becomes arranged: every category in it gets its place.
 */
export function placeCategory(
  tree: CategoryTree,
  node: CategoryNode,
  place: Place,
  ctx: PlanContext,
): Plan {
  if (checkPlace(tree, node, place) !== "ok") return { changes: [], undo: [] };
  const siblings = (place.parent ? place.parent.children : tree.roots).filter((n) => n !== node);
  const at = place.before ? siblings.indexOf(place.before) : siblings.length;
  siblings.splice(at < 0 ? siblings.length : at, 0, node);
  const orders = new Map(siblings.map((n, i) => [n, ORDER_BASE + i * ORDER_STEP]));
  return relocate(tree, node, place.parent, orders, ctx);
}

/**
 * The changes that put a node under a parent and give categories their sort orders, for every
 * person's category of each node (only what changes), and the changes that put them back.
 */
function relocate(
  tree: CategoryTree,
  node: CategoryNode,
  parent: CategoryNode | null,
  orders: Map<CategoryNode, number>,
  ctx: PlanContext,
): Plan {
  const changes: SyncChange[] = [];
  const undo: SyncChange[] = [];
  const made = new Map<string, string>();
  const moving = node.parent !== parent;
  for (const [each, order] of orders) {
    for (const id of each.ids) {
      const fields: CategoryChange["fields"] = {};
      const before: CategoryChange["fields"] = {};
      const owner = tree.owners.get(id) ?? ctx.me;
      if (each === node && moving) {
        fields.parentId = parent ? ensurePath(tree, owner, parent.names, ctx, changes, made) : null;
        before.parentId = node.parent?.ids.find((p) => tree.owners.get(p) === owner) ?? null;
      }
      const was = tree.orders.get(id) ?? 0;
      if (was !== order) {
        fields.sortOrder = order;
        before.sortOrder = was;
      }
      if (Object.keys(fields).length === 0) continue;
      changes.push(category(ctx, id, fields));
      undo.push(category(ctx, id, before));
    }
  }
  return { changes, undo };
}

/** Deletes a category and everything inside it. Recipes stay; they're only taken out of it. */
export function deleteCategory(tree: CategoryTree, node: CategoryNode, ctx: PlanContext): Plan {
  const ids = new Set(within(node).flatMap((n) => n.ids));
  const links = tree.links.filter((l) => ids.has(l.categoryId));
  return {
    changes: [
      ...links.map((l) => link(ctx, l.recipeId, l.categoryId, true)),
      ...[...ids].map((id) => category(ctx, id, {}, { deleted: true })),
    ],
    undo: [
      ...[...ids].map((id) => category(ctx, id, {}, { deleted: false })),
      ...links.map((l) => link(ctx, l.recipeId, l.categoryId, false)),
    ],
  };
}

/** Files recipes under a category; those already in it are left alone. */
export function fileRecipes(
  tree: CategoryTree,
  recipeIds: string[],
  names: string[],
  ctx: PlanContext,
): Plan & { added: string[] } {
  const target = tree.byKey.get(pathKey(names));
  const changes: SyncChange[] = [];
  const undo: SyncChange[] = [];
  const added: string[] = [];
  const made = new Map<string, string>();
  for (const recipeId of recipeIds) {
    if (target?.recipeIds.has(recipeId)) continue;
    const owner = tree.recipeOwners[recipeId] ?? ctx.me;
    const categoryId = ensurePath(tree, owner, names, ctx, changes, made);
    changes.push(link(ctx, recipeId, categoryId, false));
    undo.push(link(ctx, recipeId, categoryId, true));
    added.push(recipeId);
  }
  return { changes, undo, added };
}

/**
 * Files one recipe under several categories at once (an import's, phase E4), creating what's
 * missing once even when paths share a parent ("Diet › Vegan" and "Diet › Gluten-free").
 */
export function fileRecipeUnder(
  tree: CategoryTree,
  recipeId: string,
  paths: string[][],
  ctx: PlanContext,
  /** Categories already planned for other recipes saved with this one, so each is made once. */
  made = new Map<string, string>(),
): Plan {
  const changes: SyncChange[] = [];
  const undo: SyncChange[] = [];
  const seen = new Set<string>();
  for (const names of paths) {
    const key = pathKey(names);
    if (names.length === 0 || seen.has(key)) continue;
    seen.add(key);
    if (tree.byKey.get(key)?.recipeIds.has(recipeId)) continue;
    const owner = tree.recipeOwners[recipeId] ?? ctx.me;
    const categoryId = ensurePath(tree, owner, names, ctx, changes, made);
    changes.push(link(ctx, recipeId, categoryId, false));
    undo.push(link(ctx, recipeId, categoryId, true));
  }
  return { changes, undo };
}

/** Takes recipes out of a category (only that category, not the ones inside it). */
export function unfileRecipes(
  tree: CategoryTree,
  recipeIds: string[],
  node: CategoryNode,
  ctx: PlanContext,
): Plan & { removed: string[] } {
  const chosen = new Set(recipeIds);
  const ids = new Set(node.ids);
  const links = tree.links.filter((l) => chosen.has(l.recipeId) && ids.has(l.categoryId));
  return {
    changes: links.map((l) => link(ctx, l.recipeId, l.categoryId, true)),
    undo: links.map((l) => link(ctx, l.recipeId, l.categoryId, false)),
    removed: [...new Set(links.map((l) => l.recipeId))],
  };
}

/** The same changes, made now (an undo happens later than the edit it takes back). */
export function restamp(changes: SyncChange[], now: number): SyncChange[] {
  return changes.map((change) => ({ ...change, changedAt: now }));
}
