import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  addQuickSearch,
  DEFAULT_QUICK_SEARCHES,
  MAX_QUICK_SEARCHES,
  mergeQuickSearches,
  moveQuickSearchBefore,
  presetMatches,
  quickFilterLabel,
  quickSearchFull,
  quickSearchKey,
  readQuickSearches,
  removeQuickSearch,
  replaceQuickSearch,
  type QuickFilter,
  type QuickSearchItem,
} from "../../shared/quickSearches";
import type { SavedSearch } from "../../shared/savedSearch";
import { useSession } from "../auth/client";
import { activeSyncClient } from "../sync/useSync";

// The person's quick searches in the app (U18, shared/quickSearches.ts). The list belongs to the
// account (user.quick_searches, returned with the session), so it follows the person to every
// device; this device keeps a copy so it still shows with no connection. Changing it needs a
// connection, like saved searches: each change saves the whole list, shows at once, and is put
// back if the save doesn't go through.
//
// Saved searches come from useSavedSearches (savedSearches.ts), passed in: one the list doesn't
// name yet shows at the end, and one that is gone is skipped. Deleting a search line is deleting
// its saved search (useSavedSearches().remove); the line then goes by itself.

const cacheKey = (userId: string) => `fennl:quick-searches:${userId}`;

function cached(userId: string): QuickSearchItem[] | null {
  try {
    const text = localStorage.getItem(cacheKey(userId));
    return text === null ? null : readQuickSearches(text);
  } catch {
    return null;
  }
}

function keep(userId: string, items: QuickSearchItem[]): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(items));
  } catch {
    // Not kept; the account's list comes back with the next session.
  }
}

