import { useEffect, useState, useSyncExternalStore } from "react";
import type { SyncChange } from "../../shared/sync";
import { deviceId } from "../devices/deviceId";
import { categoryTree, type CategoryTree } from "../categories/tree";
import type { RecipeDetail, RecipeSummary } from "./dbProtocol";
import { STARTING, type SyncStatus } from "./status";
import { SyncClient } from "./tabs";

// The app's way in to syncing (phase C4). There's one SyncClient per page, for the signed-in
// account; it starts the first time a page asks for it and lasts until the page closes (or
// another account signs in here).

let current: { userId: string; client: SyncClient } | null = null;

export function syncClientFor(userId: string): SyncClient {
  if (current?.userId === userId) return current.client;
  current?.client.stop();
  const client = new SyncClient(userId, deviceId());
  client.start();
  current = { userId, client };
  return client;
}

/** The running client, if the app has started one. */
export function activeSyncClient(): SyncClient | null {
  return current?.client ?? null;
}

const noSubscription = () => () => undefined;

/** Where syncing stands, updated as it changes. */
export function useSyncStatus(): SyncStatus {
  const client = activeSyncClient();
  return useSyncExternalStore(
    client?.subscribeStatus ?? noSubscription,
    client?.getStatus ?? (() => STARTING),
  );
}

/** The recipe list from the local copy, read again whenever it changes. Null while loading. */
export function useRecipeList(): RecipeSummary[] | null {
  const client = activeSyncClient();
  const [list, setList] = useState<RecipeSummary[] | null>(null);
  useEffect(() => {
    if (!client) return;
    let latest = 0;
    const load = () => {
      const call = ++latest;
      client
        .listRecipes()
        .then((recipes) => {
          if (call === latest) setList(recipes);
        })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = client.subscribeChanges(load);
    return () => {
      latest = -1;
      unsubscribe();
    };
  }, [client]);
  return list;
}

/**
 * One recipe with everything its page shows, read again whenever the local copy changes.
 * Undefined while loading; null when it isn't here (or is in Trash).
 */
export function useRecipe(id: string): RecipeDetail | null | undefined {
  const client = activeSyncClient();
  const [detail, setDetail] = useState<{ id: string; value: RecipeDetail | null } | null>(null);
  useEffect(() => {
    if (!client) return;
    let latest = 0;
    const load = () => {
      const call = ++latest;
      client
        .getRecipe(id)
        .then((value) => {
          if (call === latest) setDetail({ id, value });
        })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = client.subscribeChanges(load);
    return () => {
      latest = -1;
      unsubscribe();
    };
  }, [client, id]);
  return detail?.id === id ? detail.value : undefined;
}

/** The household's category tree (phase C7), built again whenever the local copy changes. */
export function useCategoryTree(): CategoryTree | null {
  const client = activeSyncClient();
  const [tree, setTree] = useState<CategoryTree | null>(null);
  useEffect(() => {
    if (!client) return;
    let latest = 0;
    const load = () => {
      const call = ++latest;
      client
        .getCategories()
        .then((data) => {
          if (call === latest) setTree(categoryTree(data, client.userId));
        })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = client.subscribeChanges(load);
    return () => {
      latest = -1;
      unsubscribe();
    };
  }, [client]);
  return tree;
}

/** Saves changes together; false when they couldn't be saved (editing paused, for one). */
export async function saveChanges(changes: SyncChange[]): Promise<boolean> {
  try {
    await activeSyncClient()?.saveMany(changes);
    return true;
  } catch {
    return false;
  }
}
