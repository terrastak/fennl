# Fennl

A recipe app focused on importing recipes from the web, photos of recipe cards, cookbook pages, PDFs, and Paprika 3. It's built on Cloudflare.

- **What we're building and why:** `CLAUDE.md` (architecture decisions) and `spec.md` (the phase-by-phase plan).
- **One-time Cloudflare and GitHub setup:** `docs/setup/a1-cloudflare-and-github.md`.

## Project layout

| Folder | What's in it |
| --- | --- |
| `app/` | The web app people see (React). |
| `worker/` | The server: a Cloudflare Worker that answers `/api/...` requests (Hono). |
| `shared/` | Code used by both, such as data shapes and, later, recipe parsing. |
| `e2e/` | Tests that drive the real app in a browser (Playwright). |

Each kind of code has its own TypeScript settings: `tsconfig.app.json`, `tsconfig.worker.json`, and `tsconfig.node.json` for tooling and config files.

## Running it on your own computer

You need **Node.js 24** (the version in `.nvmrc`). Then, in this folder:

```sh
npm ci            # install exactly the versions in package-lock.json
npm run dev       # start the app at http://localhost:5173 (the server runs too)
```

Open the address it prints. You should see "Hello, Fennl" and "Server status: ok".

## Checks

| Command | What it does |
| --- | --- |
| `npm run check` | Runs everything below in order. Run this before opening a pull request. |
| `npm run format:check` | Checks code formatting (`npm run format` fixes it). |
| `npm run lint` | Looks for common mistakes. |
| `npm run typecheck` | Generates Cloudflare's types, then checks all TypeScript. |
| `npm test` | Fast unit tests for `app/`, `worker/`, and `shared/`. |
| `npm run test:e2e` | Builds the app and tests it in a real browser. |

The first browser test run may ask you to install a browser: `npx playwright install chromium`. If a Chromium is already installed somewhere, point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at it instead.

## Notes for contributors

- Use **npm 11 or newer** (it ships with Node 24) when **adding or upgrading** packages. npm 10 has a bug resolving this project's dependency tree from scratch. Installing from the lockfile with `npm ci` works on either.
- npm 11 only runs install scripts it has been told to trust. They're listed under `allowScripts` in `package.json` (currently `workerd`, Cloudflare's local runtime, and `esbuild`). After upgrading either one, approve the new version with `npm install-scripts approve <name>`.
- The app's public address is **never** written in code or config. It comes from the GitHub variable `APP_HOSTNAME` at deploy time (see `CLAUDE.md`).