async function save(items: QuickSearchItem[]): Promise<boolean> {
  try {
    const res = await fetch("/api/account/quick-searches", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// A change made on this page that the session doesn't show yet, shared by every part of the page
// showing the list (the left panel and Filters both do).
type Pending = { userId: string; items: QuickSearchItem[] };
let pending: Pending | null = null;
let lastSaved: Pending | null = null;
// The account's list as the session last showed it.
let account: Pending | null = null;
let saving = 0;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function setPending(next: Pending | null) {
  pending = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const getPending = () => pending;
const same = (a: Pending, b: Pending | null) =>
  b !== null && a.userId === b.userId && JSON.stringify(a.items) === JSON.stringify(b.items);

/**
 * Forgets the change made on this page once nothing is saving and the session shows the same list,
 * so a later change from another device shows here.
 */
function settle() {
  // A saved change the session shows is the account's list now, not something to put back.
  if (lastSaved && same(lastSaved, account)) lastSaved = null;
  if (pending && saving === 0 && same(pending, account)) setPending(null);
}

/** For tests: forget changes made on this page. */
export function resetQuickSearchStore(): void {
  pending = null;
  lastSaved = null;
  account = null;
  saving = 0;
  queue = Promise.resolve();
}

export type QuickSearchError = "offline" | "too_many" | "failed";
export type QuickSearchOutcome = { ok: true } | { ok: false; error: QuickSearchError };

/** What went wrong, in words for the person. */
export function quickSearchProblem(error: QuickSearchError): string {
  switch (error) {
    case "offline":
      return "Quick searches can only be changed with a connection. Try again when you're back online.";
    case "too_many":
      return `You can keep ${MAX_QUICK_SEARCHES} quick searches besides your saved searches. Remove one first.`;
    default:
      return "That change to your quick searches didn't save. Try again in a moment.";
  }
}

/** One line to show. */
export interface QuickSearchEntry {
  /** The line's key (quickSearchKey), the same for lines that are the same to a person. */
  key: string;
  item: QuickSearchItem;
  /** The line's name: a tick line's ("30 minutes or less"), or the saved search's own name. */
  label: string;
  /** The saved search, for a search line. */
  search: SavedSearch | null;
}

/**
 * The quick searches to show and the ways to change them. `searches` is the person's saved
 * searches (useSavedSearches().searches), or null until they are known: search lines show once
 * they are. Every change resolves to whether it was saved; a change that wasn't is already put
 * back on screen, and `quickSearchProblem` says why.
 */
export function useQuickSearches(searches: SavedSearch[] | null) {
  const { data: session, refetch } = useSession();
  const client = activeSyncClient();
  const userId = session?.user.id ?? client?.userId ?? null;
  // An admin acting as someone leaves nothing behind on this device (phase C12).
  const keepOnDevice = !(client?.acting ?? false);
  const stored = session ? (session.user.quickSearches ?? null) : undefined;
  const local = useSyncExternalStore(subscribe, getPending, getPending);

  const fromAccount = useMemo(() => {
    if (stored !== undefined) return readQuickSearches(stored);
    return (userId && keepOnDevice ? cached(userId) : null) ?? DEFAULT_QUICK_SEARCHES;
  }, [stored, userId, keepOnDevice]);
  const base = local && local.userId === userId ? local.items : fromAccount;
  const items = useMemo(() => mergeQuickSearches(base, searches), [base, searches]);

  const entries = useMemo<QuickSearchEntry[]>(() => {
    const byId = new Map((searches ?? []).map((s) => [s.id, s]));
    const shown: QuickSearchEntry[] = [];
    for (const item of items) {
      if (item.type === "search") {
        const search = byId.get(item.id);
        if (search) shown.push({ key: quickSearchKey(item), item, label: search.name, search });
      } else {
        shown.push({
          key: quickSearchKey(item),
          item,
          label: quickFilterLabel(item),
          search: null,
        });
      }
    }
    return shown;
  }, [items, searches]);

  // The account's list, kept on this device; and a change made here forgotten once the session
  // shows it.
  useEffect(() => {
    if (stored === undefined || !userId) return;
    account = { userId, items: readQuickSearches(stored) };
    if (keepOnDevice) keep(userId, account.items);
    settle();
  }, [stored, userId, keepOnDevice]);

  const change = useCallback(
    async (
      next: (items: QuickSearchItem[]) => QuickSearchItem[] | QuickSearchError,
    ): Promise<QuickSearchOutcome> => {
      const id = userId;
      if (!id) return { ok: false, error: "failed" };
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return { ok: false, error: "offline" };
      }
      const before = mergeQuickSearches(
        // A change made a moment ago counts even before the page shows it.
        pending && pending.userId === id ? pending.items : fromAccount,
        searches,
      );
      const after = next(before);
      if (typeof after === "string") return { ok: false, error: after };
      if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

      const mine: Pending = { userId: id, items: after };
      setPending(mine);
      saving++;
      const done = queue.then(() => save(after));
      queue = done;
      const saved = await done;
      saving--;
      if (saved) {
        lastSaved = mine;
        // The session may already show this list (changed and changed back), so it won't change.
        settle();
        void refetch();
        return { ok: true };
      }
      // Put back what was last saved when the session doesn't show it yet, else the account's
      // list as the session shows it; unless another change has been made since.
      if (pending === mine) {
        setPending(lastSaved && lastSaved.userId === id ? lastSaved : null);
        settle();
      }
      return { ok: false, error: "failed" };
    },
    [userId, fromAccount, searches, refetch],
  );

  // One object while nothing changes, so what shows the list only draws again when it does.
  return useMemo(
    () => ({
      /** The lines to show, in order. */
      entries,
      /** Every line, search lines included even before their saved searches are known. */
      items,
      /** Whether a line is in the list. */
      has: (item: QuickSearchItem) => items.some((i) => quickSearchKey(i) === quickSearchKey(item)),
      /** The line a "+ Add" preset stands for (presetMatches), or null. */
      presetEntry: (preset: QuickFilter) => {
        const item = items.find((i) => presetMatches(preset, i));
        return item ? (entries.find((e) => e.key === quickSearchKey(item)) ?? null) : null;
      },
      /** Adds a line at the end (nothing happens when it's already there). */
      add: (item: QuickSearchItem) =>
        change((list) => {
          const key = quickSearchKey(item);
          if (list.some((i) => quickSearchKey(i) === key)) return list;
          return quickSearchFull(list, item) ? "too_many" : addQuickSearch(list, item);
        }),
      /** Removes the line with this key. For a search line, delete the saved search instead. */
      remove: (key: string) => change((list) => removeQuickSearch(list, key)),
      /** Adds the line, or removes it when it's there (Filters' "Add to quick searches"). */
      toggle: (item: QuickSearchItem) =>
        change((list) => {
          const key = quickSearchKey(item);
          if (list.some((i) => quickSearchKey(i) === key)) return removeQuickSearch(list, key);
          return quickSearchFull(list, item) ? "too_many" : addQuickSearch(list, item);
        }),
      /** A "+ Add" preset: removes the line it stands for, or adds it. */
      togglePreset: (preset: QuickFilter) =>
        change((list) => {
          const there = list.find((i) => presetMatches(preset, i));
          if (there) return removeQuickSearch(list, quickSearchKey(there));
          return quickSearchFull(list, preset) ? "too_many" : addQuickSearch(list, preset);
        }),
      /** Changes a line in place (a choice from its ▾); another line now the same is removed. */
      replace: (key: string, next: QuickSearchItem) =>
        change((list) => replaceQuickSearch(list, key, next)),
      /**
       * Moves a line to just before another (a drag dropping it between two lines), or to the end
       * with null. Alt+ArrowUp is `moveBefore(key, entries[i - 1].key)`; Alt+ArrowDown is
       * `moveBefore(key, entries[i + 2]?.key ?? null)`.
       */
      moveBefore: (key: string, before: string | null) =>
        change((list) => moveQuickSearchBefore(list, key, before)),
    }),
    [entries, items, change],
  );
}

export type QuickSearches = ReturnType<typeof useQuickSearches>;
