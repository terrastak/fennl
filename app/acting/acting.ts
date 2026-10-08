import { activeSyncClient } from "../sync/useSync";

// An admin acting as someone (phase C12). The session says so (impersonatedBy, set by Better
// Auth's admin plugin); the server enforces everything, and the app shows a banner, keeps a
// separate copy of the recipes, and wipes it on the way out.

/** The parts of the session this needs. */
export interface ActingSession {
  session: { impersonatedBy?: string | null; expiresAt?: string | Date | null };
}

export function isActing(session: ActingSession | null | undefined): boolean {
  return Boolean(session?.session.impersonatedBy);
}

/** When acting ends by itself (30 minutes after it started). */
export function actingEndsAt(session: ActingSession): Date | null {
  const at = session.session.expiresAt;
  return at ? new Date(at) : null;
}

/**
 * Stops acting: wipes this browser's copy of the person's recipes, goes back to the admin's own
 * session, and opens their account in the console. If acting already ended (after 30 minutes),
 * the copy is still wiped and the console asks the admin to sign in again.
 */
export async function stopActing(accountId: string): Promise<void> {
  try {
    await activeSyncClient()?.wipe();
  } catch (error) {
    console.error("Couldn't empty the copy of their recipes", error);
  }
  activeSyncClient()?.stop();
  const res = await fetch("/api/admin/impersonation/stop", { method: "POST" }).catch(() => null);
  window.location.assign(res?.ok ? `/admin?account=${encodeURIComponent(accountId)}` : "/admin");
}
