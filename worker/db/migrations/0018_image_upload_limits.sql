-- Photo upload rate limits decided 2026-10-09 (spec.md D1, step 6): 120 uploads a minute for each
-- person and 6,000 a day for each household on Individual and Household; none on Free, which
-- can't upload photos. Like every limit they are changed from the admin console, never here.
INSERT OR IGNORE INTO `plan_limits` (`tier`, `key`, `value`, `updated_at`) VALUES
  ('free', 'image_uploads_per_minute', 0, cast(unixepoch('subsecond') * 1000 as integer)),
  ('free', 'image_uploads_per_day', 0, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'image_uploads_per_minute', 120, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'image_uploads_per_day', 6000, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'image_uploads_per_minute', 120, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'image_uploads_per_day', 6000, cast(unixepoch('subsecond') * 1000 as integer));
