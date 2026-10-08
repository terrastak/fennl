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
  recipeOwners: Record<string, string>;
  links: CategoryLink[];
}

export const pathKey = (names: string[]) => names.join(CATEGORY_SEPARATOR).toLocaleLowerCase();

const byName = (a: CategoryNode, b: CategoryNode) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

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
  }
  const links = data.links.filter((link) => byId.has(link.categoryId));
  for (const link of links) byId.get(link.categoryId)?.recipeIds.add(link.recipeId);

  const roots = [...byKey.values()].filter((n) => !n.parent);
  const nodes: CategoryNode[] = [];
  const walk = (list: CategoryNode[]): Set<string> => {
    const all = new Set<string>();
    for (const n of list.sort(byName)) {
      nodes.push(n);
      const inside = new Set([...n.recipeIds, ...walk(n.children)]);
      n.count = inside.size;
      for (const id of inside) all.add(id);
    }
    return all;
  };
  walk(roots);
  return { roots, nodes, byKey, byId, owners, recipeOwners: data.recipeOwners, links };
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

export function moveCategory(
  tree: CategoryTree,
  node: CategoryNode,
  target: CategoryNode | null,
  ctx: PlanContext,
): Plan {
  if (!canMove(node, target)) return { changes: [], undo: [] };
  const changes: SyncChange[] = [];
  const undo: SyncChange[] = [];
  const made = new Map<string, string>();
  for (const id of node.ids) {
    const owner = tree.owners.get(id) ?? ctx.me;
    const parentId = target ? ensurePath(tree, owner, target.names, ctx, changes, made) : null;
    const before = node.parent?.ids.find((p) => tree.owners.get(p) === owner) ?? null;
    changes.push(category(ctx, id, { parentId }));
    undo.push(category(ctx, id, { parentId: before }));
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
