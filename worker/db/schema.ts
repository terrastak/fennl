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
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
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
    /**
     * This browser's latest synced change: when it was made by the browser's clock, and the time
     * the server gave it, so its next change lands after it (worker/sync/clock.ts).
     */
    lastChangeAt: integer("last_change_at"),
    lastChangeTime: integer("last_change_time"),
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

/**
 * Messages sent from the app's feedback page (phase B8), read in the admin console's inbox. Kept
 * for the beta; the person who sent one can't delete it. Where a message stands follows the
 * dates (shared/feedback.ts): read when an admin first opens it, replied when they reply (or
 * mark it), done when nothing more is needed.
 */
export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    householdId: text("household_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    message: text("message").notNull(),
    /** The page they were on, for example "/settings". */
    page: text("page"),
    appVersion: text("app_version"),
    /** "Safari on iPhone", from the browser's user agent (kept too, for looking into bugs). */
    device: text("device").notNull(),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    repliedAt: integer("replied_at", { mode: "timestamp_ms" }),
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    /** A private note, only for admins. */
    note: text("note"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("feedback_created_idx").on(table.createdAt),
    index("feedback_user_idx").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------------------------
// Recipes and what hangs off them (phase C3). The shape is shared/recipe.ts; how devices send
// and fetch changes is shared/sync.ts and worker/sync/.
//
// Every row here syncs, so every row has updated_at, deleted_at (rows are never deleted while
// the account exists; deleting fills deleted_at) and server_seq. server_seq comes from the one
// sync_counter row: every accepted change takes the next number, so a device asks for "changes
// after N". field_times keeps, per field, when that field was last changed (milliseconds, in the
// server's clock): a change to a field is kept only if it was made later than the one stored
// ("last change wins", field by field).
//
// Every row carries owner_user_id: the person who owns the recipe it belongs to, which never
// changes. Devices fetch changes per owner (one cursor for each person in the household), and
// access is "the owner is in the caller's household" (CLAUDE.md, "Data model rules").
// ---------------------------------------------------------------------------------------------

/** One row: the last server_seq handed out. */
export const syncCounter = sqliteTable("sync_counter", {
  id: integer("id").primaryKey(),
  value: integer("value").notNull(),
});

/**
 * A recipe. Each field of shared/recipe.ts's RecipeContent is one column; lists and groups of
 * values (ingredients, times, source...) are JSON text.
 */
/** The columns holding a recipe's text (RECIPE_FIELDS), counted by text_bytes. */
const TEXT_COLUMNS = [
  "title",
  "description",
  "ingredients",
  "directions",
  "times",
  "servings",
  "source",
  "notes",
  "difficulty",
  "difficulty_text",
  "nutrition",
];

export const recipe = sqliteTable(
  "recipe",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** A copy kept after a household split: the recipe it was copied from (phase G1c). */
    copiedFrom: text("copied_from"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    /** JSON: IngredientLine[]. */
    ingredients: text("ingredients").notNull(),
    /** JSON: DirectionStep[]. */
    directions: text("directions").notNull(),
    /** JSON: RecipeTimes. */
    times: text("times").notNull(),
    /** JSON: RecipeServings. */
    servings: text("servings").notNull(),
    /** JSON: RecipeSource. */
    source: text("source").notNull(),
    notes: text("notes").notNull(),
    difficulty: text("difficulty"),
    difficultyText: text("difficulty_text"),
    /** JSON: RecipeNutrition, or null. */
    nutrition: text("nutrition"),
    /** JSON: RecipeImport, or null. Set when the recipe is created. */
    import: text("import"),
    /**
     * JSON: RecipeScale (shared/scale.ts), or null when shown as written (phase F1). Shared by the
     * household and kept until someone changes it back; not part of the recipe's text.
     */
    scale: text("scale"),
    /** JSON: when each field last changed, { "title": 1791331703372, ... }. */
    fieldTimes: text("field_times").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** Who last changed it (the owner or their partner). Null if that account was deleted. */
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    /** In Trash since then (phase C9). */
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    /**
     * Deleted for good (phase C9): 30 days in Trash, or Trash emptied. Its content is wiped and it
     * can't come back; the row stays so every device removes it too.
     */
    expungedAt: integer("expunged_at", { mode: "timestamp_ms" }),
    serverSeq: integer("server_seq").notNull(),
    /**
     * Bytes of recipe text (phase C11): every RECIPE_FIELDS column as stored, the way
     * recipeBytes (shared/recipe.ts) counts it; 0 once deleted for good. Worked out by the
     * database, so no write can forget it.
     */
    textBytes: integer("text_bytes").generatedAlwaysAs(
      sql`case when expunged_at is null then ${sql.raw(
        TEXT_COLUMNS.map((c) => `coalesce(length(cast(${c} as blob)), 0)`).join(" + "),
      )} else 0 end`,
      { mode: "virtual" },
    ),
  },
  (table) => [
    index("recipe_owner_seq_idx").on(table.ownerUserId, table.serverSeq),
    // A household's recipe count and text size, read from the index alone (phase C11).
    index("recipe_owner_usage_idx").on(table.ownerUserId, table.deletedAt, table.textBytes),
  ],
);

/** One person's rating, favorite and signed note on a recipe (shared/recipe.ts RecipeOpinion). */
export const recipeOpinion = sqliteTable(
  "recipe_opinion",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The recipe's owner (copied from the recipe; never changes). */
    ownerUserId: text("owner_user_id").notNull(),
    rating: integer("rating"),
    favorite: integer("favorite", { mode: "boolean" }).notNull(),
    note: text("note").notNull(),
    fieldTimes: text("field_times").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    serverSeq: integer("server_seq").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recipeId, table.userId] }),
    index("recipe_opinion_owner_seq_idx").on(table.ownerUserId, table.serverSeq),
  ],
);

