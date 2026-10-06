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

/**
 * The browsers someone uses Fennl in (phase B6). A device is a browser profile, not a physical
 * device: the app makes a random ID on first run and keeps it in the browser's storage, so a
 * private window or cleared site data is a new device (CLAUDE.md, "Tables"). The household's
 * max_devices entitlement caps how many are active at once; revoked rows are kept for history.
 */
export const device = sqliteTable(
  "device",
  {
    /** Made by the browser. Unique per person (two accounts can share one browser). */
    id: text("id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    householdId: text("household_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** "Safari on iPhone", from the browser's user agent. */
    label: text("label").notNull(),
    /** The sign-in session this browser last used, so signing the device out can end it. */
    sessionId: text("session_id"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    /** Why: "taken_over", "signed_out" (from the device list) or "replaced" (same browser, new ID). */
    revokedReason: text("revoked_reason"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("device_household_idx").on(table.householdId),
    index("device_session_idx").on(table.sessionId),
  ],
);

/**
 * Every change to an account's email address (phase B7a), kept so support can see the history and
 * put back an earlier address after a takeover. A change waits for the link sent to the new
 * address (token_hash, until expires_at); the address changes only when it's opened. Restores by
 * an admin take effect at once and have no token. Never deleted while the account exists.
 */
export const emailChange = sqliteTable(
  "email_change",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "change" (waits for the new address to be verified) or "restore" (by an admin, at once). */
    kind: text("kind").notNull(),
    oldEmail: text("old_email").notNull(),
    /** When the old address had been verified, so a restore can put that date back. */
    oldEmailVerifiedAt: integer("old_email_verified_at", { mode: "timestamp_ms" }),
    newEmail: text("new_email").notNull(),
    /** The admin who started it; null when the person did it themselves. */
    adminUserId: text("admin_user_id"),
    /** SHA-256 of the link's secret. The secret itself is only ever in the email. */
    tokenHash: text("token_hash").unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    /** When the new address took effect. */
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    /** When a newer request, a restore or a cancel replaced this one before it was used. */
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("email_change_user_idx").on(table.userId)],
);
