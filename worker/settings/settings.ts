import { eq } from "drizzle-orm";
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
  const row = { key, value: String(value), updatedAt: new Date(), updatedBy };
  await db.insert(appSetting).values(row).onConflictDoUpdate({ target: appSetting.key, set: row });
}
