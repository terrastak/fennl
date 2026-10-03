import { Hono } from "hono";
import { healthStatus } from "../shared/health";
import { createAuth, signInMethods } from "./auth/auth";
import { database, databaseStatus } from "./db/client";
import { devOutbox } from "./email/outbox";

// Only /api/* reaches this Worker (see run_worker_first in wrangler.jsonc).
// Everything else is served from the built single-page app.
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const health = healthStatus(await databaseStatus(database(c.env.DB)));
  return c.json(health, health.status === "ok" ? 200 : 503);
});

// Sign-up, sign-in, sign-out, sessions, email verification and password reset (Better Auth).
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = await createAuth(c.env, c.req.raw);
  return auth.handler(c.req.raw);
});

// Which sign-in buttons the app should show on this deployment.
app.get("/api/sign-in-methods", (c) => c.json(signInMethods(c.env)));

// Local development and tests only: emails that would have been sent.
app.get("/api/dev/outbox", (c) => {
  if (c.env.DEV_EMAIL_OUTBOX !== "true" || c.env.RESEND_API_KEY) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(devOutbox.list(c.req.query("to")));
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
