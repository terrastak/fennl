import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { appSetting } from "../db/schema";

/**
 * App-wide switches, stored in app_setting so the admin console can change them without a
 * deploy. A missing row means the default below (migration 0008 also seeds it).
 */
const DEFAULTS = {
  /** Invite-only sign-up: creating an account needs a code that allows sign-up. */
  sign_up_requires_code: true,
} satisfies Record<string, boolean>;

export type SettingKey = keyof typeof DEFAULTS;

export async function readSetting(db: Database, key: SettingKey): Promise<boolean> {
  const row = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, key))
    .get();
  return row ? row.value === "true" : DEFAULTS[key];
}

export async function writeSetting(
  db: Database,
  key: SettingKey,
  value: boolean,
  updatedBy: string | null,
): Promise<void> {
  await writeText(db, key, String(value), updatedBy);
}

/**
 * Settings with other values: the AI import's money limits and models (phase E7, decided
 * 2026-10-12; worker/ai/config.ts), and what has already been emailed about them. Missing: the
 * default, kept with the code that reads it.
 */
export const TEXT_SETTINGS = [
  /** Email the owner when the AI's estimated cost this month reaches this many cents. */
  "ai_alert_cents_per_month",
  /** Pause AI imports for everyone when the AI's estimated cost this month reaches this. */
  "ai_pause_cents_per_month",
  /** The models to read with, cheapest first, comma-separated (worker/ai/config.ts). */
  "ai_models",
  /**
   * The automatic second look by the next stronger model, "on" or "off" (off unless set: the
   * owner's choice 2026-10-21, after the comparison runs showed it rarely helped).
   */
  "ai_second_look",
  /** A second look: ingredient lines without an amount that make a read look wrong (0: off). */
  "ai_second_look_missing_amounts",
  /** A second look: cups, tablespoons and the like above this look misread (0: off). */
  "ai_second_look_odd_amount",
  /** The month ("2026-10") the cost alert was last emailed, so it goes once a month. */
  "ai_alerted_month",
  /** The month the "paused" email was last sent. */
  "ai_paused_month",
] as const;

export type TextSettingKey = (typeof TEXT_SETTINGS)[number];

export async function readText(db: Database, key: TextSettingKey): Promise<string | null> {
  const row = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, key))
    .get();
  return row?.value ?? null;
}

export async function writeText(
  db: Database,
  key: SettingKey | TextSettingKey,
  value: string,
  updatedBy: string | null,
): Promise<void> {
  const row = { key, value, updatedAt: new Date(), updatedBy };
  await db.insert(appSetting).values(row).onConflictDoUpdate({ target: appSetting.key, set: row });
}

/**
 * Sets a setting only if it doesn't already hold `value`, in one statement; true when this call
 * changed it. Used to send a once-a-month email once, even when two requests notice together.
 */
export async function claimText(
  db: Database,
  key: TextSettingKey,
  value: string,
): Promise<boolean> {
  const row = { key, value, updatedAt: new Date(), updatedBy: null };
  const changed = await db
    .insert(appSetting)
    .values(row)
    .onConflictDoUpdate({
      target: appSetting.key,
      set: row,
      setWhere: sql`${appSetting.value} is not ${value}`,
    })
    .returning({ key: appSetting.key })
    .all();
  return changed.length > 0;
}
