import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The production custom domain comes only from the APP_HOSTNAME environment variable (a GitHub
 * Actions variable in CI), never from committed files. It applies to the production build only;
 * preview builds (CLOUDFLARE_ENV=preview) use workers.dev.
 */
function productionRoutes() {
  const hostname = process.env.APP_HOSTNAME?.trim();
  if (!hostname || process.env.CLOUDFLARE_ENV) return {};
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
    throw new Error(`APP_HOSTNAME must be a plain lowercase hostname, got "${hostname}"`);
  }
  return { routes: [{ pattern: hostname, custom_domain: true }] };
}

export default defineConfig({
  plugins: [react(), cloudflare({ config: productionRoutes() })],
});
