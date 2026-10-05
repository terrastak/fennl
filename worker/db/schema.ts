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
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
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

/**
 * Codes that give a household free Premium (phase B5): beta invites and promo codes. A code gives
 * Premium until a set date (access_until; everyone who used it keeps Premium until then, and
 * moving the date moves it for all of them), for a number of days from when each person uses it
 * (access_days), or with no end date (neither set). At most one of the two is set. Codes are
 * never deleted, only disabled.
 * Discounts on the price are Stripe promotion codes, not these (Stage I).
 */
export const promoCode = sqliteTable("promo_code", {
  id: text("id").primaryKey(),
  /** What people type, stored in capitals. Matching ignores case and spaces. */
  code: text("code").notNull().unique(),
  /** The admin's own name for it, for example "Beta testers, first wave". */
  label: text("label").notNull(),
  /** "individual" or "household". */
  tier: text("tier").notNull(),
  accessUntil: integer("access_until", { mode: "timestamp_ms" }),
  accessDays: integer("access_days"),
  /** Whether the code lets someone create an account while sign-up is invite-only. */
  allowsSignUp: integer("allows_sign_up", { mode: "boolean" }).notNull(),
  /** How many people may use it (null: no limit), and how many have. */
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  /** The last moment it can be used (null: no deadline). */
  redeemBy: integer("redeem_by", { mode: "timestamp_ms" }),
  disabledAt: integer("disabled_at", { mode: "timestamp_ms" }),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Premium a household got from a code: one row each time someone uses one. The entitlement
 * service reads these (worker/entitlements). ends_at is null for "until a date" codes, whose end
 * is always the code's current access_until, and for codes with no end date.
 */
export const premiumGrant = sqliteTable(
  "premium_grant",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Who used the code. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    promoCodeId: text("promo_code_id")
      .notNull()
      .references(() => promoCode.id),
    tier: text("tier").notNull(),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }),
    /** Set when an admin ends it early (disabling a code and ending its access). */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    // Each person can use a given code once.
    uniqueIndex("premium_grant_user_code_unique").on(table.userId, table.promoCodeId),
    index("premium_grant_household_idx").on(table.householdId),
    index("premium_grant_code_idx").on(table.promoCodeId),
  ],
);

/**
 * App-wide switches the admin console can change without a deploy. Keys and their defaults are in
 * worker/settings/settings.ts.
 */
export const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});
