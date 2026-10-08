import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "dist",
    ".wrangler",
    "worker-configuration.d.ts",
    "test-results",
    "playwright-report",
    "e2e/.auth",
  ]),
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["app/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat["recommended-latest"], reactRefresh.configs.vite],
  },
  {
    // The service worker that keeps the app's files on the device (phase C4b).
    files: ["app/offline/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["*.{js,ts}", "e2e/**/*.ts", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests may assert that a value exists after checking it with expect().
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.ts", "worker/test/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  prettier,
]);
