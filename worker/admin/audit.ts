import { desc } from "drizzle-orm";
import { database } from "../db/client";
import { adminAuditLog } from "../db/schema";

export interface AuditEntry {
  adminUserId: string;
  /** What happened, for example "admin.sign_in". */
  action: string;
  targetUserId?: string | undefined;
  reason?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

/** Where a request came from, for the log. Cloudflare sets these headers; clients can't. */
function requestDetails(request: Request | undefined) {
  if (!request) return {};
  return {
    ip: request.headers.get("cf-connecting-ip"),
    country: request.headers.get("cf-ipcountry"),
    userAgent: request.headers.get("user-agent"),
    host: new URL(request.url).hostname,
  };
}

/**
 * Records an admin action in admin_audit_log and, at the same time, as a write-once object in
 * the AUDIT_LOG bucket. If either write fails this throws, so callers that change anything
 * should record first and act second: no record, no action.
 */
export async function recordAdminAction(
  env: Env,
  entry: AuditEntry,
  request?: Request,
): Promise<void> {
  const createdAt = new Date();
  const row = {
    id: crypto.randomUUID(),
    adminUserId: entry.adminUserId,
    action: entry.action,
    targetUserId: entry.targetUserId ?? null,
    reason: entry.reason ?? null,
    details: JSON.stringify({ ...entry.details, ...requestDetails(request) }),
    createdAt,
  };
  const day = createdAt.toISOString().slice(0, 10).replace(/-/g, "/");
  const key = `audit/${day}/${createdAt.toISOString()}-${row.id}.json`;
  await Promise.all([
    database(env.DB).insert(adminAuditLog).values(row),
    env.AUDIT_LOG.put(key, JSON.stringify({ ...row, createdAt: createdAt.toISOString() }), {
      httpMetadata: { contentType: "application/json" },
    }),
  ]);
}

export async function recentAdminActions(env: Env, limit = 50) {
  return database(env.DB)
    .select()
    .from(adminAuditLog)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(limit)
    .all();
}
