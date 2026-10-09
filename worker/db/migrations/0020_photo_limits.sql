-- Photos per recipe, decided 2026-10-09 (spec.md D2): 10 on Individual and Household, to be raised
-- if testers need more; none on Free, which can't add photos. Changed from the admin console.
INSERT OR IGNORE INTO `plan_limits` (`tier`, `key`, `value`, `updated_at`) VALUES
  ('free', 'max_photos_per_recipe', 0, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'max_photos_per_recipe', 10, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'max_photos_per_recipe', 10, cast(unixepoch('subsecond') * 1000 as integer));
