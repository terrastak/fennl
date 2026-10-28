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
        // The import quality scorecard (phase E1): the test set and the report.
        test: {
          name: "import-quality",
          include: ["import-quality/**/*.test.ts"],
          environment: "node",
        },
      },
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
                ACCESS_DEV_BYPASS: "true",
                ADMIN_ALERT_EMAIL: "owner@example.com",
                AI_PROVIDER: "fake",
                // The local development push key (.dev.vars.example), for timer alerts (U8).
                PUSH_PRIVATE_KEY:
                  '{"kty":"EC","x":"H8kX46jxo62ovZPcnLW1_efgiORXlUVVDWkD-XXLpoU","y":"IH07xqLY666avOEBMlb08fgTU5nvTLlWXBlayMCbGpU","crv":"P-256","d":"fOcwc7gEDDmjVYHyE-8_jO2hxZF_Ntu9wE5T1yp-X_c"}',
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
