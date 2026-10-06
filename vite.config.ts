import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function hostnameFrom(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!HOSTNAME.test(value))
    throw new Error(`${name} must be a plain lowercase hostname, got "${value}"`);
  return value;
}

/**
 * The production addresses come only from the APP_HOSTNAME and ADMIN_HOSTNAME environment
 * variables (GitHub Actions variables in CI), never from committed files. They apply to the
 * production build only; preview builds (CLOUDFLARE_ENV=preview) and local builds use their own
 * address, and serve the admin area under /admin.
 *
 * In production the admin area answers only on ADMIN_HOSTNAME. Without it, the admin area is
 * switched off (the Worker is given an address that can't exist).
 */
function productionConfig() {
  const app = hostnameFrom("APP_HOSTNAME");
  if (!app || process.env.CLOUDFLARE_ENV) return {};
  const admin = hostnameFrom("ADMIN_HOSTNAME");
  return {
    routes: [
      { pattern: app, custom_domain: true },
      ...(admin ? [{ pattern: admin, custom_domain: true }] : []),
    ],
    // APP_HOSTNAME: emails sent from the admin address (password help, B7) link to the app.
    vars: { ADMIN_HOSTNAME: admin ?? "admin-area-off.invalid", APP_HOSTNAME: app },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare({ config: productionConfig() })],
  environments: {
    client: {
      build: {
        rollupOptions: {
          // The app, and the admin console (served only in the admin area; see worker/admin).
          input: { main: "index.html", admin: "admin.html" },
        },
      },
    },
  },
});
