import { useCallback, useEffect, useState } from "react";
import { pairKey } from "../../shared/duplicates";
import { activeSyncClient } from "../sync/useSync";

// "Not a duplicate" answers in the app (phase C14). The list lives with the account and is read
// when the duplicate finder opens; this device keeps a copy so the answers still apply with no
// connection. Adding, taking back and clearing need a connection, and say so.

const cacheKey = (userId: string) => `fennl:duplicate-dismissals:${userId}`;

/** Pairs as the server or the cache gave them, keeping only well-formed ones. */
export function readPairs(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const keys: string[] = [];
  for (const item of value) {
    if (
      Array.isArray(item) &&
      item.length === 2 &&
      typeof item[0] === "string" &&
      typeof item[1] === "string"
    ) {
      keys.push(pairKey(item[0], item[1]));
    }
  }
  return keys;
}

function cached(userId: string): string[] | null {
  try {
    const text = localStorage.getItem(cacheKey(userId));
    return text ? readPairs(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

function keep(userId: string, keys: string[]): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(keys.map((key) => key.split("|"))));
  } catch {
    // Not kept; the list is read again next time there is a connection.
  }
}

export type Outcome = { ok: true } | { ok: false; error: "offline" | "failed" | "too_many" };

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function fetchPairs(): Promise<string[] | null> {
  try {
    const res = await call("GET", "/api/duplicate-dismissals");
    return res.ok ? readPairs(((await res.json()) as { pairs?: unknown }).pairs) : null;
  } catch {
    return null;
  }
}

/** The pairs said not to be duplicates (as `pairKey`s; null until there is a first answer), and how to change them. */
export function useDuplicateDismissals() {
  const client = activeSyncClient();
  const userId = client?.userId ?? null;
  // An admin acting as someone leaves nothing behind on this device (phase C12).
  const keepOnDevice = client !== null && !client.acting;
  const [pairs, setPairs] = useState<string[] | null>(() =>
    userId && keepOnDevice ? cached(userId) : null,
  );

  const show = useCallback(
    (keys: string[]) => {
      setPairs(keys);
      if (userId && keepOnDevice) keep(userId, keys);
    },
    [userId, keepOnDevice],
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = () =>
      void fetchPairs().then((keys) => {
        if (keys && !cancelled) show(keys);
      });
    load();
    window.addEventListener("online", load);
    return () => {
      cancelled = true;
      window.removeEventListener("online", load);
    };
  }, [userId, show]);

  const change = useCallback(
    async (
      run: () => Promise<Response>,
      next: (before: string[]) => string[],
    ): Promise<Outcome> => {
      if (!navigator.onLine) return { ok: false, error: "offline" };
      try {
        const res = await run();
        if (res.ok) {
          show(next(pairs ?? []));
          return { ok: true };
        }
        const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        return { ok: false, error: error === "too_many" ? "too_many" : "failed" };
      } catch {
        return { ok: false, error: "offline" };
      }
    },
    [pairs, show],
  );

  return {
    pairs,
    dismiss: (a: string, b: string) =>
      change(
        () => call("POST", "/api/duplicate-dismissals", { a, b }),
        (before) => [...new Set([...before, pairKey(a, b)])],
      ),
    undismiss: (a: string, b: string) =>
      change(
        () => call("DELETE", `/api/duplicate-dismissals/${a}/${b}`),
        (before) => before.filter((key) => key !== pairKey(a, b)),
      ),
    clear: () =>
      change(
        () => call("DELETE", "/api/duplicate-dismissals"),
        () => [],
      ),
  };
}

/** What went wrong, in words for the person. */
export function problemText(error: "offline" | "failed" | "too_many"): string {
  switch (error) {
    case "offline":
      return "That can only be changed with a connection. Try again when you're back online.";
    case "too_many":
      return "That's the most answers an account can keep. Choose 'Show dismissed pairs again' to start fresh.";
    default:
      return "That didn't work. Try again in a moment.";
  }
}
