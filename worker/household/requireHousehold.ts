import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth/auth";
import { database, type Database } from "../db/client";
import { householdForSession, type HouseholdAccess } from "./household";

export interface SignedIn {
  db: Database;
  userId: string;
  household: HouseholdAccess;
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

  const db = database(c.env.DB);
  const household = await householdForSession(
    db,
    result.user.id,
    result.session.id,
    result.session.activeOrganizationId,
  );
  c.set("signedIn", { db, userId: result.user.id, household });
  await next();
});
