-- Starting limits for each tier (spec.md B4). After this, they're changed from the admin
-- console (phase B7), never by editing this file. Values are counts or bytes; NULL means no limit.
-- Decided 2026-10-03: Free 100 recipes and 3 MB of text, 256 KB per recipe on every tier,
-- Premium text 50 MB (Individual) and 100 MB (Household). Device caps and image quotas are
-- placeholders until phases B6 and D1 decide them. "trial" lowers image quotas during a trial.
INSERT OR IGNORE INTO `plan_limits` (`tier`, `key`, `value`, `updated_at`) VALUES
  ('free', 'max_recipes', 100, cast(unixepoch('subsecond') * 1000 as integer)),
  ('free', 'max_text_bytes', 3145728, cast(unixepoch('subsecond') * 1000 as integer)),
  ('free', 'max_recipe_bytes', 262144, cast(unixepoch('subsecond') * 1000 as integer)),
  ('free', 'max_devices', 1, cast(unixepoch('subsecond') * 1000 as integer)),
  ('free', 'image_quota_bytes', 0, cast(unixepoch('subsecond') * 1000 as integer)),
  ('free', 'image_quota_count', 0, cast(unixepoch('subsecond') * 1000 as integer)),
  ('free', 'image_max_file_bytes', 0, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'max_recipes', NULL, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'max_text_bytes', 52428800, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'max_recipe_bytes', 262144, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'max_devices', 5, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'image_quota_bytes', 2147483648, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'image_quota_count', 5000, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'image_max_file_bytes', 10485760, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'max_recipes', NULL, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'max_text_bytes', 104857600, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'max_recipe_bytes', 262144, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'max_devices', 10, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'image_quota_bytes', 4294967296, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'image_quota_count', 10000, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'image_max_file_bytes', 10485760, cast(unixepoch('subsecond') * 1000 as integer)),
  ('trial', 'image_quota_bytes', 104857600, cast(unixepoch('subsecond') * 1000 as integer)),
  ('trial', 'image_quota_count', 200, cast(unixepoch('subsecond') * 1000 as integer));
