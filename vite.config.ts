import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { defineConfig, type Plugin, type Rolldown } from "vite";

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

/**
 * Which build this is, sent with feedback (phase B8): the commit's short ID in CI (GitHub sets
 * GITHUB_SHA), "dev" locally.
 */
const APP_VERSION = (process.env.GITHUB_SHA ?? "dev").slice(0, 7);

/** Every file chunk reachable from an entry: its imports, lazy imports, styles and assets. */
function reachable(bundle: Rolldown.OutputBundle, entry: string): Set<string> {
  const found = new Set<string>();
  const start = Object.values(bundle).find(
    (file): file is Rolldown.OutputChunk =>
      file.type === "chunk" && file.isEntry && file.name === entry,
  );
  const visit = (fileName: string) => {
    if (found.has(fileName)) return;
    found.add(fileName);
    const file = bundle[fileName];
    if (file?.type !== "chunk") return;
    [...file.imports, ...file.dynamicImports].forEach(visit);
    const meta = file.viteMetadata;
    [...(meta?.importedCss ?? []), ...(meta?.importedAssets ?? [])].forEach((f) => found.add(f));
  };
  if (start) visit(start.fileName);
  return found;
}

/** The files in public/ the app uses: fonts, icons and its manifest. */
function publicAppFiles(): string[] {
  const files = (dir: string): string[] =>
    readdirSync(`public/${dir}`).map((name) => `/${dir}/${name}`);
  return [...files("fonts"), ...files("icons"), "/manifest.webmanifest"];
}

/**
 * Writes /sw.js (from app/offline/sw.js) with the list of the app's files, so the app can open
 * with no connection (phase C4b). Everything the build made is listed except pages, settings
 * files (".assetsignore", which is never served) and files only the admin console or the
 * storage and photo tests use.
 */
function offlineAppFiles(): Plugin {
  return {
    name: "fennl-offline-app-files",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      const app = reachable(bundle, "main");
      const elsewhere = new Set([
        ...reachable(bundle, "admin"),
        ...reachable(bundle, "storageTrial"),
        ...reachable(bundle, "photoTrial"),
      ]);
      const built = Object.keys(bundle).filter(
        (name) =>
          !name.startsWith(".") &&
          !name.endsWith(".html") &&
          !name.endsWith(".map") &&
          !name.endsWith(".webmanifest") &&
          (app.has(name) || !elsewhere.has(name)),
      );
      const files = [...built.map((name) => `/${name}`), ...publicAppFiles()].sort();
      const build = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source:
          `const BUILD = ${JSON.stringify(build)};\nconst FILES = ${JSON.stringify(files)};\n` +
          readFileSync("app/offline/sw.js", "utf8"),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare({ config: productionConfig() }), offlineAppFiles()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // SQLite's browser build loads its own .wasm file; Vite must not pre-bundle it (its README),
  // and its background worker uses modern imports.
  // The WebP encoder (phase D2) loads its .wasm file the same way.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm", "@jsquash/webp"] },
  worker: { format: "es" },
  environments: {
    client: {
      build: {
        rollupOptions: {
          // The app, the admin console (served only in the admin area; see worker/admin), and
          // the browser storage trial (phase C2, /storage-trial) and the photo test (phase D2,
          // /photo-trial).
          input: {
            main: "index.html",
            admin: "admin.html",
            storageTrial: "storage-trial.html",
            photoTrial: "photo-trial.html",
          },
        },
      },
    },
  },
});
