import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import journal from "./migrations/meta/_journal.json";

const migrationFiles = env.TEST_MIGRATIONS.map((m) => m.name);

async function appliedMigrations(): Promise<string[]> {
  const { results } = await env.DB.prepare("select name from d1_migrations order by id").all<{
    name: string;
  }>();
  return results.map((row) => row.name);
}

describe("database migrations", () => {
  it("are all written by Drizzle, in order", () => {
    // A SQL file Drizzle doesn't know about (or a missing one) would put the schema and the
    // database out of step.
    expect(migrationFiles).toEqual(journal.entries.map((entry) => `${entry.tag}.sql`));
  });

  it("apply cleanly to an empty database", async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    expect(await appliedMigrations()).toEqual(migrationFiles);
  });

  it("are not applied twice", async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    expect(await appliedMigrations()).toEqual(migrationFiles);
  });
});
