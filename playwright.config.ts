import { defineConfig, devices } from "@playwright/test";
import { SIGNED_IN_STATE } from "./e2e/support";

const port = 4173;
// Lets a machine with a preinstalled Chromium use it instead of downloading one.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const launchOptions = executablePath ? { executablePath } : {};

const PHONE_TESTS = [
  "accessibility",
  "auth",
  "cook",
  "devices",
  "discover",
  "editor",
  "feedback",
  "filters",
  "import",
  "navigation",
  "photos",
  "print",
  "recipes",
  "scan",
  "scanCamera",
  "smoke",
].map((name) => `${name}.spec.ts`);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    // Makes a confirmed test account; the other projects start signed in as it.
    {
      name: "setup",
      testMatch: /\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], launchOptions, storageState: SIGNED_IN_STATE },
      dependencies: ["setup"],
    },
    {
      name: "phone",
      // Only the tests where a phone shows or does something different from a computer: the
      // bottom tabs and top bar, the camera and touch, layouts that fold to one column, and the
      // pages people use in the kitchen. The rest test the same thing twice (owner's request
      // 2026-10-23: faster checks). Add a test file here when it covers a phone-only layout.
      testMatch: PHONE_TESTS,
      use: { ...devices["Pixel 7"], launchOptions, storageState: SIGNED_IN_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `node scripts/ensure-dev-vars.mjs && npm run build && npm run db:migrate:local && npx vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
