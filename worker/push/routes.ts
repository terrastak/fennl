import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  cleanSubscription,
  cleanTimerAlert,
  isTimerId,
  MAX_WAITING_ALERTS,
} from "../../shared/timerAlerts";
import { isDeviceId } from "../../shared/devices";
import type { Database } from "../db/client";
import { device, pushSubscription, timerAlert } from "../db/schema";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import { scheduleTimerAlert } from "./timerAlerts";
import { pushKey } from "./webPush";

// Timer alerts with the phone locked (U10, owner's choices 2026-10-28). Every plan. A browser
// subscribes once (Settings › Timer alerts, or the Timers window), then each timer tells the
// server when it ends, and only the browser that started it gets the alert. The person's own
// rows only; never while an admin acts as someone (it isn't their device).

type SessionEnv = { Bindings: Env; Variables: { signedIn: SignedIn } };

export const pushRoutes = new Hono<SessionEnv>();

/** Changes per person per minute: starting, +1 min and stopping timers, with room to spare. */
const CHANGES_PER_MINUTE = 120;

pushRoutes.use("/api/push/*", requireHousehold);

/** Whether this is one of the caller's browsers, still signed in. */
async function ownDevice(db: Database, userId: string, deviceId: string): Promise<boolean> {
  const row = await db
    .select({ revokedAt: device.revokedAt })
    .from(device)
    .where(and(eq(device.userId, userId), eq(device.id, deviceId)))
    .get();
  return Boolean(row && !row.revokedAt);
}

async function withinLimit(signedIn: SignedIn): Promise<boolean> {
  return withinRateLimit(signedIn.db, `push:${signedIn.userId}`, {
    max: CHANGES_PER_MINUTE,
    windowMs: 60_000,
  });
}

/** The key browsers subscribe with; null when alerts aren't set up on this server. */
pushRoutes.get("/api/push/key", async (c) => {
  const key = await pushKey(c.env.PUSH_PRIVATE_KEY);
  return c.json({ key: key?.publicKey ?? null });
});

pushRoutes.put("/api/push/subscription", async (c) => {
  const signedIn = c.var.signedIn;
  if (signedIn.impersonating) return c.json({ error: "not_while_impersonating" }, 403);
  if (!(await withinLimit(signedIn))) return c.json({ error: "rate_limited" }, 429);
  const body = cleanSubscription(await c.req.json<unknown>().catch(() => null));
  if (!body) return c.json({ error: "invalid_request" }, 400);
  const { db, userId } = signedIn;
  if (!(await ownDevice(db, userId, body.deviceId))) {
    return c.json({ error: "device_not_registered" }, 403);
  }
  const now = new Date();
  await db.batch([
    // A browser has one address; if someone else signed in here before, it's theirs no more.
    db
      .delete(pushSubscription)
      .where(
        and(
          eq(pushSubscription.endpoint, body.endpoint),
          sql`not (${pushSubscription.userId} = ${userId} and ${pushSubscription.deviceId} = ${body.deviceId})`,
        ),
      ),
    db
      .insert(pushSubscription)
      .values({
        userId,
        deviceId: body.deviceId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [pushSubscription.userId, pushSubscription.deviceId],
        set: {
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          updatedAt: now,
        },
      }),
  ]);
  return c.json({ ok: true });
});

/** Alerts turned off on this browser. */
pushRoutes.delete("/api/push/subscription", async (c) => {
  const signedIn = c.var.signedIn;
  if (signedIn.impersonating) return c.json({ error: "not_while_impersonating" }, 403);
  const deviceId = c.req.query("deviceId");
  if (!isDeviceId(deviceId)) return c.json({ error: "invalid_request" }, 400);
  await signedIn.db
    .delete(pushSubscription)
    .where(
      and(eq(pushSubscription.userId, signedIn.userId), eq(pushSubscription.deviceId, deviceId)),
    );
  return c.json({ ok: true });
});

/** Whether this browser gets alerts, as the server sees it (Settings shows it). */
pushRoutes.get("/api/push/subscription", async (c) => {
  const signedIn = c.var.signedIn;
  const deviceId = c.req.query("deviceId");
  if (!isDeviceId(deviceId)) return c.json({ error: "invalid_request" }, 400);
  const row = await signedIn.db
    .select({ endpoint: pushSubscription.endpoint })
    .from(pushSubscription)
    .where(
      and(eq(pushSubscription.userId, signedIn.userId), eq(pushSubscription.deviceId, deviceId)),
    )
    .get();
  return c.json({ endpoint: row?.endpoint ?? null });
});

/** A timer started, or given another minute: alert this browser when it ends. */
pushRoutes.put("/api/push/timers/:id", async (c) => {
  const signedIn = c.var.signedIn;
  if (signedIn.impersonating) return c.json({ error: "not_while_impersonating" }, 403);
  const id = c.req.param("id");
  if (!isTimerId(id)) return c.json({ error: "invalid_request" }, 400);
  if (!(await withinLimit(signedIn))) return c.json({ error: "rate_limited" }, 429);
  const body = cleanTimerAlert(await c.req.json<unknown>().catch(() => null));
  if (!body) return c.json({ error: "invalid_request" }, 400);
  const { db, userId } = signedIn;

  const subscribed = await db
    .select({ deviceId: pushSubscription.deviceId })
    .from(pushSubscription)
    .where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.deviceId, body.deviceId)))
    .get();
  if (!subscribed) return c.json({ error: "not_subscribed" }, 409);

  const now = new Date();
  const waiting = await db
    .select({ count: sql<number>`count(*)` })
    .from(timerAlert)
    .where(
      and(
        eq(timerAlert.userId, userId),
        ne(timerAlert.id, id),
        isNull(timerAlert.sentAt),
        isNull(timerAlert.cancelledAt),
        gt(timerAlert.endsAt, now),
      ),
    )
    .get();
  if ((waiting?.count ?? 0) >= MAX_WAITING_ALERTS) return c.json({ error: "too_many" }, 429);

  const endsAt = new Date(body.endsAt);
  await db
    .insert(timerAlert)
    .values({ userId, id, ...body, endsAt, createdAt: now })
    .onConflictDoUpdate({
      target: [timerAlert.userId, timerAlert.id],
      set: {
        deviceId: body.deviceId,
        label: body.label,
        recipeTitle: body.recipeTitle,
        path: body.path,
        endsAt,
        sentAt: null,
        cancelledAt: null,
      },
    });
  await scheduleTimerAlert(c.env, {
    userId,
    timerId: id,
    endsAt: body.endsAt,
    origin: new URL(c.req.url).origin,
  });
  return c.json({ ok: true });
});

/** A timer stopped or dismissed: no alert. */
pushRoutes.delete("/api/push/timers/:id", async (c) => {
  const signedIn = c.var.signedIn;
  if (signedIn.impersonating) return c.json({ error: "not_while_impersonating" }, 403);
  const id = c.req.param("id");
  if (!isTimerId(id)) return c.json({ error: "invalid_request" }, 400);
  if (!(await withinLimit(signedIn))) return c.json({ error: "rate_limited" }, 429);
  await signedIn.db
    .update(timerAlert)
    .set({ cancelledAt: new Date() })
    .where(and(eq(timerAlert.userId, signedIn.userId), eq(timerAlert.id, id)));
  return c.json({ ok: true });
});
