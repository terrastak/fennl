import { Hono } from "hono";
import { isFeedbackFilter } from "../../shared/feedback";
import { recordAdminAction } from "../admin/audit";
import { requireAdmin, type AdminContext } from "../admin/requireAdmin";
import { requireHousehold } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import {
  changeFeedback,
  feedbackInbox,
  findFeedback,
  markRead,
  parseChange,
  parseFeedback,
  saveFeedback,
} from "./feedback";

// Feedback (phase B8): sending it from the app, and the admin console's inbox.

export const feedbackRoutes = new Hono<{ Bindings: Env }>();

/** Up to 10 messages an hour per person: plenty for testers, and a cap on floods. */
const SEND_LIMIT = { max: 10, windowMs: 60 * 60_000 };

feedbackRoutes.post("/api/feedback", requireHousehold, async (c) => {
  const { db, userId, household, impersonating } = c.var.signedIn;
  // An admin acting as someone shouldn't speak for them.
  if (impersonating) return c.json({ error: "not_while_impersonating" }, 403);
  const input = parseFeedback(await c.req.json().catch(() => null));
  if (!input) return c.json({ error: "invalid_message" }, 400);
  if (!(await withinRateLimit(db, `feedback:${userId}`, SEND_LIMIT))) {
    return c.json({ error: "too_many" }, 429);
  }
  await saveFeedback(
    db,
    { userId, householdId: household.householdId, userAgent: c.req.header("user-agent") ?? null },
    input,
  );
  return c.json({ ok: true });
});

export const adminFeedbackRoutes = new Hono<{
  Bindings: Env;
  Variables: { admin: AdminContext };
}>();

adminFeedbackRoutes.use("*", requireAdmin);

/** The inbox: ?status=new|read|replied|done|all (default new), with each status's count. */
adminFeedbackRoutes.get("/feedback", async (c) => {
  const status = c.req.query("status") ?? "new";
  if (!isFeedbackFilter(status)) return c.json({ error: "invalid_status" }, 400);
  return c.json(await feedbackInbox(c.var.admin.db, status));
});

/** Opening a message marks it read, once (recorded in the audit log). */
adminFeedbackRoutes.post("/feedback/:id/read", async (c) => {
  const admin = c.var.admin;
  const item = await findFeedback(admin.db, c.req.param("id"));
  if (!item) return c.json({ error: "not_found" }, 404);
  if (!item.readAt) {
    await recordAdminAction(
      c.env,
      {
        adminUserId: admin.userId,
        action: "feedback.read",
        targetUserId: item.sender?.id,
        details: { feedbackId: item.id },
      },
      c.req.raw,
    );
    await markRead(admin.db, item.id);
  }
  return c.json(await findFeedback(admin.db, item.id));
});

/** Replied (or undo), done (or back to the inbox), and the private note. */
adminFeedbackRoutes.patch("/feedback/:id", async (c) => {
  const admin = c.var.admin;
  const change = parseChange(await c.req.json().catch(() => null));
  if (!change) return c.json({ error: "invalid_change" }, 400);
  const item = await findFeedback(admin.db, c.req.param("id"));
  if (!item) return c.json({ error: "not_found" }, 404);
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "feedback.updated",
      targetUserId: item.sender?.id,
      details: {
        feedbackId: item.id,
        ...(change.replied !== undefined ? { replied: change.replied } : {}),
        ...(change.done !== undefined ? { done: change.done } : {}),
        ...(change.note !== undefined ? { noteChanged: true } : {}),
      },
    },
    c.req.raw,
  );
  await changeFeedback(admin.db, item.id, change);
  return c.json(await findFeedback(admin.db, item.id));
});
