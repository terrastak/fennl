import { useEffect, useState, useSyncExternalStore } from "react";
import { deviceId } from "../devices/deviceId";
import type { RecipeSummary } from "./dbProtocol";
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
