import type { ExtensionMe } from "../shared/extension";

// The extension's connection to Fennl (phase E5): its key, kept in the extension's own storage,
// and asking Fennl who it's connected to.

export const ORIGIN = __FENNL_ORIGIN__;

/** What the extension keeps: the key Fennl gave it, and which connection it is. */
export interface Connection {
  key: string;
  linkId: string;
}

const STORAGE_KEY = "connection";

export async function savedConnection(): Promise<Connection | null> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
    Partial<Connection> | undefined;
  return stored?.key && stored.linkId ? { key: stored.key, linkId: stored.linkId } : null;
}

export function saveConnection(connection: Connection): Promise<void> {
  return chrome.storage.local.set({ [STORAGE_KEY]: connection });
}

export function forgetConnection(): Promise<void> {
  return chrome.storage.local.remove(STORAGE_KEY);
}

export type MeResult =
  | { status: "connected"; me: ExtensionMe }
  | { status: "not_connected" }
  | { status: "password_change_required" }
  | { status: "offline" };

/** Who the key belongs to. A key Fennl no longer accepts is forgotten. */
export async function whoAmI(connection: Connection): Promise<MeResult> {
  let res: Response;
  try {
    res = await fetch(`${ORIGIN}/api/extension/me`, {
      headers: { authorization: `Bearer ${connection.key}` },
      credentials: "omit",
    });
  } catch {
    return { status: "offline" };
  }
  if (res.status === 401) {
    await forgetConnection();
    return { status: "not_connected" };
  }
  if (res.status === 403) return { status: "password_change_required" };
  if (!res.ok) return { status: "offline" };
  return { status: "connected", me: (await res.json()) as ExtensionMe };
}

/** The extension's own "Disconnect": Fennl stops accepting the key, and it's forgotten here. */
export async function disconnect(connection: Connection): Promise<void> {
  try {
    await fetch(`${ORIGIN}/api/extension/disconnect`, {
      method: "POST",
      headers: { authorization: `Bearer ${connection.key}` },
      credentials: "omit",
    });
  } finally {
    await forgetConnection();
  }
}
