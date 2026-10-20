import { useCallback, useEffect, useState } from "react";
import { MAX_SAVED_SEARCHES, type SavedSearch } from "../../shared/savedSearch";
import { activeSyncClient } from "../sync/useSync";

// A person's saved searches in the app (phase C13b). The list lives with their account and is
// read when the recipe list opens; this device keeps a copy so the saved searches still show
// with no connection. Saving, renaming and removing need a connection, and say so.

const cacheKey = (userId: string) => `fennl:saved-searches:${userId}`;

/** The copy kept on this device, or nothing. */
export function cachedSearches(userId: string): SavedSearch[] | null {
  try {
    const text = localStorage.getItem(cacheKey(userId));
    return text ? readList(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

function keepSearches(userId: string, searches: SavedSearch[]): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(searches));
  } catch {
    // Not kept; the list is read again next time there is a connection.
  }
}

/** A list from the server (or the cache), keeping only entries that are well formed. */
export function readList(value: unknown): SavedSearch[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (item): item is SavedSearch =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as SavedSearch).id === "string" &&
      typeof (item as SavedSearch).name === "string" &&
      typeof (item as SavedSearch).query === "string",
  );
}

/** What went wrong, in words for the person. */
export function problemText(error: string): string {
  switch (error) {
    case "offline":
      return "Saved searches can only be changed with a connection. Try again when you're back online.";
    case "name_taken":
      return "You already have a saved search with that name.";
    case "too_many":
      return `An account can keep ${MAX_SAVED_SEARCHES} saved searches. Remove one first.`;
    case "invalid_name":
      return "Give it a name of up to 60 letters.";
    case "invalid_query":
      return "There's nothing to save yet. Search for something or choose a filter first.";
    case "not_found":
      return "That saved search is gone. The list has been refreshed.";
    case "rate_limited":
      return "That's a lot of changes at once. Wait a moment and try again.";
    default:
      return "That didn't work. Try again in a moment.";
  }
}

export type Outcome = { ok: true; search?: SavedSearch } | { ok: false; error: string };

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: { search?: SavedSearch; searches?: unknown; error?: string } }> {
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as never };
}

/** The list as the server has it, or null with no connection or no answer. */
async function fetchList(): Promise<SavedSearch[] | null> {
  try {
    const { status, body } = await call("GET", "/api/saved-searches");
    return status === 200 ? readList(body.searches) : null;
  } catch {
    return null;
  }
}

/**
 * The saved searches and the ways to change them. `searches` is null until there is a first
 * answer (from this device's copy, or the server).
 */
export function useSavedSearches() {
  const client = activeSyncClient();
  const userId = client?.userId ?? null;
  // An admin acting as someone leaves nothing behind on this device (phase C12).
  const keepOnDevice = client !== null && !client.acting;
  const [searches, setSearches] = useState<SavedSearch[] | null>(() =>
    userId && keepOnDevice ? cachedSearches(userId) : null,
  );

  const show = useCallback(
    (list: SavedSearch[]) => {
      setSearches(list);
      if (userId && keepOnDevice) keepSearches(userId, list);
    },
    [userId, keepOnDevice],
  );

  const reload = useCallback(() => {
    void fetchList().then((list) => {
      if (list) show(list);
    });
  }, [show]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = () =>
      void fetchList().then((list) => {
        if (list && !cancelled) show(list);
      });
    load();
    window.addEventListener("online", load);
    return () => {
      cancelled = true;
      window.removeEventListener("online", load);
    };
  }, [userId, show]);

  /** Runs a change and, when it works, puts the new list on screen. */
  const change = useCallback(
    async (
      method: string,
      path: string,
      body: unknown,
      next: (before: SavedSearch[], search?: SavedSearch) => SavedSearch[],
    ): Promise<Outcome> => {
      if (!navigator.onLine) return { ok: false, error: "offline" };
      try {
        const { status, body: answer } = await call(method, path, body);
        if (status >= 200 && status < 300) {
          show(next(searches ?? [], answer.search));
          return { ok: true, ...(answer.search ? { search: answer.search } : {}) };
        }
        if (answer.error === "not_found") reload();
        return { ok: false, error: answer.error ?? "failed" };
      } catch {
        return { ok: false, error: "offline" };
      }
    },
    [searches, show, reload],
  );

  const sorted = (list: SavedSearch[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return {
    searches,
    save: (name: string, query: string) =>
      change("POST", "/api/saved-searches", { name, query }, (before, search) =>
        search ? sorted([...before, search]) : before,
      ),
    rename: (id: string, name: string) =>
      change("PUT", `/api/saved-searches/${id}`, { name }, (before, search) =>
        sorted(before.map((s) => (s.id === id && search ? search : s))),
      ),
    update: (id: string, query: string) =>
      change("PUT", `/api/saved-searches/${id}`, { query }, (before, search) =>
        before.map((s) => (s.id === id && search ? search : s)),
      ),
    remove: (id: string) =>
      change("DELETE", `/api/saved-searches/${id}`, undefined, (before) =>
        before.filter((s) => s.id !== id),
      ),
  };
}