/** "Made it" on a day, by someone in the household (shared/recipe.ts RecipeMade). */
export const recipeMade = sqliteTable(
  "recipe_made",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    /** Who made it. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The recipe's owner (copied from the recipe; never changes). */
    ownerUserId: text("owner_user_id").notNull(),
    /** "2026-10-03", in the person's own calendar. */
    madeOn: text("made_on").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    serverSeq: integer("server_seq").notNull(),
  },
  (table) => [
    index("recipe_made_owner_seq_idx").on(table.ownerUserId, table.serverSeq),
    index("recipe_made_recipe_idx").on(table.recipeId),
  ],
);

/**
 * A note added to a recipe in Fennl (shared/recipe.ts RecipeNote; U7): one entry, signed and dated
 * by whoever wrote it. Only its writer changes or removes it (worker/sync/push.ts).
 */
export const recipeNote = sqliteTable(
  "recipe_note",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    /** Who wrote it. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The recipe's owner (copied from the recipe; never changes). */
    ownerUserId: text("owner_user_id").notNull(),
    text: text("text").notNull(),
    /** When it was added (the change's time on the server's clock). */
    writtenAt: integer("written_at", { mode: "timestamp_ms" }).notNull(),
    /** When its words last changed after that, or null. */
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    /** When each field (text, deleted) last changed, for "last change wins". */
    fieldTimes: text("field_times").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    serverSeq: integer("server_seq").notNull(),
  },
  (table) => [
    index("recipe_note_owner_seq_idx").on(table.ownerUserId, table.serverSeq),
    index("recipe_note_recipe_idx").on(table.recipeId),
  ],
);

/**
 * A category, owned by one person (shared/recipe.ts Category). parent_id points at another of
 * the same person's categories; it isn't a database reference, so a parent and child created
 * together can arrive in either order.
 */
export const category = sqliteTable(
  "category",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    fieldTimes: text("field_times").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    serverSeq: integer("server_seq").notNull(),
  },
  (table) => [index("category_owner_seq_idx").on(table.ownerUserId, table.serverSeq)],
);

/**
 * A recipe filed in a category. The category is always one of the recipe owner's (CLAUDE.md,
 * "Recipe ownership in households"). Removing it from the category fills deleted_at.
 */
export const recipeCategory = sqliteTable(
  "recipe_category",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    /** The recipe's owner, who also owns the category. */
    ownerUserId: text("owner_user_id").notNull(),
    fieldTimes: text("field_times").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    serverSeq: integer("server_seq").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recipeId, table.categoryId] }),
    index("recipe_category_owner_seq_idx").on(table.ownerUserId, table.serverSeq),
  ],
);

