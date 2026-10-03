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
  ]),
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["app/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat["recommended-latest"], reactRefresh.configs.vite],
  },
  {
    files: ["*.{js,ts}", "e2e/**/*.ts", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
