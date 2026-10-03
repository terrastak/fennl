import { Hono } from "hono";
import { healthStatus } from "../shared/health";
import { database, databaseStatus } from "./db/client";

// Only /api/* reaches this Worker (see run_worker_first in wrangler.jsonc).
// Everything else is served from the built single-page app.
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const health = healthStatus(await databaseStatus(database(c.env.DB)));
  return c.json(health, health.status === "ok" ? 200 : 503);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