/**
 * One stored photo per owner (phase D1). Photos are owned by a person and shared through their
 * household, like recipes (CLAUDE.md, "Recipe ownership in households"). A photo on a recipe is
 * owned by the recipe's owner, whoever added it (decided 2026-10-09), so it stays with the
 * recipe in a household split. The image is stored in R2 under "<owner>/<hash>" and named by its
 * content hash, so the same picture uploaded twice by one person is one row and counts once.
 *
 * A household's photo usage is the sum over its members' rows that aren't deleted, read from one
 * index (image_owner_usage_idx), as recipe usage is (worker/limits/usage.ts); there is no separate
 * counter to drift when someone joins or leaves. deleted_at is filled when a photo is removed
 * (no longer used, or after the 90-day grace period); purged_at when the housekeeping job deletes
 * its R2 objects (phase D3, worker/images/housekeeping.ts).
 */
export const image = sqliteTable(
  "image",
  {
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** SHA-256 of the file's bytes, lowercase hex. */
    hash: text("hash").notNull(),
    bytes: integer("bytes").notNull(),
    /** From the file's own bytes, never from what the browser said (shared/images.ts). */
    contentType: text("content_type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    /**
     * Size of the small copy for lists (phase D2), stored in R2 as "<owner>/<hash>.thumb", or null
     * if there isn't one. It doesn't count towards the quota (it's a few percent of the photo).
     */
    thumbBytes: integer("thumb_bytes"),
    /**
     * When the housekeeping job started deleting its R2 objects (phase D3). While that's under way
     * the same photo can't be added again (worker/images/images.ts, countImage).
     */
    purgedAt: integer("purged_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    primaryKey({ columns: [table.ownerUserId, table.hash] }),
    index("image_owner_usage_idx").on(table.ownerUserId, table.deletedAt, table.bytes),
    index("image_hash_idx").on(table.hash),
  ],
);

/**
 * A photo on a recipe (phase D2), synced like the recipe's category links. Owned by the recipe's
 * owner (owner_user_id), as is the image it shows; added_by_user_id is who added it. The first
 * photo by sort_order is the cover. role "import_original": a card or page photo kept from an
 * import (phase E), out of the gallery. Removing it fills deleted_at.
 */
export const recipePhoto = sqliteTable(
  "recipe_photo",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    /** The recipe's owner, who also owns the image. */
    ownerUserId: text("owner_user_id").notNull(),
    imageHash: text("image_hash").notNull(),
    role: text("role").notNull(),
    /** Size of the photo as stored, so a page can make room for it before it arrives. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sortOrder: real("sort_order").notNull(),
    addedByUserId: text("added_by_user_id").notNull(),
    /** When it was taken, by the camera's clock read as UTC (phase D4); null when unknown. */
    takenAt: integer("taken_at"),
    /** "fennl" or "person": who put it where it is (phase D4); null when just added. */
    arrangedBy: text("arranged_by"),
    fieldTimes: text("field_times").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    serverSeq: integer("server_seq").notNull(),
  },
  (table) => [
    index("recipe_photo_owner_seq_idx").on(table.ownerUserId, table.serverSeq),
    index("recipe_photo_recipe_idx").on(table.recipeId, table.deletedAt),
    // Whether anything still shows an image (phase D3).
    index("recipe_photo_image_idx").on(table.ownerUserId, table.imageHash, table.deletedAt),
  ],
);

/**
 * What the AI made of a recipe's photos (phase D4; shared/photoOrder.ts), kept so the same photos
 * are never sent to it twice: `photos_key` is the gallery's images, sorted; `labels` is the
 * checked answer (PhotoLabels). One row per recipe, replaced when its photos change. Removed
 * with the recipe.
 */
export const photoArrangement = sqliteTable("photo_arrangement", {
  recipeId: text("recipe_id")
    .primaryKey()
    .references(() => recipe.id, { onDelete: "cascade" }),
  photosKey: text("photos_key").notNull(),
  labels: text("labels").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * The 90-day photo grace period (phase D3; CLAUDE.md, "Lapsed subscriptions"): a person's photos
 * are in a household without photos (images_enabled), so they stay viewable and downloadable
 * until delete_after, then they're deleted. One open row per person (ended_at null); ended when
 * photos are allowed again ("premium") or once they're deleted ("deleted"). Kept afterwards as a
 * record. reminded_days: the last reminder sent, in days left (90 for the first notice).
 */
export const photoGrace = sqliteTable(
  "photo_grace",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    deleteAfter: integer("delete_after", { mode: "timestamp_ms" }).notNull(),
    remindedDays: integer("reminded_days").notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    endedReason: text("ended_reason"),
  },
  (table) => [
    uniqueIndex("photo_grace_open_idx")
      .on(table.userId)
      .where(sql`${table.endedAt} is null`),
  ],
);

/**
 * One import of one recipe (phase E1): who, when, from what, how far it got, the draft
 * (shared/importDraft.ts) and, once the person saves it, the recipe. A file with many recipes (a
 * Paprika library, a PDF of several) is one job per recipe sharing a batch_id, so each row stays
 * well under D1's size limit. The recipe records the job in its `import` (shared/recipe.ts).
 *
 * status: "reading" (the importer is working), "ready" (a draft waits for review), "saved",
 * "discarded", or "failed" (error says why).
 */
export const importJob = sqliteTable(
  "import_job",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    batchId: text("batch_id"),
    /** One of IMPORT_SOURCES (shared/recipe.ts). */
    source: text("source").notNull(),
    status: text("status").notNull(),
    /** The draft as JSON, once read. */
    draft: text("draft"),
    /** What was imported, as JSON: file names and sizes, the page's address, image hashes. */
    provenance: text("provenance").notNull(),
    error: text("error"),
    /** The recipe it became. Recipes are never hard-deleted, so no foreign key is needed. */
    recipeId: text("recipe_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("import_job_household_idx").on(table.householdId, table.createdAt),
    index("import_job_batch_idx").on(table.batchId),
    // Photo housekeeping asks whether a person's waiting drafts hold a photo (phase E9).
    index("import_job_user_status_idx").on(table.userId, table.status),
  ],
);

/**
 * Chrome extensions connected to an account (phase E5, decided 2026-10-12: "connect once"). The
 * person confirms in Fennl, and the extension gets a key of its own that can only send pages to
 * import and say who it's connected to (worker/extension/). Only a hash of the key is kept. A
 * key stops working when it's removed in Settings, unused for 90 days, or the account's password
 * changes (password_marker no longer matches).
 */
export const extensionLink = sqliteTable(
  "extension_link",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "Chrome on Mac", from the browser that connected it. */
    label: text("label").notNull(),
    /** SHA-256 of the key, as hex. The key itself is never stored. */
    keyHash: text("key_hash").notNull().unique(),
    /** A hash of the account's password hash when connected (null: no password). */
    passwordMarker: text("password_marker"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    /** Why: "removed" (Settings), "disconnected" (the extension), "unused", "password_changed". */
    revokedReason: text("revoked_reason"),
  },
  (table) => [index("extension_link_user_idx").on(table.userId)],
);

/**
 * A person's saved searches (phase C13b; shared/savedSearch.ts): a name and the recipe list's
 * address query. Their own, not shared with the household, and kept as a plain list, not as
 * synced records: they are small and rarely changed, and saving one needs a connection.
 */
export const savedSearch = sqliteTable(
  "saved_search",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The search as an address query ("q=soup&time=30"), without the "?". */
    query: text("query").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("saved_search_user_idx").on(table.userId)],
);

/**
 * Pairs of recipes a person said are not duplicates (phase C14; shared/duplicates.ts), so the
 * duplicate finder doesn't offer them again. Their own, kept with the account like saved
 * searches. The pair is stored with the smaller id first. No link to the recipes: a pair about a
 * recipe that has since gone is simply never offered.
 */
export const duplicateDismissal = sqliteTable(
  "duplicate_dismissal",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipeA: text("recipe_a").notNull(),
    recipeB: text("recipe_b").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.recipeA, table.recipeB] })],
);

