import type { ExtensionLinkCreated, ExtensionLinkSummary } from "../../shared/extension";

// The extension routes Fennl itself calls (worker/extension/routes.ts, phase E5).

export async function extensionLinks(): Promise<ExtensionLinkSummary[] | null> {
  const res = await fetch("/api/extension/links").catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { links: ExtensionLinkSummary[] }).links;
}

export type ConnectResult =
  | ({ ok: true } & ExtensionLinkCreated)
  | { ok: false; problem: "too_many" | "offline" | "failed" | "not_while_impersonating" };

export async function createExtensionLink(): Promise<ConnectResult> {
  const res = await fetch("/api/extension/links", { method: "POST" }).catch(() => null);
  if (!res) return { ok: false, problem: "offline" };
  if (res.ok) return { ok: true, ...((await res.json()) as ExtensionLinkCreated) };
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  if (error === "too_many" || error === "not_while_impersonating")
    return { ok: false, problem: error };
  return { ok: false, problem: "failed" };
}

export async function removeExtensionLink(id: string): Promise<boolean> {
  const res = await fetch(`/api/extension/links/${encodeURIComponent(id)}/remove`, {
    method: "POST",
  }).catch(() => null);
  return Boolean(res?.ok || res?.status === 404);
}
