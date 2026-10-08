import { eq } from "drizzle-orm";
import { Hono, type Context, type HonoRequest } from "hono";
import type { SyncChange } from "../../shared/sync";
import { createAuth } from "../auth/auth";
import { database } from "../db/client";
import { session as sessionTable } from "../db/schema";
import { passedAccess } from "./access";
import { findAccount } from "./accounts";
import { recordAdminAction } from "./audit";
import { alertOwner } from "./events";
import { accessContext, freshPasskeyProblem, type AdminContext } from "./requireAdmin";

// Acting as a user (phase C12; CLAUDE.md, "Admin console"). An admin starts it from an account's
// page in the console, with a reason and their passkey again. Better Auth's admin plugin makes
// a session for the person, marked impersonated_by, that ends after 30 minutes
// (impersonationSessionDuration), and keeps the admin's own session to go back to.
//
// While it lasts:
//  - The app runs as the person, on the admin address in production (behind Cloudflare Access;
//    worker/index.ts lets the app through there only for these sessions).
//  - Every change is recorded in the admin log, under the admin, before it's made
//    (requireHousehold calls recordChange).
//  - Nothing shows the person: no device is registered, no email goes to them, and the session
//    is left out of their own session list.
//  - Password, email and feedback are refused (the console has its own tools for those, with
//    the passkey asked again).

/** A reason is required: something an auditor can understand later. */
export const REASON_LENGTH = { min: 5, max: 500 };

/** Routes refused while acting as someone: the console does these, with its own checks. */
const REFUSED = [
  "/api/account/email",
  "/api/account/email/pending",
  "/api/account/password",
  "/api/feedback",
  "/api/devices/takeover",
];

/** Writes that change nothing while acting as someone, so aren't worth a log entry. */
const NOT_CHANGES = ["/api/devices/register"];

const isWrite = (method: string) => method !== "GET" && method !== "HEAD";

export function refusedWhileImpersonating(method: string, path: string): boolean {
  return isWrite(method) && REFUSED.includes(path);
}

/** A short description of what a sync push changes, for the log (no recipe text). */
function describePush(text: string): string[] {
  let changes: unknown;
  try {
    changes = (JSON.parse(text) as { changes?: unknown }).changes;
  } catch {
    return [];
  }
  if (!Array.isArray(changes)) return [];
  return (changes as SyncChange[]).slice(0, 100).map((change) => {
    const short = (id: unknown) => (typeof id === "string" ? id.slice(0, 8) : "?");
    const fields = (f: unknown) =>
      f && typeof f === "object" ? Object.keys(f as Record<string, unknown>).join(", ") : "";
    switch (change?.kind) {
      case "recipe": {
        const what = change.create
          ? "created"
          : change.deleted === true
            ? "moved to Trash"
            : change.deleted === false
              ? "put back from Trash"
              : "edited";
        const f = change.create ? "" : fields(change.fields);
        return `recipe ${short(change.id)} ${what}${f ? `: ${f}` : ""}`;
      }
      case "opinion":
        return `recipe ${short(change.recipeId)} opinion: ${fields(change.fields)}`;
      case "made":
        return `recipe ${short(change.recipeId)} made it${change.deleted ? " (taken back)" : ""}`;
      case "category":
        return `category ${short(change.id)} ${change.create ? "created" : change.deleted ? "deleted" : "changed"}`;
      case "recipeCategory":
        return `recipe ${short(change.recipeId)} ${change.deleted ? "taken out of" : "filed under"} category ${short(change.categoryId)}`;
      default:
        return "unknown change";
    }
  });
}

/**
 * Records a change made while acting as someone, under the admin, before it's made. Throws if
 * it can't be recorded, so the change isn't made either.
 */
export async function recordChange(
  env: Env,
  req: HonoRequest,
  adminUserId: string,
  targetUserId: string,
): Promise<void> {
  const path = new URL(req.url).pathname;
  if (!isWrite(req.method) || NOT_CHANGES.includes(path)) return;
  // Hono keeps the body, so the route can still read it.
  const changes = path === "/api/sync/push" ? describePush(await req.text()) : undefined;
  await recordAdminAction(
    env,
    {
      adminUserId,
      action: "impersonation.change",
      targetUserId,
      details: { request: `${req.method} ${path}`, ...(changes ? { changes } : {}) },
    },
    req.raw,
  );
}

/** The session, when it's an admin acting as someone. */
export async function impersonationOf(env: Env, request: Request) {
  const auth = await createAuth(env, request);
  const result = await auth.api.getSession({ headers: request.headers });
  return result?.session.impersonatedBy ? result : null;
}

/** Copies the cookies Better Auth set onto our own answer. */
function withCookies(response: Response, headers: Headers): Response {
  for (const cookie of headers.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}

/** POST /api/admin/accounts/:id/impersonate (behind requireAdmin, in accountRoutes). */
export async function startImpersonating(
  c: Context<{ Bindings: Env; Variables: { admin: AdminContext } }>,
) {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const body = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length < REASON_LENGTH.min || reason.length > REASON_LENGTH.max) {
    return c.json({ error: "reason_required" }, 400);
  }
  const person = await findAccount(admin.db, c.req.param("id") ?? "");
  if (!person) return c.json({ error: "not_found" }, 404);
  // Other admins can't be acted as (Better Auth refuses too).
  if (person.role === "admin") return c.json({ error: "target_is_admin" }, 403);

  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "impersonation.started",
      targetUserId: person.id,
      reason,
      details: { minutes: 30 },
    },
    c.req.raw,
  );
  const auth = await createAuth(c.env, c.req.raw);
  const { headers } = await auth.api.impersonateUser({
    body: { userId: person.id },
    headers: c.req.raw.headers,
    returnHeaders: true,
  });
  await alertOwner(
    c.env,
    "Fennl admin is acting as a user",
    [`The admin account ${admin.email} started acting as ${person.email}.`, `Reason: ${reason}`],
    c.req.raw,
  ).catch((error: unknown) => console.error("Impersonation alert not sent", error));
  return withCookies(c.json({ ok: true }), headers);
}

/**
 * POST /api/admin/impersonation/stop: back to the admin's own session. Not behind requireAdmin,
 * since the session making the request is the person's; Better Auth checks the admin's own
 * session (kept in its signed admin_session cookie) belongs to the admin who started it.
 */
export const impersonationRoutes = new Hono<{ Bindings: Env }>();

impersonationRoutes.post("/api/admin/impersonation/stop", async (c) => {
  if (!(await passedAccess(c.req.raw, c.env, accessContext(c)))) {
    return c.json({ error: "access_required" }, 403);
  }
  const acting = await impersonationOf(c.env, c.req.raw);
  if (!acting?.session.impersonatedBy) return c.json({ error: "not_impersonating" }, 400);
  const adminUserId = acting.session.impersonatedBy;
  await recordAdminAction(
    c.env,
    { adminUserId, action: "impersonation.ended", targetUserId: acting.user.id },
    c.req.raw,
  );
  const auth = await createAuth(c.env, c.req.raw);
  const { headers, response } = await auth.api.stopImpersonating({
    headers: c.req.raw.headers,
    returnHeaders: true,
  });
  // The admin was busy all along, through the person's session: their own counts as used now.
  await database(c.env.DB)
    .update(sessionTable)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessionTable.id, response.session.id));
  return withCookies(c.json({ ok: true, accountId: acting.user.id }), headers);
});
