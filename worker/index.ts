import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { isColorScheme } from "../shared/appearance";
import { healthStatus } from "../shared/health";
import { createAuth, signInMethods } from "./auth/auth";
import { database, databaseStatus } from "./db/client";
import { user } from "./db/schema";
import { devOutbox } from "./email/outbox";
import { householdSummary } from "./household/household";
import { requireHousehold } from "./household/requireHousehold";

// Only /api/* reaches this Worker (see run_worker_first in wrangler.jsonc).
// Everything else is served from the built single-page app.
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const health = healthStatus(await databaseStatus(database(c.env.DB)));
  return c.json(health, health.status === "ok" ? 200 : 503);
});

// Better Auth's household (organization) endpoints stay closed until sharing is built (phase G1):
// people must not create, delete, rename or switch households on their own.
app.all("/api/auth/organization/*", (c) => c.json({ error: "not_found" }, 404));

// Sign-up, sign-in, sign-out, sessions, email verification and password reset (Better Auth).
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = await createAuth(c.env, c.req.raw);
  return auth.handler(c.req.raw);
});

// Which sign-in buttons the app should show on this deployment.
app.get("/api/sign-in-methods", (c) => c.json(signInMethods(c.env)));

// The caller's household, for the Account page.
app.get("/api/household", requireHousehold, async (c) => {
  const { db, userId, household } = c.var.signedIn;
  return c.json(await householdSummary(db, household, userId));
});

// The account's color scheme, which follows the person to every device.
app.put("/api/account/appearance", requireHousehold, async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  const colorScheme = (body as { colorScheme?: unknown } | null)?.colorScheme;
  if (!isColorScheme(colorScheme)) return c.json({ error: "invalid_color_scheme" }, 400);
  const { db, userId } = c.var.signedIn;
  await db.update(user).set({ colorScheme }).where(eq(user.id, userId));
  return c.json({ colorScheme });
});

// Local development and tests only: emails that would have been sent.
app.get("/api/dev/outbox", (c) => {
  if (c.env.DEV_EMAIL_OUTBOX !== "true" || c.env.RESEND_API_KEY) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(devOutbox.list(c.req.query("to")));
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
