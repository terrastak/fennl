-- Baseline: the starting point for Fennl's server database. It creates nothing.
-- Later migrations add the tables (Better Auth's arrive in phase B2).
-- D1 rejects a migration with no statements, so this one runs a harmless query.
SELECT 1;
