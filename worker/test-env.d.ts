// Types for Worker tests, which run in Cloudflare's Workers test pool (see vitest.config.ts).
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare namespace Cloudflare {
  interface Env {
    /** Every migration in worker/db/migrations, read by vitest.config.ts. Tests only. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
