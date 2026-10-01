import { defineConfig } from "vitest/config";

// Unit tests run in Node. Worker tests that need Cloudflare bindings (D1, R2) will move to
// Cloudflare's Workers test pool when those bindings arrive (phase B1).
export default defineConfig({
  test: {
    include: ["{app,worker,shared}/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
