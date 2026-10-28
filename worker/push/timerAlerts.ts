import { and, eq, isNull, lt } from "drizzle-orm";
import { timerPush } from "../../shared/timerAlerts";
import { database, type Database } from "../db/client";
import { pushSubscription, timerAlert } from "../db/schema";
import { pushKey, sendPush } from "./webPush";

// Sending timer alerts when they're due (U8). Starting a timer puts a message on the
// TIMER_ALERTS queue (wrangler.jsonc), delayed until the timer ends; the queue then hands it to
// this Worker's queue handler, which sends the push. A message carries the end time it was made
// for, so one from before a +1 min, or for a timer since stopped, finds nothing to do.

/** A queue message: which timer, and the end time it's for. */
export interface TimerAlertMessage {
  userId: string;
  timerId: string;
  endsAt: number;
  /** Fennl's address, which the push service is told as whom to contact. */
  origin: string;
}

/** The longest a queue message can wait (Cloudflare Queues: 24 hours). */
const MAX_DELAY_SECONDS = 24 * 60 * 60;
/** A message that arrives this early is close enough: the alert goes now. */
const EARLY_ENOUGH_MS = 2_000;
/** How long the push service keeps trying to reach a phone that's off or out of signal. */
const ALERT_TTL_SECONDS = 10 * 60;

export async function scheduleTimerAlert(
  env: Env,
  message: TimerAlertMessage,
  now = Date.now(),
): Promise<void> {
  const delaySeconds = Math.min(
    MAX_DELAY_SECONDS,
    Math.max(0, Math.ceil((message.endsAt - now) / 1000)),
  );
  await env.TIMER_ALERTS.send(message, { delaySeconds });
}

/** "sent", or why not. */
export type AlertOutcome = "sent" | "not_due" | "nothing_to_send" | "no_browser" | "failed";

/** One queue message: send the alert if the timer still ends then. */
export async function deliverTimerAlert(
  env: Env,
  message: TimerAlertMessage,
  now = Date.now(),
): Promise<AlertOutcome> {
  // Longer than a queue message can wait: wait again for the rest.
  if (message.endsAt - now > EARLY_ENOUGH_MS) {
    await scheduleTimerAlert(env, message, now);
    return "not_due";
  }
  const db = database(env.DB);
  // Claimed in one statement, so a message sent twice for the same end can't alert twice.
  const claimed = await db
    .update(timerAlert)
    .set({ sentAt: new Date(now) })
    .where(
      and(
        eq(timerAlert.userId, message.userId),
        eq(timerAlert.id, message.timerId),
        eq(timerAlert.endsAt, new Date(message.endsAt)),
        isNull(timerAlert.sentAt),
        isNull(timerAlert.cancelledAt),
      ),
    )
    .returning()
    .get();
  if (!claimed) return "nothing_to_send";

  const browser = await db
    .select()
    .from(pushSubscription)
    .where(
      and(
        eq(pushSubscription.userId, message.userId),
        eq(pushSubscription.deviceId, claimed.deviceId),
      ),
    )
    .get();
  const key = await pushKey(env.PUSH_PRIVATE_KEY);
  if (!browser || !key) return "no_browser";

  const subject = message.origin.startsWith("https:") ? message.origin : "mailto:dev@localhost";
  const result = await sendPush(browser, timerPush(claimed.id, claimed), key, subject, {
    ttlSeconds: ALERT_TTL_SECONDS,
  });
  if (result === "gone") {
    // The browser turned alerts off, or its subscription ended: forget it.
    await db
      .delete(pushSubscription)
      .where(
        and(
          eq(pushSubscription.userId, browser.userId),
          eq(pushSubscription.deviceId, browser.deviceId),
          eq(pushSubscription.endpoint, browser.endpoint),
        ),
      );
    return "no_browser";
  }
  if (result === "failed") {
    // Not sent: free it for the retry.
    await db
      .update(timerAlert)
      .set({ sentAt: null })
      .where(and(eq(timerAlert.userId, claimed.userId), eq(timerAlert.id, claimed.id)));
    return "failed";
  }
  return "sent";
}

/** The queue handler: each message on its own; a failed send is tried again a few seconds on. */
export async function deliverTimerAlerts(
  batch: MessageBatch<TimerAlertMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const outcome = await deliverTimerAlert(env, message.body);
      if (outcome === "failed") message.retry({ delaySeconds: 3 });
      else message.ack();
    } catch (error) {
      console.error("Couldn't send a timer alert", error);
      message.retry({ delaySeconds: 3 });
    }
  }
}

/** Alerts a day past their end are of no more use (the hourly job). */
export async function removeOldTimerAlerts(db: Database, now = Date.now()): Promise<number> {
  const removed = await db
    .delete(timerAlert)
    .where(lt(timerAlert.endsAt, new Date(now - 24 * 60 * 60 * 1000)))
    .returning({ id: timerAlert.id })
    .all();
  return removed.length;
}
