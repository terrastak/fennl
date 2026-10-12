import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { deviceLabel } from "../../shared/devices";
import {
  isExtensionKey,
  type ExtensionLinkCreated,
  type ExtensionLinkSummary,
  type ExtensionMe,
} from "../../shared/extension";
import { database, type Database } from "../db/client";
import { user } from "../db/schema";
import { householdEntitlements } from "../entitlements/entitlements";
import { activeHouseholdFor, membershipRole, type HouseholdAccess } from "../household/household";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import { createLink, linkForKey, listLinks, removeLink } from "./links";

// The Chrome extension's connection to an account (phase E5; CLAUDE.md, "Import sources").
// Connecting happens in Fennl, signed in as usual: the person confirms, and the extension gets
// a key of its own (worker/extension/links.ts). The key only works on the extension's routes
// here, and on sending pages to import (E6); never on recipes, sync or the account.

type SessionEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

/** The caller of a route the extension uses, from its key. */
export interface ExtensionCaller {
  db: Database;
  userId: string;
  household: HouseholdAccess;
  linkId: string;
}

type ExtensionEnv = { Bindings: Env; Variables: { extension: ExtensionCaller } };

/** Connections made per person per hour: a guard against abuse. */
const CONNECTS_PER_HOUR = 20;

/**
 * For routes the extension calls: "Authorization: Bearer <key>". Answers 401 when the key is
 * missing, unknown, removed or expired; the extension then offers to connect again.
 */
export const requireExtension = createMiddleware<ExtensionEnv>(async (c, next) => {
  const key = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (!isExtensionKey(key)) return c.json({ error: "not_connected" }, 401);
  const db = database(c.env.DB);
  const link = await linkForKey(db, key);
  if (!link) return c.json({ error: "not_connected" }, 401);
  const person = await db
    .select({ mustChangePassword: user.mustChangePassword })
    .from(user)
    .where(eq(user.id, link.userId))
    .get();
  if (!person) return c.json({ error: "not_connected" }, 401);
  // A temporary password from support must be replaced in Fennl first (phase B7).
  if (person.mustChangePassword) return c.json({ error: "password_change_required" }, 403);
  const householdId = await activeHouseholdFor(db, link.userId);
  const role = await membershipRole(db, link.userId, householdId);
  if (!role) return c.json({ error: "not_connected" }, 401);
  c.set("extension", {
    db,
    userId: link.userId,
    household: { householdId, role },
    linkId: link.id,
  });
  await next();
});

// --- From Fennl itself (a signed-in session) ---------------------------------------------------

export const extensionLinkRoutes = new Hono<SessionEnv>();

extensionLinkRoutes.use("/api/extension/links", requireHousehold);
extensionLinkRoutes.use("/api/extension/links/*", requireHousehold);

// POST /api/extension/links: connect an extension (the connect page, after the person confirms).
// Refused while an admin acts as someone (worker/admin/impersonation.ts): a key would outlive it.
extensionLinkRoutes.post("/api/extension/links", async (c) => {
  const { db, userId } = c.var.signedIn;
  if (
    !(await withinRateLimit(db, `extension-connect:${userId}`, {
      max: CONNECTS_PER_HOUR,
      windowMs: 60 * 60_000,
    }))
  ) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const result = await createLink(db, userId, deviceLabel(c.req.header("user-agent")));
  if ("error" in result) return c.json(result, 409);
  const created: ExtensionLinkCreated = result;
  return c.json(created, 201);
});

// GET /api/extension/links: the person's connected extensions, for Settings.
extensionLinkRoutes.get("/api/extension/links", async (c) => {
  const { db, userId } = c.var.signedIn;
  const links: ExtensionLinkSummary[] = await listLinks(db, userId);
  return c.json({ links });
});

// POST /api/extension/links/:id/remove: disconnect one (Settings, or the connect page taking
// back a key no extension picked up).
extensionLinkRoutes.post("/api/extension/links/:id/remove", async (c) => {
  const { db, userId } = c.var.signedIn;
  const removed = await removeLink(db, userId, c.req.param("id"), "removed");
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// --- From the extension (its key) ---------------------------------------------------------------

export const extensionRoutes = new Hono<ExtensionEnv>();

extensionRoutes.use("/api/extension/me", requireExtension);
extensionRoutes.use("/api/extension/disconnect", requireExtension);

// GET /api/extension/me: who it's connected to, and what the plan lets it import.
extensionRoutes.get("/api/extension/me", async (c) => {
  const { db, userId, household } = c.var.extension;
  const [person, plan] = await Promise.all([
    db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).get(),
    householdEntitlements(db, household.householdId),
  ]);
  if (!person) return c.json({ error: "not_connected" }, 401);
  const me: ExtensionMe = {
    name: person.name,
    email: person.email,
    tier: plan.tier,
    importPages: plan.import_structured_enabled,
    importWithAi: plan.import_ai_enabled,
    photos: plan.images_enabled,
  };
  return c.json(me);
});

// POST /api/extension/disconnect: the extension's own "Disconnect" button.
extensionRoutes.post("/api/extension/disconnect", async (c) => {
  const { db, userId, linkId } = c.var.extension;
  await removeLink(db, userId, linkId, "disconnected");
  return c.json({ ok: true });
});
