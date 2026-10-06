import { adminAuthClient } from "./client";

export interface AdminResult<T> {
  ok: boolean;
  status: number;
  body: T | { error?: string } | null;
}

/**
 * Calls the admin API. Sensitive changes (passwords, limits) answer "passkey_reconfirm" when the
 * passkey sign-in is more than 5 minutes old: the browser then asks for the passkey (a fresh
 * sign-in) and the change is sent once more.
 */
export async function adminRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<AdminResult<T>> {
  const send = async () => {
    const res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      ...(init.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
    });
    const body = (await res.json().catch(() => null)) as T | { error?: string } | null;
    return { ok: res.ok, status: res.status, body };
  };
  try {
    const first = await send();
    if ((first.body as { error?: string } | null)?.error !== "passkey_reconfirm") return first;
    const signedIn = await adminAuthClient.signIn.passkey();
    if (signedIn?.error) return first;
    return await send();
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export function errorOf(result: AdminResult<unknown>): string | undefined {
  return (result.body as { error?: string } | null)?.error;
}