/**
 * Earlier versions of recipes (phase E13, the first piece of G2's version history): the recipe as
 * it was before importing again from Paprika changed it, kept on every plan as import safety
 * (owner's choice 2026-10-21) until someone in the household chooses which version to keep. Not
 * synced records: the recipe page asks for them. `snapshot` is JSON: the RECIPE_FIELDS as they
 * were, and the importing person's rating and note (VersionSnapshot, shared/versions.ts).
 * Removed with the recipe when it's deleted for good, and with its owner's account.
 */
export const recipeVersion = sqliteTable(
  "recipe_version",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id").notNull(),
    /** The recipe's owner, so access is checked like the recipe's. */
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    snapshot: text("snapshot").notNull(),
    /** Why it was kept: "paprika_update". */
    reason: text("reason").notNull(),
    /** Who made the change that replaced it (the person importing). */
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("recipe_version_recipe_idx").on(table.recipeId)],
);

/**
 * Every call to the AI (phase E7; CLAUDE.md, "AI import"), metered per household: which model,
 * the tokens it used and what that cost, estimated from the provider's prices (worker/ai/). A
 * row is written before the call, so the monthly limits are checked in the same statement that
 * counts the call, then filled in when the answer arrives. No foreign keys: the record of what
 * was spent stays when an account is removed.
 */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    userId: text("user_id").notNull(),
    importJobId: text("import_job_id"),
    /**
     * "read" (a new import), "second_look" (the stronger model, automatically), "reread", "find"
     * (the recipes in a PDF, E12).
     */
    purpose: text("purpose").notNull(),
    /** 1 when it counts as one of the household's AI imports this month (ai_imports_per_month). */
    countsAsImport: integer("counts_as_import").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** "pending" (waiting for the answer), "ok", "refused", "cut_off", "bad_output", "failed". */
    status: text("status").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** The estimated cost in millionths of a US dollar. */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("ai_usage_household_idx").on(table.householdId, table.createdAt),
    index("ai_usage_created_idx").on(table.createdAt),
  ],
);

