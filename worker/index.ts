import { Hono } from "hono";
import { healthStatus } from "../shared/health";

// Only /api/* reaches this Worker (see run_worker_first in wrangler.jsonc).
// Everything else is served from the built single-page app.
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json(healthStatus()));

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
