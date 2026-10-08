import { createMiddleware } from "hono/factory";
import { recordChange, refusedWhileImpersonating } from "../admin/impersonation";
import { createAuth } from "../auth/auth";
import { database, type Database } from "../db/client";
import { householdForSession, type HouseholdAccess } from "./household";

export interface SignedIn {
  db: Database;
  userId: string;
  household: HouseholdAccess;
  /** The sign-in session making this request. */
  sessionId: string;
  /**
   * An admin is acting as this person (phase C12): it never registers as a device, saves go
   * straight to the server, and every change is in the admin log.
   */
  impersonating: boolean;
}

/**
 * For API routes that need a signed-in person: answers 401 without a session, and otherwise
 * gives the route the caller's household (checked by householdForSession) as c.var.signedIn.
 * Every route that reads or writes household data goes through this.
 */
export const requireHousehold = createMiddleware<{
  Bindings: Env;
  Variables: { signedIn: SignedIn };
}>(async (c, next) => {
  const auth = await createAuth(c.env, c.req.raw);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) return c.json({ error: "unauthorized" }, 401);
  const actingAdmin = result.session.impersonatedBy;
  // A temporary password from support must be replaced before anything else (phase B7), by the
  // person: an admin acting as them can still look around.
  if (result.user.mustChangePassword && !actingAdmin) {
    return c.json({ error: "password_change_required" }, 403);
  }
  if (actingAdmin) {
    // Phase C12: some things are for the console's own tools; every other change is recorded
    // under the admin first (no record, no change).
    if (refusedWhileImpersonating(c.req.method, new URL(c.req.url).pathname)) {
      return c.json({ error: "not_while_impersonating" }, 403);
    }
    try {
      await recordChange(c.env, c.req, actingAdmin, result.user.id);
    } catch (error) {
      console.error("Couldn't record a change made while acting as someone", error);
      return c.json({ error: "not_recorded" }, 503);
    }
  }

  const db = database(c.env.DB);
  const household = await householdForSession(
    db,
    result.user.id,
    result.session.id,
    result.session.activeOrganizationId,
  );
  c.set("signedIn", {
    db,
    userId: result.user.id,
    household,
    sessionId: result.session.id,
    impersonating: Boolean(actingAdmin),
  });
  await next();
});
