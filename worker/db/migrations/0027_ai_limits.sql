-- AI imports (phase E7, decided by the owner 2026-10-12). Per household per month: 300 AI imports
-- on Premium, and a hidden backstop of $15 of estimated AI cost (in cents), in case a model's
-- price or the share of second looks turns out higher than planned. Free has neither (AI import
-- is Premium; CLAUDE.md, "Import sources"). Both can be changed from the admin console.
INSERT OR IGNORE INTO `plan_limits` (`tier`, `key`, `value`, `updated_at`) VALUES
  ('free', 'ai_imports_per_month', 0, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'ai_imports_per_month', 300, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'ai_imports_per_month', 300, cast(unixepoch('subsecond') * 1000 as integer)),
  ('free', 'ai_cost_cents_per_month', 0, cast(unixepoch('subsecond') * 1000 as integer)),
  ('individual', 'ai_cost_cents_per_month', 1500, cast(unixepoch('subsecond') * 1000 as integer)),
  ('household', 'ai_cost_cents_per_month', 1500, cast(unixepoch('subsecond') * 1000 as integer));