/**
 * How an AI-read draft turned out (decided by the owner 2026-10-19; shared/aiOutcome.ts): saved,
 * discarded or never reviewed, and, when saved, how close each model's answer was to what the
 * person kept. Only scores, never the recipe. Kept two years (worker/ai/outcomes.ts) and shown in
 * the admin console by month, quarter and year, so the stronger model's cost can be judged on
 * real imports. No foreign keys: the record stays when a draft or an account is removed.
 */
export const aiOutcome = sqliteTable(
  "ai_outcome",
  {
    id: text("id").primaryKey(),
    /** One outcome per draft. */
    importJobId: text("import_job_id").notNull().unique(),
    /** Where the recipe came from: "website", "photo", "screenshot", "pdf", "text". */
    source: text("source").notNull(),
    /** "saved", "discarded" or "expired". */
    outcome: text("outcome").notNull(),
    /** The reads in order: "read", "read+second_look", "read+second_look+reread"... */
    path: text("path").notNull(),
    /** A short fingerprint of Fennl's instructions and second-look rules at the time. */
    setup: text("setup").notNull(),
    /** JSON: each answer's model and, when saved, how close it was (shared/aiOutcome.ts). */
    reads: text("reads").notNull(),
    /** Lines the person changed, added or removed from what they were shown (saved only). */
    linesFixed: integer("lines_fixed"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("ai_outcome_decided_idx").on(table.decidedAt)],
);

/**
 * Browsers that asked for timer alerts with the phone locked (U10, owner's choices 2026-10-28;
 * worker/push/). One per person per browser (device id, as in the device registry): the address
 * the browser's push service gave it and the keys that encrypt what's sent there. Not synced
 * records: the person's own, gone with the account or when they turn alerts off.
 */
export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    /** The push service's address for this browser (Apple, Google, Mozilla or Microsoft). */
    endpoint: text("endpoint").notNull(),
    /** The browser's public key and secret for encrypting (base64url). */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.deviceId] }),
    index("push_subscription_endpoint_idx").on(table.endpoint),
  ],
);

/**
 * Timers that alert the browser that started them when they finish (U10;
 * worker/push/timerAlerts.ts). The id is the timer's own, made on the device. A delayed queue
 * message wakes the Worker at `ends_at`; +1 min moves `ends_at` (the earlier message then finds
 * it changed and does nothing), Stop sets `cancelled_at`. Removed a day after they end.
 */
export const timerAlert = sqliteTable(
  "timer_alert",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    deviceId: text("device_id").notNull(),
    /** What it's for ("Bake 25 to 30 minutes") and the recipe, shown in the alert. */
    label: text("label").notNull(),
    recipeTitle: text("recipe_title").notNull(),
    /** The page the timer was started on, which the alert opens. */
    path: text("path").notNull(),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("timer_alert_ends_idx").on(table.endsAt),
  ],
);
