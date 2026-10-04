import { sql } from "drizzle-orm";
import type { Database } from "./db/client";
import { rateLimit } from "./db/schema";

/**
 * A fixed-window rate limit for Fennl's own routes, stored in Better Auth's rate_limit table under
 * keys starting "fennl:" (Better Auth's own keys never do). One atomic statement counts the
 * request, so two at once can't both slip under the limit. Returns false when over the limit.
 */
export async function withinRateLimit(
  db: Database,
  key: string,
  limit: { max: number; windowMs: number },
  now = Date.now(),
): Promise<boolean> {
  const windowStart = now - limit.windowMs;
  const row = await db
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key: `fennl:${key}`, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      // last_request holds when the current window started.
      set: {
        count: sql`case when ${rateLimit.lastRequest} <= ${windowStart} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${rateLimit.lastRequest} <= ${windowStart} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count })
    .get();
  return (row?.count ?? 1) <= limit.max;
}
