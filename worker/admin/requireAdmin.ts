import { count, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth/auth";
import { database, type Database } from "../db/client";
import { passkey, session as sessionTable } from "../db/schema";
import { passedAccess } from "./access";

/** Admin sessions end after 30 minutes without use, or 8 hours after signing in. */
export const ADMIN_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_MAX_MS = 8 * 60 * 60 * 1000;
/** Sensitive actions need a passkey sign-in from the last 5 minutes. */
export const FRESH_PASSKEY_MS = 5 * 60 * 1000;

export interface AdminContext {
  db: Database;
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  signedInAt: Date;
  /** When the session ends if left alone: idle timeout or the 8-hour cap, whichever is first. */
  expiresAt: Date;
}

/** Reads Cloudflare's Access context, which only exists on real Cloudflare requests. */
export function accessContext(c: { executionCtx: unknown }): CloudflareAccessContext | undefined {
  try {
    return (c.executionCtx as ExecutionContext | undefined)?.access;
  } catch {
    // Hono throws when there's no execution context (tests calling app.request directly).
    return undefined;
  }
}

export async function passkeyCount(db: Database, userId: string): Promise<number> {
  const row = await db.select({ n: count() }).from(passkey).where(eq(passkey.userId, userId)).get();
  return row?.n ?? 0;
}

type AdminCheck =
  | { ok: true; admin: AdminContext }
  | { ok: false; status: 401 | 403; body: Record<string, unknown> };

/**
 * Every admin request passes all of these, in order:
 *  1. Cloudflare Access let it through.
 *  2. It's signed in.
 *  3. The account has the admin role (granted only by a database command).
 *  4. The session was signed in with a passkey (password sessions may only set up a first
 *     passkey; see the passkey guard in worker/index.ts).
 *  5. The session is under 8 hours old and was used in the last 30 minutes.
 */
export async function checkAdmin(
  request: Request,
  env: Env,
  access: CloudflareAccessContext | undefined,
  now = new Date(),
): Promise<AdminCheck> {
  if (!(await passedAccess(request, env, access))) {
    return { ok: false, status: 403, body: { error: "access_required" } };
  }
  const auth = await createAuth(env, request);
  const result = await auth.api.getSession({ headers: request.headers });
  if (!result) return { ok: false, status: 401, body: { error: "signed_out" } };

  const { user, session } = result;
  // Acting as someone (phase C12): the console waits until that's stopped.
  if (session.impersonatedBy) return { ok: false, status: 403, body: { error: "impersonating" } };
  if (user.role !== "admin") return { ok: false, status: 403, body: { error: "not_admin" } };

  const db = database(env.DB);
  if (session.authMethod !== "passkey") {
    const passkeys = await passkeyCount(db, user.id);
    return {
      ok: false,
      status: 403,
      body: { error: "passkey_required", canRegister: passkeys === 0 },
    };
  }

  const signedInAt = new Date(session.createdAt);
  const lastActive = session.lastActiveAt ? new Date(session.lastActiveAt) : signedInAt;
  if (
    now.getTime() - signedInAt.getTime() >= ADMIN_MAX_MS ||
    now.getTime() - lastActive.getTime() >= ADMIN_IDLE_MS
  ) {
    // Expired: end the session for good, not just for this request.
    await db.delete(sessionTable).where(eq(sessionTable.id, session.id));
    return { ok: false, status: 401, body: { error: "session_expired" } };
  }

  await db.update(sessionTable).set({ lastActiveAt: now }).where(eq(sessionTable.id, session.id));
  const expiresAt = new Date(
    Math.min(signedInAt.getTime() + ADMIN_MAX_MS, now.getTime() + ADMIN_IDLE_MS),
  );
  return {
    ok: true,
    admin: {
      db,
      userId: user.id,
      email: user.email,
      name: user.name,
      sessionId: session.id,
      signedInAt,
      expiresAt,
    },
  };
}

/** Whether the admin signed in with their passkey recently enough for a sensitive action. */
export function hasFreshPasskey(admin: AdminContext, now = new Date()): boolean {
  return now.getTime() - admin.signedInAt.getTime() < FRESH_PASSKEY_MS;
}

/**
 * Sensitive admin actions (password changes and limit changes, CLAUDE.md "Admin console") need
 * the passkey again: a passkey sign-in in the last 5 minutes. The console answers
 * "passkey_reconfirm" by asking for the passkey, which starts a fresh session, and retries.
 */
export function freshPasskeyProblem(admin: AdminContext, now = new Date()) {
  return hasFreshPasskey(admin, now) ? null : { error: "passkey_reconfirm" as const };
}

/** Hono middleware for /api/admin routes: the checks above, then c.var.admin. */
export const requireAdmin = createMiddleware<{
  Bindings: Env;
  Variables: { admin: AdminContext };
}>(async (c, next) => {
  const check = await checkAdmin(c.req.raw, c.env, accessContext(c));
  if (!check.ok) return c.json(check.body, check.status);
  c.set("admin", check.admin);
  await next();
});
