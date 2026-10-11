import { Hono } from "hono";
import { isLimitKey, TIERS } from "../../shared/entitlements";
import { createCode, availableCode } from "../codes/admin";
import { database } from "../db/client";
import { limitOverride } from "../db/schema";
import { writeSetting } from "../settings/settings";

// Test setup for the browser tests (e2e/), on the local test server only. Tests used to write
// this data straight into the local database file from another process, which could find the
// app server mid-query and make it fail with "database is locked". Through here, only the app
// server ever touches the database.
//
// Open only where the dev email outbox is (local development and tests, never with real email
// set up) and only to requests addressed to localhost. It never grants the admin role: that is
// only ever a direct database command (CLAUDE.md, "Admin console"), which the tests run once,
// before anything else (e2e/auth.setup.ts).

export const testSetupRoutes = new Hono<{ Bindings: Env }>();

const LOCAL = new Set(["localhost", "127.0.0.1"]);

testSetupRoutes.post("/api/dev/test-setup", async (c) => {
  if (
    c.env.DEV_EMAIL_OUTBOX !== "true" ||
    c.env.RESEND_API_KEY ||
    !LOCAL.has(new URL(c.req.url).hostname)
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  const db = database(c.env.DB);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;

  switch (body?.kind) {
    // An invite or promo code, as the admin console makes them.
    case "code": {
      const tier = body.tier;
      if (!(TIERS as readonly unknown[]).includes(tier) || tier === "free") break;
      const until = typeof body.accessUntil === "number" ? body.accessUntil : null;
      const days = typeof body.accessDays === "number" ? body.accessDays : null;
      const code = await availableCode(db, undefined);
      if (!code) break;
      await createCode(
        db,
        {
          code,
          label: "Browser test",
          tier: tier as "individual" | "household",
          access:
            until !== null
              ? { until: new Date(until).toISOString() }
              : days !== null
                ? { days }
                : { forever: true },
          allowsSignUp: body.allowsSignUp === true,
          maxUses: null,
          redeemBy: null,
        },
        null,
      );
      return c.json({ code });
    }
    // Invite-only sign-up on or off.
    case "inviteOnly": {
      if (typeof body.on !== "boolean") break;
      await writeSetting(db, "sign_up_requires_code", body.on, null);
      return c.json({ ok: true });
    }
    // A household's own limit, as an admin sets one.
    case "limitOverride": {
      const value = body.value;
      if (
        typeof body.householdId !== "string" ||
        typeof body.key !== "string" ||
        !isLimitKey(body.key) ||
        !(value === null || typeof value === "number")
      ) {
        break;
      }
      await db
        .insert(limitOverride)
        .values({
          id: crypto.randomUUID(),
          householdId: body.householdId,
          key: body.key,
          value,
          note: "Browser test",
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [limitOverride.householdId, limitOverride.key],
          set: { value },
        });
      return c.json({ ok: true });
    }
  }
  return c.json({ error: "invalid_request" }, 400);
});
