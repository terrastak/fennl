import { Hono } from "hono";
import { readCapped } from "../body";
import { database } from "../db/client";
import { applyEmailEvent, type EmailEvent } from "./events";
import { verifyWebhook } from "./webhook";

/** Resend's events are small; anything bigger isn't one. */
const MAX_EVENT_BYTES = 256 * 1024;

/**
 * POST /api/email/events (phase U14): Resend says what happened to an email (delivered, delayed,
 * bounced, marked as spam, blocked or failed). No session: the signature (./webhook.ts) is the
 * check, made before the body is read as JSON. Every signed request is answered 200, events
 * Fennl ignores included, so Resend doesn't keep retrying them.
 */
export const emailRoutes = new Hono<{ Bindings: Env }>();

emailRoutes.post("/api/email/events", async (c) => {
  const secret = c.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "not_configured" }, 404);
  const bytes = await readCapped(c.req.raw, MAX_EVENT_BYTES);
  if (!bytes) return c.json({ error: "too_large" }, 413);
  const body = new TextDecoder().decode(bytes);
  const check = await verifyWebhook(secret, c.req.raw.headers, body);
  if (check !== "ok") return c.json({ error: "unauthorized" }, 401);

  let event: EmailEvent;
  try {
    event = JSON.parse(body) as EmailEvent;
  } catch {
    return c.json({ ok: true });
  }
  if (!event || typeof event !== "object") return c.json({ ok: true });
  // A failure here is answered with an error, so Resend sends the event again later.
  await applyEmailEvent(database(c.env.DB), event);
  return c.json({ ok: true });
});
