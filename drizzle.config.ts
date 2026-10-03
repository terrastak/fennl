import { defineConfig } from "drizzle-kit";

/**
 * Drizzle writes a migration file whenever worker/db/schema.ts changes (`npm run db:generate`).
 * Wrangler applies those files to D1 (see the d1_databases entries in wrangler.jsonc).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./worker/db/migrations",
});
