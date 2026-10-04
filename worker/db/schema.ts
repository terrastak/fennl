/**
 * Fennl's server database tables (Cloudflare D1), defined with Drizzle.
 *
 * To change the database, edit this file and run `npm run db:generate`. That writes a new
 * migration in worker/db/migrations; commit it with the change. Never edit a migration that has
 * already been merged: write a new one instead.
 *
 * Better Auth's tables (users, sessions, sign-in accounts, verification tokens, rate limits) live
 * in ./auth-schema.ts, which `npm run auth:generate` writes from worker/auth/options.ts. Rerun it
 * after changing Better Auth's settings or version, then `npm run db:generate`.
 */
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { organization, user } from "./auth-schema";

export * from "./auth-schema";

// ---------------------------------------------------------------------------------------------
// Fennl's own tables.
// ---------------------------------------------------------------------------------------------

/**
 * Every tier limit, editable from the admin console without a deploy (CLAUDE.md, "Free").
 * Keys are listed in shared/entitlements.ts (LIMIT_KEYS). A null value means "no limit".
 * The "trial" tier holds the lower image quotas used while a paid plan is trialing.
 */
export const planLimits = sqliteTable(
  "plan_limits",
  {
    tier: text("tier").notNull(),
    key: text("key").notNull(),
    value: integer("value"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [primaryKey({ columns: [table.tier, table.key] })],
);

/** A per-household exception to one limit, which beats the tier's value until it expires. */
export const limitOverride = sqliteTable(
  "limit_override",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: integer("value"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  // One override per limit per household; also serves lookups by household.
  (table) => [uniqueIndex("limit_override_household_key_unique").on(table.householdId, table.key)],
);

/**
 * Every admin action, append-only (CLAUDE.md, "Admin console"). Database triggers (migration
 * 0006) refuse updates and deletes, and each row is also copied to the AUDIT_LOG R2 bucket under
 * a retention lock. Ids aren't foreign keys, so deleting an account never touches the log.
 */
export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id").notNull(),
  action: text("action").notNull(),
  targetUserId: text("target_user_id"),
  reason: text("reason"),
  /** JSON: what changed, plus the request's IP address, country and browser. */
  details: text("details"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
