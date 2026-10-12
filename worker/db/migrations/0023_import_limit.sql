-- Imports without the AI per person per day (phase E5, decided 2026-10-12): no limit on any tier
-- for now. Setting a tier's value to 0 from the admin console turns these imports off for it
-- (import_structured_enabled), for example to make the Chrome extension Premium only.
INSERT OR IGNORE INTO `plan_limits` (`tier`, `key`, `value`, `updated_at`) VALUES
  ('free', 'structured_imports_per_day', NULL, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'structured_imports_per_day', NULL, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'structured_imports_per_day', NULL, cast(unixepoch('subsecond') * 1000 as integer));
