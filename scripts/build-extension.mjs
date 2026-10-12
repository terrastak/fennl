// Builds the Chrome extension (phase E5) into dist-extension/, plus a .zip for the Chrome Web
// Store or for loading by hand.
//
//   FENNL_ORIGIN=https://beta.fennl.app node scripts/build-extension.mjs
//
// The extension talks to one Fennl address, chosen here and never written into the code: CI
// passes the app's address (the GitHub variable APP_HOSTNAME); without one it's the local
// preview server the browser tests use.

import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";
import { build } from "vite";

const root = join(import.meta.dirname, "..");
const source = join(root, "extension");
const out = join(root, "dist-extension");
const origin = (process.env.FENNL_ORIGIN ?? "http://localhost:4173").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(origin)) {
  throw new Error(`FENNL_ORIGIN must be an address like https://beta.fennl.app, not ${origin}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const shared = {
  configFile: false,
  root: source,
  logLevel: "warn",
  define: { __FENNL_ORIGIN__: JSON.stringify(origin) },
};

// The panel: an HTML page with its script and styles.
await build({
  ...shared,
  base: "./",
  build: { outDir: out, emptyOutDir: false, rollupOptions: { input: join(source, "popup.html") } },
});

// The script on Fennl's connect page: one classic script (content scripts can't be modules).
await build({
  ...shared,
  build: {
    outDir: out,
    emptyOutDir: false,
    lib: {
      entry: join(source, "connect.ts"),
      formats: ["iife"],
      name: "fennlConnect",
      fileName: () => "connect.js",
    },
  },
});

const manifest = readFileSync(join(source, "manifest.json"), "utf8").replaceAll(
  "__FENNL_ORIGIN__",
  origin,
);
writeFileSync(join(out, "manifest.json"), manifest);
cpSync(join(source, "icons"), join(out, "icons"), { recursive: true });

// The .zip: every file, at the top level of the archive (as the Chrome Web Store expects).
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[relative(out, path)] = readFileSync(path);
  }
};
walk(out);
const { version } = JSON.parse(manifest);
writeFileSync(join(root, `fennl-extension-${version}.zip`), zipSync(files));
console.log(`Built the Fennl extension ${version} for ${origin} in dist-extension/`);
