-- Photo limits decided 2026-10-08 (spec.md D1), replacing the placeholders seeded in 0004.
-- Individual 5 GB / 15,000 photos, Household 10 GB / 30,000, trial 500 MB / 2,000, and 5 MB per
-- stored photo. Each row changes only while it still holds its old placeholder value, so a limit
-- an admin has already edited in the console is left alone.
UPDATE `plan_limits` SET `value` = 5368709120, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `tier` = 'individual' AND `key` = 'image_quota_bytes' AND `value` = 2147483648;--> statement-breakpoint
UPDATE `plan_limits` SET `value` = 15000, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `tier` = 'individual' AND `key` = 'image_quota_count' AND `value` = 5000;--> statement-breakpoint
UPDATE `plan_limits` SET `value` = 5242880, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `tier` = 'individual' AND `key` = 'image_max_file_bytes' AND `value` = 10485760;--> statement-breakpoint
UPDATE `plan_limits` SET `value` = 10737418240, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `tier` = 'household' AND `key` = 'image_quota_bytes' AND `value` = 4294967296;--> statement-breakpoint
UPDATE `plan_limits` SET `value` = 30000, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `tier` = 'household' AND `key` = 'image_quota_count' AND `value` = 10000;--> statement-breakpoint
UPDATE `plan_limits` SET `value` = 5242880, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `tier` = 'household' AND `key` = 'image_max_file_bytes' AND `value` = 10485760;--> statement-breakpoint
UPDATE `plan_limits` SET `value` = 524288000, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `tier` = 'trial' AND `key` = 'image_quota_bytes' AND `value` = 104857600;--> statement-breakpoint
UPDATE `plan_limits` SET `value` = 2000, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `tier` = 'trial' AND `key` = 'image_quota_count' AND `value` = 200;
