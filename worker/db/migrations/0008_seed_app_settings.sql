-- During the beta, creating an account needs an invite code (spec.md B5). The admin console turns
-- this off at public launch; this file only sets the starting value and never overwrites a change.
INSERT OR IGNORE INTO `app_setting` (`key`, `value`, `updated_at`) VALUES
  ('sign_up_requires_code', 'true', cast(unixepoch('subsecond') * 1000 as integer));
