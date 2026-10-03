import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Cloudflare's Workers test pool bundles its own copy of the Workers runtime, which lags behind
 * Wrangler's. Its newest supported date is used for tests until the pool catches up with the
 * compatibility_date in wrangler.jsonc (CI deploys still use the wrangler.jsonc date).
 */
const TEST_POOL_COMPATIBILITY_DATE = "2026-08-22";

export default defineConfig({
  test: {
    projects: [
      {
        // App and shared code: plain unit tests in Node.
        test: {
          name: "node",
          include: ["{app,shared}/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        // Worker code runs inside Cloudflare's local Workers runtime, with a real (local, empty)
        // D1 database per test file. The migration files are handed in so tests can apply them.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              compatibilityDate: TEST_POOL_COMPATIBILITY_DATE,
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./worker/db/migrations"),
                BETTER_AUTH_SECRET: "test-secret-for-worker-tests-only-0123456789",
                DEV_EMAIL_OUTBOX: "true",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["worker/**/*.test.ts"],
        },
      },
    ],
  },
});
