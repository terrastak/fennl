import type { RefusedLimit, RefusedWhat } from "../../shared/accountEvents";
import { activeSyncClient } from "../sync/useSync";

// Telling the admin console that a limit stopped someone (phase U15). The app stops some
// additions before they reach the server (a new recipe over the plan's recipe limit, putting one
// back from Trash...), so the server never sees them refused. When the person actually presses
// the blocked action, the app says so; the server checks the limit again itself and records it
// only if it agrees. Never while an admin acts as the person, never offline, and never in the way:
// nothing waits for it and a failure is ignored.

/** The same refusal is told at most once a minute from this page. */
const QUIET_MS = 60_000;
const told = new Map<string, number>();

/**
 * Says the person pressed an action a limit blocks: `what` is what they tried ("recipe": Add
 * recipe; "restore": putting one back from Trash; "import": saving drafts, or a Paprika import that
 * left recipes out for want of room).
 */
export function reportRefused(limit: RefusedLimit, what: RefusedWhat, now = Date.now()): void {
  const client = activeSyncClient();
  if (!client || client.acting) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (client.getStatus().phase === "offline") return;
  const key = `${limit}:${what}`;
  const last = told.get(key);
  if (last !== undefined && now - last < QUIET_MS) return;
  told.set(key, now);
  void fetch("/api/limits/refused", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit, what }),
    keepalive: true,
  }).catch(() => undefined);
}
