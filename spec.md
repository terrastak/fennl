# Fennl: development plan

This is the step-by-step build plan for Fennl. Read it together with `CLAUDE.md`, which holds the architecture decisions. When this plan and `CLAUDE.md` disagree, `CLAUDE.md` wins until the owner approves a change to it.

## How we work

- The project is broken into **stages** (A, B, C...) and each stage into small **phases**. One phase is one reviewable change (one pull request).
- **Nothing is coded until its phase is approved.** Before a phase starts, we discuss it and adjust it. Approving a phase approves only that phase.
- Every phase ends with:
  - a **preview link** to a live copy of the app with that phase's changes,
  - a short **"You check"** list of things to click and confirm in plain English,
  - automated tests that prove the code works (you don't need to read them).
- Each phase lists any **decisions** it needs from you. Those are asked before the phase starts, not halfway through.
- Phases are deliberately small. If a phase turns out bigger than expected, it gets split rather than rushed.
- This file is updated as we go: phases get marked **Approved**, **In progress**, or **Done**, and decisions get recorded.

## What we're building (summary of goals)

Recorded from the planning conversation on 2026-10-01.

| Topic | Answer |
| --- | --- |
| First release | **Invite-only beta** on real accounts. Public paid launch comes after. |
| Headline feature | **Importing** recipes from websites, handwritten cards, cookbook pages, screenshots, PDFs, and Paprika 3. |
| Web import, first method | **Chrome browser extension** (desktop). It reads the page as the user sees it, so logged-in and paywalled sites work. |
| Web import on phones during beta | Not supported. Phone users import on a computer or by screenshot/photo. Paste-a-link and the phone share button come after the beta. |
| Photo/document import | Handwritten cards (incl. front/back, multi-card), printed cookbook pages (incl. multi-page), screenshots, PDFs (incl. many recipes per file). |
| Who can import | **Split by cost** (as in `CLAUDE.md`, changed 2026-10-03). Imports that need no AI (Paprika files, web pages with structured data) are allowed on Free as text only, with a size cap and no photos (`import_structured_enabled`). Imports that call the AI are Premium only (`import_ai_enabled`). |
| Beta access to Premium | **Invited testers get Premium free** through an invite code. Stripe billing is built in a later stage, before public launch. |
| AI provider | **Claude (Anthropic API), starting with Claude Haiku**, behind a thin "provider" layer. **Swapping models or providers must be easy** (a config change for a different Claude model, one new file for a different vendor). Chosen after comparing options on 2026-10-01; see "Notes: AI provider research" below. |
| Free-user AI import teaser | **Open.** Whether free accounts get a few AI imports as a taste of Premium. Revisit later (before public launch). |
| Original card/page photos | **Always kept** with the imported recipe. They count toward the image quota. |
| Social media / video import | **After the beta.** |
| Paprika 3 import | **Essential for the beta.** The owner has a large library, photos included. |
| Beta features beyond the recipe box | **Scaling and conversions** (incl. pan sizes) and **cook mode**. Grocery list and meal planner come after the beta. |
| Recipe details in beta | Basics plus **multiple photos per recipe**, **nested categories**, **linked sub-recipes**, **nutrition** (stored and shown; automatic calculation later). |
| Devices | **Phone and computer equally.** One web app that works at both sizes and can be installed to the home screen. |
| Visual design | A **fresh design phase** early on: 2 to 3 directions to choose from. The old `fennl_cursor` look is not carried over by default. |
| Review style | **Preview link + plain-English checklist** for every phase. |
| Accounts in place | Cloudflare account (Workers not yet set up) and a domain name. Still needed: Anthropic API key (Stage E), email-sending service, Resend (Stage B), Stripe (post-beta). |

**Merged 2026-10-03 from a parallel planning conversation:**
- household recipe ownership and splitting
- household billing rules
- free-tier limits (100 recipes, 3 MB) with admin-editable limits and per-account overrides
- over-limit and downgrade behavior with a usage bar
- the 90-day photo grace period
- 30-day Trash
- an admin console with strong security and silent impersonation

Details are in `CLAUDE.md`. They're reflected below in B4, B4a, B5, B7, C1, C2, C3, C9, C11, C12, D1, D3, G1–G1c, H1–H3, and Stage I. Platform facts checked that day are in `docs/research/2026-10-03-platform-check.md`.

The old `fennl_cursor` repo is background only. Its PRD has useful detail on import quality, cooking features, and keyboard use, and this plan borrows requirements from it. Its stack (Next.js via vinext, Clerk) and code are **not** used.

## Proposed technical approach (Leaning, approved phase by phase)

These are recommendations. Each one is confirmed in the phase that first needs it, and new dependencies are always asked about first (per `CLAUDE.md`).

| Area | Recommendation | Why | Confirmed in |
| --- | --- | --- | --- |
| Language | TypeScript everywhere (app, server, extension) | One language; strong checking catches mistakes early | A2 |
| Web app | React single-page app built with Vite | A local-first app does its work in the browser, so a plain single-page app fits better than a server-rendering framework. Widely known, so less debugging | A2 |
| Server | One Cloudflare Worker that serves the app files and the `/api` routes, using the small Hono routing library | Simplest deployment: one thing to deploy | A2 |
| Database access | **Drizzle** (works with Better Auth and D1). Decided 2026-10-03 | Typed queries and migration files | B1 |
| Local browser database | SQLite (WASM) on OPFS, with full-text search | Confirmed on real devices in C2 (2026-10-07) | C2 |
| Recipe storage on server | **Open**: D1, or a Durable Object per household | `CLAUDE.md` open question 7. Decided in phase C1 after checking current Cloudflare limits | C1 |
| Email (verification, password reset, invites) | **Decided**: Resend, called only through one swappable "send email" function in the Worker. The API key is a Worker secret | Simple HTTP API; free tier (3,000 emails/month, 100/day) covers the beta. Postmark and Cloudflare Email Sending (beta as of 2026-10-03) were compared and stay as later options; switching means rewriting that one function | B2 |
| AI | Anthropic Claude API (Haiku to start) with vision, called only from the server, behind a swappable provider interface | Owner's choice. One call reads a photo or PDF and returns a structured recipe, so no separate OCR service is needed. API key never reaches the browser | E7 |
| Browser extension | Chrome extension (Manifest V3), TypeScript, shares parsing code with the app | Reuses the import engine | E5 |
| Tests | Vitest (unit), Playwright (in-browser), Cloudflare's local Workers runtime for server tests | Standard, runs in CI | A2 |
| CI and previews | GitHub Actions runs tests on every pull request and deploys a preview version of the Worker | Gives the preview link for each phase | A3 |

## Additions to `CLAUDE.md` this plan needs

Phase A0 proposes these edits to `CLAUDE.md`. None of them changes a **Decided** item, but they need the owner's approval:

1. **Beta grants.** Entitlements are derived from the household's subscription, **or from a beta grant** (an invite code that gives a household Premium for a set period). A grant is one more input to the same entitlement check. It is not a separate code path.
2. **Import.** Record the import goals above: Chrome extension first, the AI provider (Claude Haiku to start, swappable by design, no separate OCR service), originals kept, AI import Premium only (structured import also on Free, text only), video after the beta.
3. **AI usage limits.** Every AI call is metered per household, with a monthly cap (value Open) and a global spending alarm, so a bug or abuse can't run up a large bill.
4. **New tables**: `category`, `recipe_category`, `recipe_photo`, `import_job`, `ai_usage`, `beta_invite`. Their exact columns are set in the phase that builds them.
5. **Beta scope**: scaling, conversions, pan sizes, cook mode, linked sub-recipes, nutrition, nested categories, multiple photos. Meal planner and grocery list come later.
6. A pointer to this `spec.md`.

---

# The plan

Legend for each phase: **Goal**, **Steps**, **You check** (the click-through list on the preview link), **Done when**, **Decisions** (asked before the phase starts).

## Stage A: Foundations

### A0. Approve the plan and update `CLAUDE.md`
- **Goal**: Agree on this plan and record new decisions.
- **Steps**:
  1. Owner reads this file; we discuss and adjust.
  2. Apply the `CLAUDE.md` additions listed above.
  3. Mark this phase Done.
- **You check**: `CLAUDE.md` and `spec.md` say what you meant.
- **Done when**: Both files are merged into `main`.
- **Decisions**: Everything in "Proposed technical approach" is still only proposed; just say if anything there feels wrong.

### A1. Accounts and keys setup (guided, mostly done by you)
- **Goal**: Prepare the Cloudflare and GitHub settings the build needs. No code.
- **Steps** (click-by-click guide: `docs/setup/a1-cloudflare-and-github.md`):
  1. Turn on Workers in your Cloudflare account and choose a `workers.dev` subdomain.
  2. Create a Cloudflare API token from the "Edit Cloudflare Workers" template, plus D1 Edit, limited to your account and the `fennl.app` zone.
  3. Add the token and account ID as GitHub repository secrets, and the app's address as the GitHub variable `APP_HOSTNAME`.
  4. Check that no DNS record already uses the app's address.
  5. A read-only "Cloudflare access check" workflow on GitHub confirms all of the above without deploying anything.
- **You check**: Follow the guide; then the access check on GitHub is green.
- **Done when**: The access check passes with no errors.
- **Decided (2026-10-01)**: The beta runs at **`beta.fennl.app`** (`fennl.app` is already in the owner's Cloudflare account). The address will change later, so it is **never hardcoded**: it lives only in the GitHub variable `APP_HOSTNAME`, and code and config read it from there. Preview links live on `workers.dev`.

### A2. Empty project skeleton
- **Goal**: A minimal project that builds, tests, and runs locally, with nothing recipe-specific yet.
- **Steps**:
  1. Folder layout: `app/` (web app), `worker/` (server), `shared/` (code used by both, e.g. recipe types and parsers), `extension/` added later.
  2. TypeScript in strict mode, formatter, linter.
  3. Test runners set up, with one trivial test each for the app, the worker, and shared code.
  4. A "Hello, Fennl" page served by the Worker, and a `/api/health` route.
  5. `README.md` with plain-English "how to run it" notes.
- **You check**: Nothing to click yet (A3 adds the preview link). I show you the test run output.
- **Done when**: Build, lint, typecheck, and tests all pass locally.
- **Decisions**: Approve the dependency list (React, Vite, Hono, Vitest, Playwright, Wrangler).
- **Built (2026-10-01)**: React 19 + Vite 8 with Cloudflare's Vite plugin (one build makes both the app and the Worker), Hono 4, Wrangler 4, TypeScript 6.0 (strict), ESLint + Prettier, Vitest 4, Playwright.
  - **TypeScript 6.0, not 7**: the lint tool (typescript-eslint) supports only up to 6.0 so far. Revisit when it supports 7.
  - **Vitest 4, not 5**: Cloudflare's Workers test pool, needed from B1 for D1 tests, supports Vitest 4 only. Worker tests run in Node until then.
  - **Node 24 / npm 11**: npm 10 (bundled with Node 22) crashes when resolving this dependency tree from scratch; installing from the lockfile works on both. npm 11 runs install scripts only for packages listed in `allowScripts` (`workerd`, `esbuild`).
  - The Worker only handles `/api/*`; every other path serves the single-page app, so deep links work.

### A3. Continuous integration and preview links
- **Goal**: Every pull request is tested automatically and gets its own preview link.
- **Steps**:
  1. GitHub Actions workflow: lint, typecheck, test on each pull request.
  2. Deploy a preview version of the Worker per pull request and post the link on the PR. (Checked 2026-10-01: `wrangler versions upload --preview-alias` gives a `<alias>-<worker>.<subdomain>.workers.dev` link. **Caveat**: Cloudflare's docs say preview URLs don't work for Workers that use Durable Objects. If C1 picks Durable Objects, previews must deploy a separate per-PR or staging Worker instead.)
  3. The production custom domain is generated from `APP_HOSTNAME` at deploy time (Wrangler has no command-line flag for it, so the workflow writes it into the deploy config). No hostname appears in committed files.
  4. A separate "staging" set of D1/R2 resources so previews never touch real user data.
  5. Production deploys only when `main` changes, and only after tests pass.
- **You check**: Open the preview link from the PR and see "Hello, Fennl".
- **Done when**: A PR shows a green check and a working preview link.
- **Built (2026-10-01)**: `.github/workflows/ci.yml` with three jobs:
  - **check** (every PR and every push to `main`): format, lint, typecheck, unit tests, browser tests.
  - **preview** (PRs from this repo, after check): builds the separate **`fennl-preview`** Worker (`env.preview` in `wrangler.jsonc`) and uploads a version with the alias `pr-<number>`. The link is `https://pr-<number>-fennl-preview.<subdomain>.workers.dev`. The job checks `/api/health` and posts the link as a PR comment, which is updated in place on later pushes. The first-ever run creates the preview Worker, because Cloudflare only accepts preview versions for a Worker that already exists.
  - **deploy** (push to `main`, after check): builds with `APP_HOSTNAME` (read in `vite.config.ts`, production builds only), deploys the **`fennl`** Worker to that custom domain, and waits for `/api/health` to answer there.
  - Production has `workers_dev` and `preview_urls` off, so it's reachable only on its custom domain.
  - Step 4 (staging resources): there are no D1/R2 bindings yet. When B1 and D1 add them, staging bindings go under `env.preview` and production ones at the top level, so previews can never reach production data.
  - Preview links are public to anyone who has the link. That's fine while there's no user data; revisit before previews hold anything real.

### A4. Design direction
- **Goal**: Choose how Fennl looks and feels.
- **Steps**:
  1. Build 2 to 3 visual directions as clickable static mockups of three key screens: recipe list, recipe page, import review.
  2. Each shows type, color, spacing, light and dark mode, and phone and desktop sizes.
  3. You pick one (or mix); I record the result as design tokens (named colors, sizes, fonts).
- **You check**: Compare the directions on your phone and computer and pick.
- **Done when**: A chosen direction is written down as tokens in the code and summarized in this file.
- **Decisions**: The name/logo treatment, and any colors or fonts you love or hate.
- **Decided (2026-10-03)**: Full record in `docs/design/design-direction.md`; tokens in `app/styles/tokens.css` (tested for completeness and contrast in `tokens.test.ts`).
  - Based on the **Harbor** direction (sidebar layout, warm paper), with a light handwritten touch from **Heirloom**.
  - Headings in **Commissioner** (flair 80, weight 540); body in **Instrument Sans**; occasional handwriting in **Caveat** for names, greetings, captions and family notes. Recipe sources show just the name (June, Dad, Nana).
  - Two color schemes, **Harbor** (navy and coral) and **Heirloom** (olive and berry), each in light and dark. The **color scheme is an account-level setting**. Light/Dark/Match my device; default is match my device.
  - Still open: the final logo. (Fonts are self-hosted since A5.)

### A5. App shell
- **Goal**: The empty frame of the app: navigation, pages, settings.
- **Steps**:
  1. Layout that adapts between phone (bottom or top bar) and desktop (sidebar).
  2. Placeholder pages: Recipes, Import, Settings, Account.
  3. Settings › Appearance (A4 design): color scheme Harbor or Heirloom (an **account-level** setting, kept on this device until accounts exist in Stage B), Light/Dark/Match my device, and text size.
  4. Keyboard baseline: visible focus, logical tab order, skip link. (From the old PRD: every screen must be efficient without a mouse.)
  5. Installable web app basics: app name, icons, home-screen install. (No offline behavior yet.)
- **You check**: Navigate on phone and desktop; change text size and dark mode; install to your phone's home screen.
- **Done when**: Shell passes automated accessibility checks and keyboard-only tests.
- **Built (2026-10-03)**:
  - Sidebar on screens 900px and wider; top bar plus bottom tabs (Recipes, Import, Settings, Account) on phones.
  - Pages: Recipes (time-of-day handwritten greeting, empty state), Import ("coming soon" list), Settings, Account, and a "Page not found" page. A tiny built-in router for now; switch to a full router when recipe pages need IDs (Stage C).
  - Settings › Appearance: Harbor/Heirloom cards, Light/Dark/Match my device, four text sizes. Applied instantly, saved on this device, and restored before the first paint (no flash). The color scheme moves to the account in Stage B.
  - Keyboard: skip link, visible focus, logical order, and focus moves to the new page's heading after navigating.
  - Installable: web app manifest, icons (including maskable and Apple touch icons), theme colors. No offline behavior yet.
  - Fonts are self-hosted (no Google requests). The handwritten greeting's position was re-measured against the approved mockup with the real fonts.
  - Tests: browser tests at desktop and phone size cover navigation, appearance and keyboard use, and run axe accessibility checks on every page in all four looks. `@axe-core/playwright` was added as a test-only dependency.

## Stage B: Accounts, households, entitlements, devices

### B1. Server database and migrations
- **Goal**: The D1 database exists with a repeatable way to change its structure.
- **Steps**:
  1. Create D1 databases (staging and production).
  2. Set up Drizzle and the migration workflow.
  3. A test that applies all migrations to an empty database.
- **You check**: Nothing visible; I show the migration run.
- **Done when**: Migrations run in CI and on staging.
- **Decisions**: Approve Drizzle (vs. Kysely; both supported by Better Auth).
- **Decided (2026-10-03)**: Drizzle.
- **Built (2026-10-03)**:
  - Two D1 databases: **`fennl`** (production) and **`fennl-preview`** (staging, shared by every pull-request preview). They're found by name, so no database IDs are committed. CI creates a database the first time it's missing.
  - Tables are defined in `worker/db/schema.ts`. `npm run db:generate` writes a migration file into `worker/db/migrations`. Migrations are never edited after they're merged; a change is always a new migration.
  - The first migration is an empty baseline. Better Auth's tables arrive in B2 as the next migration.
  - CI checks that the schema and the migrations match (`npm run db:check`) and tests that every migration applies to an empty database. It then applies migrations to staging before each preview, and to production before each deploy.
  - Migrations run **before** the new code goes live, so each one must work with the code already running: add first, remove old columns only in a later change.
  - `/api/health` now also checks the database. It answers "degraded" (and CI fails) if the database doesn't respond. Settings › About shows "Server status: ok, database connected".
  - New packages: `drizzle-orm`, plus two dev-only tools: `drizzle-kit` (writes migrations) and `@cloudflare/vitest-pool-workers` (runs Worker tests in Cloudflare's local runtime with a real local database).
  - Cloudflare's test pool bundles an older Workers runtime than Wrangler, so Worker tests use its newest supported compatibility date (`vitest.config.ts`). Deploys still use the date in `wrangler.jsonc`. Remove the override when the pool catches up.

### B2. Sign up, sign in, sign out
- **Goal**: Real accounts with Better Auth.
- **Steps**:
  1. Better Auth in the Worker using D1.
  2. Email + password sign-up with email verification; password reset.
  3. Sign-in, sign-out, and session handling in the app.
  4. Basic rate limits on sign-in and sign-up.
  5. Email goes through one swappable "send email" function (Resend adapter). Send from a subdomain of the app's domain, with SPF, DKIM and a DMARC record (start at `p=none`). Plain-text and HTML versions, link/open tracking off for auth emails, bounces and complaints watched.
  6. Verification screen shows "Check your spam folder" and a "Resend email" button.
- **You check**: Create an account, verify the email, sign out, sign in, reset the password. Send test emails to Gmail, Outlook and iCloud addresses and confirm they reach the inbox (the headers show SPF, DKIM and DMARC all passing).
- **Done when**: Auth flows pass end-to-end tests.
- **Decisions**: ~~Email-sending service~~ Decided: Resend, behind a swappable function. ~~Whether to also offer "Sign in with Google" or Apple, or magic links~~ Decided 2026-10-03: email and password, plus Google and Apple. Magic links not now.
- **Built (2026-10-03)**: owner setup steps are in `docs/setup/b2-email-and-sign-in.md`.
  - **Better Auth 1.7.7** runs in the Worker at `/api/auth/*`, with its tables in D1 (migration `0001_auth`, generated from `worker/auth/options.ts` by `npm run auth:generate`). Each request builds its auth settings from the request's own address, so no hostname is stored.
  - **Email and password**:
    - Passwords are at least 8 characters, hashed with scrypt.
    - The email must be confirmed before the first sign-in; signing in unconfirmed sends a fresh link.
    - Confirmation links last 24 hours and sign you in.
    - Password-reset links last 1 hour and sign out every device.
  - **Google and Apple**: each button appears only when its settings exist. They're production-only, because both providers accept sign-ins only at registered addresses and preview addresses change per pull request. Apple's client secret is signed on the server from the `.p8` key, so it never needs renewing by hand. Signing in with Google or Apple joins an existing account with the same email.
  - **Email** goes through one `SendEmail` function (`worker/email/`). The Resend adapter sends plain-text and HTML versions with no tracking. Local development and tests keep emails in memory (`/api/dev/outbox`) instead.
  - **Sessions**: 30 days, checked against the database on every request (no cookie cache), so signing out or resetting a password takes effect at once.
  - **Rate limits** per visitor IP (Cloudflare's `cf-connecting-ip`), stored in D1:
    - sign-in: 5 a minute
    - sign-up: 3 a minute
    - password-reset requests: 3 per 5 minutes
    - resending the confirmation: 2 a minute
    - everything else: 100 a minute
    - The "who's signed in?" check is not limited.
  - **App**:
    - Screens: sign in, create account, check your email (spam-folder note and "Resend email"), email confirmed, forgot password, and choose a new password.
    - Every other page needs a signed-in account.
    - The Account page shows name, email and sign-in methods, and has "Sign out".
  - **CI**: GitHub secrets are uploaded as Worker secrets on each deploy. `BETTER_AUTH_SECRET` is generated in CI (once for production, per push for previews). Production refuses to deploy without email settings.
  - **Needs the Cloudflare Workers Paid plan** ($5/month; owner to confirm): a password hash takes about 90 ms of CPU, and the free plan allows 10 ms per request.
  - Not in B2: the color scheme still saves on the device. Moving it to the account fits B3/B4 (it needs a user settings field).

### B3. Personal household at sign-up
- **Goal**: Every new user automatically gets their own household (Better Auth organization).
- **Steps**:
  1. Enable the organization plugin.
  2. Create the household on sign-up; make it the active household.
  3. Server helper: "which household is this request for, and is the caller a member?"
- **You check**: After sign-up, the Account page shows "Household: <your name>'s kitchen" (wording TBD).
- **Done when**: Tests prove a user can never read another household's data through this helper.
- **Added (2026-10-03)**: the color scheme moves to the account (it was saved per device since A5).
- **Built (2026-10-03)**:
  - **Household creation**: Better Auth's organization plugin; a household is an organization. Each person's own household ("June's kitchen") is created at their first sign-in, so addresses that are never confirmed get none. It becomes the session's active household.
  - Accounts from before B3 get their household the next time they're used.
  - The household's slug is `personal-<user id>`, which is unique, so two requests racing can't create two households.
  - **Closed endpoints**: Better Auth's own household endpoints (create, delete, rename, invite, switch...) are closed at the Worker until sharing arrives in G1.
  - **The helper (`requireHousehold`)**: every API route that touches household data goes through it. It answers 401 without a session. It uses the session's household only if the caller really is a member; otherwise it uses the caller's own household and corrects the session.
  - `GET /api/household` feeds the Account page.
  - **Color scheme on the account** (`user.color_scheme`):
    - Choosing one in Settings saves it via `PUT /api/account/appearance`, which accepts only real schemes. Better Auth's own update endpoint can't change it.
    - Signing in on another device applies it there. The device keeps a copy for the first paint.
    - An account gets a scheme only once one is chosen in Settings.
    - Light or dark and text size stay per device.
  - **Migration `0002_households`** only adds tables and columns, so it's safe to apply before the new code goes live.
  - **Tests**:
    - Server tests prove that a session pointed at someone else's household (in the database itself) still only reaches the caller's own.
    - Other cases covered: the race, older accounts, closed endpoints, and color scheme checks.
    - A browser test checks the scheme follows the account to a second "device".

### B4. Entitlement service
- **Goal**: One server-side function that answers "what is this household allowed to do?"
- **Steps**:
  1. Compute the derived fields from `CLAUDE.md` (`tier`, `max_members`, `max_devices`, `images_enabled`, `import_structured_enabled`, `import_ai_enabled`, quotas...).
  2. Inputs for now: a code's grant (B5) or nothing (free). Stripe subscription is added in Stage I.
  3. Limits come from the `plan_limits` table plus per-account `limit_override` rows (an unexpired override wins), not from code. They're seeded with: Free 100 recipes and 3 MB text, a per-recipe cap of about 256 KB on all tiers, and Premium text caps of 50 MB Individual and 100 MB Household. Other quotas are placeholders. Limits are cached briefly, so admin changes take effect within about a minute.
  4. Account page shows the current plan and limits.
- **You check**: A fresh account shows "Free".
- **Done when**: Unit tests cover every tier and status combination we know about.
- **Built (2026-10-03)**:
  - **`computeEntitlements`** (`worker/entitlements/compute.ts`) is one pure function. It takes a subscription (Stage I) and a beta grant (B5) and returns every field in `CLAUDE.md`. When B4 was built both inputs were empty; B5 added grants from codes.
    - **Subscription statuses:**
      - Active: Premium.
      - Trialing: Premium, with the "trial" image quotas.
      - Past due: nothing is taken away.
      - Cancelled: Premium until the paid period ends.
      - Incomplete, unpaid or paused: Free.
    - An unexpired grant counts like a plan. When both exist, the better tier wins, and a plan wins a tie.
  - **Limits** come from **`plan_limits`**, then the trial's lower image quotas, then the household's unexpired **`limit_override`** rows. A null value means no limit. A limit missing from the table counts as 0, so a gap blocks rather than allows.
  - **Starting values** come from migration `0004`:
    - Free: 100 recipes, 3 MB of text, 1 device, no photos.
    - Every tier: 256 KB per recipe.
    - Individual: 50 MB of text. Household: 100 MB.
    - Device caps (5 and 10) and image quotas (2 GB and 4 GB, 10 MB per file; trial 100 MB) are placeholders for B6 and D1. Migration `0016_image_quotas.sql` (2026-10-09) replaces the image values with the starting quotas in D1 below, so the Plan page shows the decided numbers. It changes a row only while it still holds the old placeholder, so limits already edited in the admin console are kept.
  - **Caching**: tier limits are cached for a minute per Worker instance, so admin changes apply within a minute. Overrides are read fresh every time.
  - **API and UI**: `GET /api/entitlements` (through `requireHousehold`) returns the caller's household's entitlements. The Account page shows "Your plan" with its name, any end date, and what it includes.
  - **Tests**: unit tests cover free, both paid tiers, every subscription status, active and expired grants, a plan together with a grant, overrides (expiry, lifting a limit, other households unaffected), missing limits, the seeded values, and the one-minute cache.

### B4a. Secure admin access
- **Goal**: A locked-down admin area exists *before* the first admin page (B5), so admin powers can never become a way into user accounts.
- **Steps**:
  1. An admin hostname from a new GitHub variable `ADMIN_HOSTNAME` (never hardcoded), served by the same Worker but only answering admin routes there.
  2. **Cloudflare Access** in front of the admin hostname *and* the preview Worker's admin routes (free for up to 50 users). Access checks you before any Fennl code runs.
  3. Admin role granted only by a database command (documented in a runbook). The Better Auth admin plugin's `set-role` permission is removed. No in-app path to admin.
  4. A dedicated admin account with a **passkey or hardware key** required (`@better-auth/passkey` plus a check that the session was created with a passkey).
  5. Short admin sessions (30 minutes idle, 8 hours max). Passkey re-confirmation for sensitive actions.
  6. Email alert to you on every admin sign-in.
  7. `admin_audit_log` (append-only) with a continuous copy to separate storage the console can't write to.
- **You check**:
  - Register your passkey and open the admin area (it works).
  - Try it from a private window without passing Cloudflare Access (blocked before Fennl loads).
  - Sign in as a normal test account (refused).
  - Receive the sign-in alert email.
- **Done when**: Tests prove non-admins, non-passkey sessions, and requests without Access are refused, and every admin action writes a log row.
- **Decisions**: Approve adding `@better-auth/passkey` (an auth dependency). Approved with the phase (2026-10-04).
- **Built (2026-10-04)**: owner setup in `docs/setup/b4a-admin-access.md`; the admin role runbook in `docs/runbooks/grant-admin-role.md`.
  - **Where the admin area lives**: the admin console is its own page (`admin.html`, `app/admin/`) at `/admin`. Every request now reaches the Worker first (`run_worker_first: true`), which keeps the admin area to its place:
    - In production, it exists only on `ADMIN_HOSTNAME` (a GitHub variable, never committed). Without the variable, the admin area is switched off.
    - On the app's address, admin paths are 404s. The admin address serves only the console, its API, sign-in and the built files; any other path redirects to `/admin`.
    - In previews and locally, the console is at `/admin`.
  - **Cloudflare Access**: checked in the Worker as well as at the edge. A request passes if Cloudflare's `ctx.access` names one of our applications, or if it carries a valid `Cf-Access-Jwt-Assertion` token. The token check means RS256 against the team's published keys (refreshed when keys rotate), our team as issuer, one of our audience tags, and not expired. With no Access settings everything is closed, except `ACCESS_DEV_BYPASS` on localhost for local development.
  - **The admin role**: Better Auth's admin plugin adds `user.role`. Its HTTP endpoints are closed, and its permissions leave out `set-role`, so the role comes only from a database command. The database writes every role change into the audit log by itself.
  - **Passkeys** (`@better-auth/passkey`) work only in the admin area, behind Access.
    - Only admins can register one. An admin with no passkey may add a first one from a password session (to set up), and after that only from a passkey session. The console has "Add a backup passkey".
    - Each session records how it was signed in (`session.auth_method`), and the admin API accepts only passkey sessions.
  - **Short sessions**: admin sessions end after 30 minutes without use (`session.last_active_at`) or 8 hours after sign-in; an expired session is deleted. `hasFreshPasskey` (sign-in within 5 minutes) is ready for B7's sensitive actions.
  - **Alerts**: every admin sign-in and new passkey is emailed to `ADMIN_ALERT_EMAIL`, with IP, country and browser.
  - **Audit log**: `admin_audit_log` refuses updates and deletes (database triggers). Each entry the Worker writes is also copied to the `fennl-audit` R2 bucket, which CI locks so objects can't be changed or deleted for 365 days. The console shows recent activity.
  - **Previews**: GitHub Actions uses an Access service token (`CF_ACCESS_CLIENT_ID/SECRET`) to check previews once they're behind Access. Without the token, the check accepts Access's sign-in redirect with a warning.
  - **Fixes from the owner's setup (2026-10-06)**: the Worker serves static assets, so Cloudflare doesn't pass it `ctx.access`. It now also reads Access's `CF_Authorization` cookie, as well as the `Cf-Access-Jwt-Assertion` header. Passkeys on `*.workers.dev` use the account subdomain as their relying-party ID, so one passkey works on every preview link.
  - **Tests**: Access tokens (valid, wrong audience, wrong team, expired, other keys, tampered, the local switch), the admin address rules, every admin check in order, idle and 8-hour expiry, passkey registration rules, the closed role endpoints, and the audit log (written, copied, alerted, append-only, and the database-side entries). A browser test runs the real flow with a software passkey: password sign-in, add a passkey, console, sign out, then passkey sign-in.

### B5. Invite and promo codes
- **Goal**: You can invite testers who get Premium free, and give promo codes that add free Premium for a while.
- **Steps**:
  1. `promo_code` table: code, name, plan (Individual or Household), how long Premium lasts, whether it can create an account, how many people can use it, last day to use it, turned off. `premium_grant` records each use.
  2. An admin page (inside B4a's secure admin area) to create codes, change them, see who used them, and turn them off.
  3. Sign-up accepts a code and gives the household Premium. The Account page takes codes too.
  4. Invite-only sign-up during the beta, as a switch in the admin console.
- **You check**: Create a code, sign up a second test account with it, and see Premium on its Account page. Move the code's date and see the account's date follow.
- **Done when**: Grants show up in the entitlement service; expired grants fall back to Free.
- **Decisions (2026-10-04)**:
  - Sign-up needs an invite code during the beta (invite-only). The admin console has the switch, for public launch.
  - A code gives Premium either **until a set date** (beta codes: everyone who used it keeps Premium until then, and moving the date moves it for all of them, so the beta's length can be decided later) or **for a number of days** from when each person uses it (promo codes), or with **no end date** (free Premium for good, for example for family; added 2026-10-05). Any code's Premium can be ended by turning the code off.
  - **Discounts on the price** (percent or amount off, months free then paid) are **Stripe promotion codes**, set up in the Stripe dashboard and typed on Stripe's checkout page (Stage I). Fennl's codes only give free Premium; they never touch money. Checked 2026-10-04 against Stripe's and Better Auth's docs: Stripe codes need a subscription (so they can't serve the beta), last a number of months rather than days, and Better Auth's Stripe plugin enables them with one setting (`allow_promotion_codes`).
- **Built (2026-10-04)**:
  - **Tables** (migration `0007`): `promo_code`, `premium_grant` (one row per person per code; a date code's grants follow the code's date, a days code's grants have their own end, and a code with neither has no end), and `app_setting` (app-wide switches; `0008` seeds invite-only sign-up **on**).
  - **Codes**: random codes look like `K7QX-M4TR-9WAZ` (no 0/O or 1/I, 60 bits). An admin can choose one instead, such as `SPRING-2027`. Matching ignores case and spaces. Codes are never deleted, only turned off.
  - **Using a code** takes one use with a single conditional update, so two people can't both take a code's last use, and each person can use a code once.
  - **Sign-up**: the page asks for the code first (`POST /api/sign-up/code` checks it and keeps it in a 30-minute cookie). Better Auth's "before creating a user" hook checks it again, whichever way the account is made (email, Google or Apple), so the check can't be skipped. Without a usable invite, no account is made. With sign-up open, the field is an optional promo code. Invite links can fill it in: `/sign-up?code=…`.
  - **Account page**: "Have a code?" (`POST /api/codes/redeem`). Code tries are limited to 10 per 10 minutes per visitor (sign-up) or account.
  - **Entitlements**: the household's best active grant (higher plan, then later end) is the `grant` input of `computeEntitlements`; `source` is `promo_code`. The plan card says "Included with your code until …".
  - **Admin console**: "Invite and promo codes" (list, new code, details with who used it, change the name, date, number of uses or last day, turn off with or without ending everyone's Premium) and "Sign-up" (the invite-only switch). Every change is in the audit log first.
  - **Tests**: 29 server tests (invite-only refusals, every code problem, the second check at account creation, the Google/Apple path, the last use, open sign-up, the Account page, best grant, expiry, rate limits, and every admin tool with its audit entry). Browser tests sign up with a code, use one on the Account page, and make one in the admin console (with accessibility checks).

### B6. Device registry and the one-device rule
- **Goal**: Free accounts work on one browser at a time; Premium on several.
- **Steps**:
  1. The browser creates a random device ID on first run.
  2. `POST /api/devices/register` and the `device` table (from `CLAUDE.md`).
  3. Free: a second browser sees a friendly "Use Fennl on this device instead?" screen. Takeover is instant (no cooldown), with light rate limiting.
  4. Premium: a device list in Settings with "sign out this device".
- **You check**: With a free account, sign in on your phone, then your laptop, and take over. With a beta account, use both at once.
- **Done when**: Tests cover register, over-limit, takeover, revoke, and eviction recovery (device ID lost).
- **Decisions (2026-10-06)**: keep the seeded limits for now: Free 1, Individual 5, Household 10 (`plan_limits`, editable from the admin console in B7).
- **Built (2026-10-06)**:
  - **`device` table** (migration `0009`): one row per person per browser (`id` is the browser's random ID; primary key with `user_id`), plus the household, a label like "Safari on iPhone" from the user agent, the sign-in session it last used, first and last seen, and `revoked_at` / `revoked_reason` (`taken_over`, `signed_out`, `replaced`). Revoked rows are kept.
  - **The browser** makes its ID on first run and keeps it in local storage (in memory where storage isn't allowed). On every app start it calls `POST /api/devices/register`; the app opens only when that says "ok".
  - **The limit** is the household's `max_devices` entitlement. Adding a device happens in one conditional statement (counting the household's active devices), so two new browsers can't both take the last place.
  - **Takeover** (`POST /api/devices/takeover`) is instant: it revokes the person's other devices (Free) or the ones they chose (Premium), deletes those devices' sign-in sessions, then registers this one. Light rate limit: 10 per 10 minutes.
  - **Eviction recovery**: a browser whose storage was cleared keeps its sign-in cookie, so a new ID arriving with a session that another active device row holds is the same browser. The old row is retired as `replaced`, with no takeover screen.
  - **Screens**: "Use Fennl on this device?" (Free) or "Choose a device to sign out" (Premium), both with "Sign out here instead". Settings › Devices lists the household's active devices, marks "This device", and signs others out (`GET /api/devices`, `POST /api/devices/:id/sign-out`).
  - **Admins using someone's account** (impersonation, C12) are never registered as a device.
  - Only a person's own devices can be signed out. Once households can have two members (G1), the count is household-wide.
  - **Tests**: 10 server tests (register, over-limit, takeover signing the other browser out, choosing to sign out instead, no cooldown, eviction, a kept ID after sign-out, two new browsers at once, Premium choice, the Settings list and its sign-out rules, rate limit, impersonation). Browser tests with two real browsers for both plans, with an accessibility check of the takeover screen.

### B7. Admin console: account tools
- **Goal**: You can help users and manage limits yourself.
- **Steps**:
  1. Find an account by email or name. The account page shows plan or beta grant, household and partner, sign-up and last-seen dates, devices, recipe count, storage used vs. limits, and any overrides.
  2. Password help: send a reset email (the default), or set a temporary password that must be changed at the next sign-in. Either can also sign the user out everywhere.
  3. Edit tier limits (`plan_limits`), e.g. free recipes 100 → 150.
  4. Per-account overrides (`limit_override`), with an optional expiry date and a note.
  5. Admin activity log viewer, filterable by account.
- **You check**:
  - Look up a test account.
  - Send it a reset email, then set a temporary password.
  - Change the free recipe limit and give one account an override.
  - See all of it in the log.
- **Done when**: Every tool is tested, and every action is logged with who, what, and when.
- **Later admin tools (not scheduled)**: revoke devices, mark an email verified, disable an account, delete on request, export on someone's behalf, stats, a site-wide announcement banner.
- **Built (2026-10-06)** (`worker/admin/accounts.ts`, `accountRoutes.ts`, `app/admin/`):
  - **Console sections**: Accounts, Codes and sign-up, Plan limits, Activity, Your admin account.
  - **Find an account** by part of its email or name (`GET /api/admin/accounts?q=`). Its page shows email and whether it's verified, sign-up and last-seen dates, sign-in methods, plan (and codes used), household and members, active devices, exceptions, and its own admin activity. Recipe count and storage say "counted once the recipe box exists" until Stage C. Opening an account is itself recorded (`account.viewed`).
  - **Password help**: a reset email (Better Auth's own, linking to the app's address even from the admin address: `APP_HOSTNAME` is now passed to the Worker), or a temporary password. Either can sign the account out everywhere (sessions ended, devices let go).
  - **Temporary password**: random, shown to the admin once, never logged or emailed. The person gets a "your password was reset by support" email. `user.must_change_password` (migration `0010`) makes the app show "Choose a new password" before anything else, and household routes refuse with `password_change_required` until `POST /api/account/password` succeeds. A reset from the email link clears it too. Admin accounts can't be given one.
  - **Limits**: tier limits (`plan_limits`, byte limits typed in MB, blank = no limit) and per-account exceptions (`limit_override`, with an optional end date and note). Other Worker instances pick up a tier change within a minute.
  - **Passkey again**: temporary passwords and every limit change need a passkey sign-in from the last 5 minutes; otherwise the console asks for the passkey (a fresh sign-in, which also sends the usual admin sign-in alert) and retries.
  - **Activity log**: newest 100, with admin and account emails; `?account=` shows one account's.
  - **Tests**: 12 server tests (admins only, search incl. literal "%", the account page and its audit, reset email and signing out everywhere, the app address for links, temporary password end to end incl. the forced change, passkey re-confirmation, admin accounts refused, a reset clearing the flag, exceptions, tier limits, the filtered log). A browser test runs the whole flow with a software passkey: find an account, add an exception, set a temporary password, the person changes it, and change a plan limit (with accessibility checks).

### B7a. Email changes, verified dates, and clearing out unverified accounts
- **Goal**: People can change their email safely; support can see every change and undo a takeover; mistyped sign-ups don't linger. (Owner's request, 2026-10-06, built ahead of H1 and H2.)
- **Decisions (owner, 2026-10-06)**:
  - An address someone types is always verified by a link before it's used. Addresses from Google and Apple were verified by them.
  - Every change is kept. An admin can put back an earlier address; that also signs the account out everywhere and sends a password reset email there.
  - An admin's change also waits for the link sent to the new address. Admin changes and restores ask for the passkey again.
  - An account never verified is removed 24 hours after sign-up. An email change that isn't verified within 24 hours expires, and the account keeps its address.
  - The wording is "verified" throughout, not "confirmed".
- **You check**:
  - In Settings › Email, change a test account's email. The account keeps its address until you open the link sent to the new one; then the old address gets a notice.
  - In the admin console, find that account. Search and its page say "Verified on <date>". Its "Email address" section lists the change; put the old address back.
  - (The hourly clean-up of unverified accounts runs on the live site only; the server tests cover it.)
- **Built (2026-10-06)** (`worker/account/`, `app/account/`, `app/auth/VerifyEmailChangePage.tsx`, `app/admin/AccountsSection.tsx`):
  - **Fennl's own email change** (Better Auth's stays off). `email_change` (migration `0011`) keeps every change: old and new address, who started it (the person or an admin), when, and whether it was verified, cancelled or replaced, or expired. A change waits for the link sent to the new address (24 hours); only the newest request works, and only while the account still has the address it started from. The link's secret is stored only as a hash.
  - **Settings › Email** (`POST /api/account/email`, `DELETE /api/account/email/pending`): shows the address and when it was verified, starts a change, cancels a waiting one. Needs a sign-in from the last day (otherwise: sign out and back in), 5 tries an hour, not while an admin is acting as the person. An address another account uses gets the same answer but no email, so it can't reveal who has an account.
  - **The link** opens `/verify-email-change`, which finishes the change (`POST /api/account/email/verify`, no sign-in needed: having the link proves the person reads the new address). The old address then gets "Your Fennl email address was changed", showing only part of the new address.
  - **Verified dates**: `user.email_verified_at`, set by every way an address gets verified (the sign-up link, Google or Apple, an email change). Existing Google and Apple accounts use their sign-up date; other existing accounts show "Verified (date not recorded)". Admin search results and account pages show "Verified on <date>" or "Not verified".
  - **Admin tools** (each recorded in the audit log first): change an account's email (`account.email_change_started`, waits for the link), cancel a waiting change (`account.email_change_cancelled`), put back an earlier address (`account.email_restored`). Admin accounts are refused. The account page shows the waiting change and the full history.
  - **Clearing out unverified accounts**: a Cron Trigger runs every hour (`wrangler.jsonc` "triggers"). It removes email-and-password accounts never verified 24 hours after sign-up, with their personal household (and any Premium from a code), sessions and devices, and gives their invite code's use back. Accounts that also sign in with Google or Apple, admins, and accounts with a waiting email change are left alone. Removals are written to the Worker's logs.
  - **Tests**: 15 server tests and 1 app test (verified dates; the change waits, switches and notifies; address checks; a taken address answers the same and sends nothing; taken while waiting; expiry; only the newest request; cancel; a fresh sign-in; unknown links; admin search; admin change, cancel and restore with sign-out and reset email; refusals and the passkey; removal after 24 hours with the code's use returned; what's left alone). Browser tests: changing your email from Settings and opening the link, a used link, and an admin putting back an earlier email (with accessibility checks).

### B8. Feedback: in-app form and admin inbox
- **Goal**: Testers can tell you what's wrong or what they'd like, and you can read and track it in the admin console. (Owner's choice, 2026-10-03: a phase of its own, not part of B7.)
- **Steps**:
  1. A "Send feedback" form in the app, reachable from every page (for example in Account and the menu). The person writes a message. The page they were on, the app version, and their browser and device are attached automatically.
  2. A `feedback` table: who sent it, their household, the message, those details, a status (new, read, done), and when. Never deleted by the person; kept for the beta.
  3. Admin inbox (inside B4a's secure admin area): newest first, filter by status, mark read or done, add a private note, and jump to the sender's account page (B7). Every change goes into `admin_audit_log`.
  4. A rate limit per person, and a size cap on messages.
- **You check**: Send feedback from a test account on your phone, find it in the inbox, open the sender's account, and mark it done.
- **Done when**: Sending, the inbox, status changes and the rate limit are tested.
- **Decisions**: Should each new message also email you (perhaps as a daily summary)? Replying from the inbox by email, and attaching screenshots (needs photo storage from Stage D), can come later.
- **Decided (owner, 2026-10-07)**: no emails to the owner; the inbox is where feedback is tracked. Replies go from the owner's own email app: "Reply by email" opens it with the sender's address, a subject and their message quoted. Each message shows where it stands: New, Read on (when first opened), Replied on (when "Reply by email" is clicked, with an undo, or marked by hand), Done.
- **Built (2026-10-07)** (`worker/feedback/`, `app/pages/FeedbackPage.tsx`, `app/admin/FeedbackSection.tsx`):
  - **Sending**: a "Send feedback" link in the sidebar on computers and "Feedback" in the top bar on phones (so every page), plus a card on the Account page. The page they came from, the app version (the commit's short ID, set at build time) and their browser go with the message (`POST /api/feedback`, behind `requireHousehold`). Up to 5,000 characters, 10 messages an hour per person; not while an admin is acting as the person.
  - **`feedback` table** (migration `0012`): sender, household, message, page, app version, browser (label and user agent), and `read_at`, `replied_at`, `done_at`, a private note. Where a message stands follows those dates (`shared/feedback.ts`).
  - **Inbox** (admin console › Feedback, `GET /api/admin/feedback?status=`): newest first, filters New / Read / Replied / Done / All with counts, and "Feedback (N new)" in the console's menu. New messages are highlighted with a dot. Opening one marks it read (`POST …/:id/read`). Each shows the details, **Reply by email** (a `mailto:` link that also marks it replied, with Undo), **Copy email address**, **Open their account**, Mark as replied / Undo, Mark done / Move back to the inbox, and a private note (`PATCH …/:id`). Each change is recorded in the audit log first (`feedback.read`, `feedback.updated`).
  - **Tests**: 7 server tests (saved with its details; sign-in and length checks; the hourly limit; admins only; new → read → replied (undo, first date kept) → done; replying or finishing counts as reading; bad changes refused) and 3 for the reply link and statuses. Browser tests: sending from a page (computer and phone), and the admin flow from the inbox to the sender's account, with accessibility checks.

## Stage C: The recipe core

### C1. Recipe data model
- **Goal**: Write down exactly what a recipe is, before any screens.
- **Steps**:
  1. A short document plus shared TypeScript types covering: title, description/headnote, ingredients (with section headings, original text, and parsed quantity/unit/item), directions (with section headings), prep/cook/total times, servings/yield, source (URL, name, author), notes, rating, difficulty, categories (nested, many per recipe), photos (many, one cover), linked sub-recipes on ingredients, nutrition (values plus where each came from), import provenance, and the sync columns (`updated_at`, `deleted_at`, `server_seq`).
  2. Check this covers every Paprika 3 field, so Paprika import loses nothing.
  3. Decide how per-field last-write-wins applies to lists (e.g. ingredients are one field in the beta; finer merging later).
  4. **Decide where recipes live on the server** (open question 7): check current Cloudflare D1 and Durable Object limits and pricing, and compare. Include the preview-link caveat from A3 (Durable Objects don't get preview URLs). The household ownership model (data owned per user, households only grant visibility) favors D1.
  5. Ownership columns from `CLAUDE.md` ("Recipe ownership in households"): `owner_user_id` on recipes, categories, and images; `updated_by_user_id`; and `copied_from` for copies kept after a split.
- **You check**: Read a one-page plain-English description of a recipe record and say if anything is missing.
- **Done when**: Types, validation rules, and the decision are merged.
- **Decisions**: D1 vs. Durable Object per household (I'll bring a recommendation with verified facts).
- **Decided (owner, 2026-10-07)**, after a detailed discussion (the full description is `docs/design/recipe-model.md`):
  - Ingredients and directions are **edited as one text box each** and come back exactly as left. Behind the scenes each line has its own ID, its text as written (the master copy), and how the ingredient reader understood it (E2).
  - Pasted bullets and step numbers are cleaned off. **Headings**: a line ending in a colon with no amount, a short ALL-CAPS line with no amount, or the heading button (which wins).
  - Sub-recipe links attach to a line and stay with it through light edits.
  - **Per person, shown to the whole household when present**: rating, favorite, and a signed note. One Notes section shows the recipe's notes, then each person's signed note.
  - **"Last made"** is in the beta: one tap at the end of cook mode, or "Made it" on the recipe page; one date for the household, with who made it.
  - Categories cover everything (cuisine, course, status such as "Untested"). **Diet labels** are categories under **"Diet"**, added automatically by imports that list them. No equipment or make-ahead fields.
  - Paprika notes import as the importing person's signed notes. The owner's ingredient lines may be used in automated tests.
  - **Line-by-line merging** of ingredient and direction lists is wanted later (Stage I); line IDs make it possible without changing data.
  - **Recipes live in D1** (open question 4, `CLAUDE.md` open question 7), in the same database as accounts for now, moving to per-owner databases if recipe data nears a few GB. Facts and reasoning: `docs/research/2026-10-07-recipe-storage.md`. The Paprika export format: `docs/research/2026-10-07-paprika-export.md`.
- **Built (2026-10-07)** (`shared/recipe.ts`, `shared/recipeLines.ts`):
  - Types for the recipe and its parts, per-person opinions (`RecipeOpinion`), "made it" records (`RecipeMade`), categories, recipe-category links and photos, all with the sync columns. `RECIPE_SCHEMA_VERSION` for the sync protocol, and `RECIPE_FIELDS`, the units "last change wins" applies to.
  - Validation (`recipeIssues`) reporting every problem by path; the per-recipe size limit is passed in from the plan limits, never hard-coded.
  - The text box ↔ lines conversion: cleaning, headings, and keeping IDs, heading choices, links and parsed readings for lines that are still there (unchanged, moved, or lightly edited).
  - Tables come in C3; nothing here changes the database yet.
  - **Tests**: 14, using real ingredient and direction text from the owner's Paprika library.

### C2. Local database trial on real devices
- **Goal**: Prove SQLite-in-the-browser works where your users are, before building on it.
- **Steps**:
  1. Small test page: create the local database, write 10,000 sample recipes, run full-text searches, reload, measure.
  2. Test on desktop Chrome, Safari (Mac), iPhone Safari (browser and installed to the home screen), Android Chrome.
  3. Check two open tabs at once, and what happens when storage is cleared.
  4. Check `navigator.storage.persist()` on each (**Unverified** item 3 in `CLAUDE.md`).
- **You check**: Open the test page on your own phone and computer and send me the results it shows.
- **Done when**: Results are recorded here, and SQLite/OPFS is confirmed or we switch to the fallback (IndexedDB via Dexie).
- **Decisions**: Approve the SQLite WASM library choice. Checked 2026-10-03: SQLite's official build with the `opfs-sahpool` storage mode needs no special server headers, works on Safari 16.4+, and is the fastest option. It allows one connection per database, so step 3's two-tab test decides how tabs share it.
- **Built (2026-10-07)** (`/storage-trial`, `app/trial/`, `storage-trial.html`):
  - Approved with the phase: SQLite's official browser build, `@sqlite.org/sqlite-wasm` 3.53.4 (no other packages), on the origin private file system through `opfs-sahpool`, in a background worker. Checked: its build includes full-text search (FTS5), and accent-insensitive matching works ("jalapeno" finds "jalapeño").
  - The page needs no sign-in and never touches an account. It writes made-up recipes about the size of real ones (2 to 3 KB of text each; 10,000 by default) with a full-text index, then times writing, five searches (words, a phrase, an accent, a word start), listing 50 by title and opening one. It also shows the browser, whether it was opened from the home screen, storage used and available, and whether the browser will keep the storage, with an "Ask to keep this storage" button, "Copy results", and "Delete the test recipes".
  - It has its own home-screen app description, so it can be installed to an iPhone or Android home screen and tested there.
  - A reload shows the recipes saved earlier. A second tab is refused ("Another tab has the test open") until the first closes, which confirms the one-connection limit; C4's "one tab runs sync" follows from it.
  - Baseline in this project's automated Chromium (not a real device): 10,000 recipes (23.5 MB of text) written in about 15 s; searches 6 to 12 ms; listing 50 by title 1 ms; opening one recipe under 1 ms.
  - **Tests**: a browser test (computer and phone sizes) writes 300 recipes, checks the searches including accents, the reload, the second-tab refusal and recovery, deleting, and accessibility.
  - Results from the owner's devices go in `docs/research/2026-10-07-storage-trial.md`.
- **Results (2026-10-07)**: Chrome on Mac, Safari on iPhone (iOS 27, home screen app), Firefox on Mac, Edge on Windows 11. **SQLite on OPFS is confirmed**; no fallback to Dexie. Details: `docs/research/2026-10-07-storage-trial.md`.
  - Every device wrote 10,000 recipes in 1 to 2 s, searched in under 15 ms at 20,000 recipes, and kept them after closing (on the iPhone, after a force-close).
  - A second tab was refused while the first had the database, and took over once it closed (Chrome, Firefox and Edge).
  - Keeping storage: granted in Chrome, in Firefox (after its own prompt) and in the iPhone home screen app; **not granted in Edge** in a tab. A browser tab can't count on it.
  - Not covered: Safari on Mac, Safari on iPhone in a tab, Android. Same engines as devices that passed; checked again in C4's device testing.
  - Carried into C4: one tab owns the database and the others work through it; encourage installing for Premium; a "new version is ready" prompt, since a home screen app has no reload button.

### C3. Server recipe storage and sync endpoints
- **Goal**: The server can accept and hand out recipe changes.
- **Steps**:
  1. Create the server tables (or Durable Object) chosen in C1.
  2. `POST /api/sync/push`: validate, check device and entitlement, check the access rule (the recipe's owner is in the caller's household), apply per-field last-write-wins, and assign `server_seq`. New rows are owned by the creator. D1 has no interactive transactions, so writes are batched or conditional.
  3. `GET /api/sync/pull`: return changes in batches (Paprika imports will be large), with one cursor per household member whose recipes the caller can see.
  4. Tombstones for deletes; client schema version check with an "please refresh" response.
  5. Free tier: reject large offline batches, per `CLAUDE.md`.
- **You check**: Nothing visible; tests only.
- **Done when**: Tests cover conflicts, deletes, batching, revoked devices, and wrong household.
- **Built (2026-10-07)** (`worker/sync/`, `shared/sync.ts`, migration `0013`):
  - **Tables**: `recipe`, `recipe_opinion`, `recipe_made`, `category`, `recipe_category`, and `sync_counter` (the last `server_seq` handed out). `recipe_photo` waits for images (D2) and `recipe_version` for history. Every row carries the recipe owner, so devices fetch per owner and access is "the owner is in your household".
  - **Sending** (`POST /api/sync/push`): up to 100 changes per push (4 MB): create or edit a recipe, Trash and restore, your own rating/favorite/note, "made it" (and taking it back), categories, and filing recipes in them. Each change is checked on its own; good ones are kept even if others in the same push are refused, and the answer says what became of each: kept, unchanged (the server had it or something newer), or refused (with the reason).
  - **Last change wins, field by field.** Each change says when it was made; the server corrects for a device whose clock is wrong (the push says when it was sent, by the same clock) and never accepts a time later than now. A field is kept only if its change is newer and different, inside one SQL statement per change, and a push runs as one batch, so there's no read-decide-write and sending the same push twice changes nothing.
  - **Ownership**: a new recipe or category belongs to its creator. A partner may create a category for the recipe owner (filing the owner's recipe under a category they don't have). A recipe can only be filed under its owner's categories, and a category's parent must have the same owner.
  - **Fetching** (`GET /api/sync/pull`): one cursor per person in the household; someone new starts at 0, and anyone who left is no longer listed. Pages of up to 500 rows (100 recipes, about 4 MB), with `more` saying to ask again. Tombstones (Trash, taken-back "made it", unfiled) come through like any other change.
  - **Refused**: no registered device, or one signed out or replaced (`device_revoked`); an app too old (`upgrade_required`) or newer than the server (`server_behind`); and, **without offline editing (Free), any change made more than 2 minutes before it was sent** (`offline_not_allowed`): Free saves go straight to the server, so an older change can only come from an offline queue. (This replaces "reject large offline batches": a size cap would also block Free's bulk category changes in C7. **Decided (owner, 2026-10-07).**)
  - Plan limits (recipe count, text and per-recipe size) are C11's; an admin acting as a user (C12) syncs without a device.
  - **Tests**: 16 server tests (devices, versions, malformed and oversized pushes; create and fetch once; per-change checks; field-by-field conflicts and repeated pushes; a wrong device clock; Trash and restore; Free's offline rule; another household can't see, change or claim; a shared household's edits, opinions, categories and "made it"; 250 recipes in pages) and 7 for the shared checks.

### C4. Client sync engine
- **Goal**: The browser keeps its local copy in step with the server.
- **Steps**:
  1. Local schema with migrations.
  2. Free path: save goes to the server first (1 to 2 second debounce); offline shows a banner and blocks edits.
  3. Premium path: save locally, add to an outbox, push in the background with retries.
  4. Pull on open, on focus, and on a timer.
  5. Only one tab runs sync at a time. Only one tab can open the local database (C2), so that tab owns it and other tabs work through it, with ownership passing on when it closes.
  6. Flush on page close; request persistent storage for Premium, and suggest installing to the home screen or dock where the browser won't promise to keep it (C2: Edge in a tab said no).
  7. A "new version is ready" prompt when a release is deployed, since a home screen app has no reload button (C2).
  8. Sync status indicator ("Saved to cloud" / "3 changes waiting").
  9. Wording that makes clear recipes live in your account, not the browser.
- **You check**: Edit on laptop, see it on phone (beta account). Go offline on a beta account, edit, reconnect, watch it sync. Go offline on a free account and see the banner.
- **Done when**: End-to-end tests cover both paths and a "local storage wiped" recovery.
- **Built (2026-10-07)** (`app/sync/`):
  - **The local copy**: SQLite (C2's choice) in a background worker, one database file per account. Each synced row is kept as the server's last copy plus the changes made here that the server hasn't confirmed, applied on top; when a newer copy arrives the waiting changes are applied to it again, so nothing typed here is lost. Local schema changes are numbered steps (`PRAGMA user_version`); if the recipe shape changes (`RECIPE_SCHEMA_VERSION`), the copy is downloaded again.
  - **Saving**: every change is written here and queued, then sent a moment later (a burst goes in one push); fetching follows. One code path for both plans; the `offline_enabled` flag decides the rest:
    - **Without it (Free)**: editing pauses, with a notice, while the browser is offline or a save is failing; it resumes when the save goes through. A change that had to wait is sent as made now (there's one device and editing was paused, so nothing newer can exist), which keeps C3's 2-minute rule for real offline queues.
    - **With it (Premium)**: changes wait while offline and go when the connection returns, retrying after 2 s, doubling to a minute. The browser is asked to keep the copy (`persist()`).
  - **Fetching**: on opening, when the app comes back into view, when the connection returns, and every minute while visible.
  - **Tabs**: the tabs agree through the browser's Web Locks which one owns the local copy; it runs syncing and the others ask it over a BroadcastChannel and hear when anything changes. When it closes, the next tab takes over (waiting for the files to be let go).
  - **Closing the page**: changes not yet sent go out with a `keepalive` request (up to 64 KB); the server ignores repeats, so they're simply sent again and confirmed next time.
  - **Status** in the app's frame: Connecting…, Saved to cloud, Saving N…, N changes waiting, Offline · N changes waiting. Notices for: a new version (`GET /api/version` compared with the page's own build, on opening, on coming back into view, and every 10 minutes; also when the server says the app is too old), Free editing paused, signed out, and a browser that can't keep a copy.
  - **Settings › This browser's copy**: what's kept here, and for Premium where the browser hasn't promised to keep it (and the app isn't installed), how to install it.
  - **Recipes page**: for now a simple list to try syncing: add a recipe by title, rename, move to Trash. C5 and C6 replace it with recipe pages and the editor.
  - **Not yet**: opening the app with no connection at all (no offline app files yet; an already-open app keeps working offline). Signing out leaves this account's copy in the browser (each account has its own file; signing in as someone else never shows it).
  - **Tests**: 7 for the merge logic; browser tests at computer and phone sizes: a recipe added on one device appears on another and an edit comes back; Premium offline changes wait and sync; Free pauses editing offline with a notice; a wiped browser gets everything back; two tabs share one copy and the second carries on when the first closes.

### C4b. Opening the app with no connection
- **Goal**: Fennl opens from the home screen (or a bookmark) with no connection, showing the recipes kept on the device. Added by the owner on 2026-10-07, after C4 left this open.
- **Steps**:
  1. Keep the app's own files (page, scripts, styles, fonts, icons) on the device with a service worker, refreshed with each release.
  2. Remember who's signed in and whether the plan allows offline editing, for use only when the server can't be reached.
- **You check**: Open Fennl on your phone, turn on Airplane mode, close it fully, and open it again: your recipes show. With Premium, add one, turn Airplane mode off, and watch it sync.
- **Done when**: Browser tests open the app offline on Premium and Free.
- **Built (2026-10-08)** (`app/offline/sw.js`, `vite.config.ts`, `app/auth/offlineSession.ts`):
  - **The app's files**: each build writes `/sw.js` with the list of its files (everything the app uses; not the admin console or the storage test). Installing keeps them all; a new release's worker takes over at once and removes the old files, and an open page offers to reload (C4).
  - **Pages** try the network first, so an online visit always gets the newest release; with no connection the kept page is used. The API, the admin area and the storage test never go through it.
  - **Who's signed in**: the app remembers the person's ID, name and email (never the sign-in itself, which stays in its cookie) and uses them only when the server can't be reached. When the server answers, its answer counts; signing out forgets them.
  - **The plan**: whether offline editing is allowed is remembered with the account, so an offline start lets Premium edit and keeps Free read-only. The server still decides every save.
  - Settings › This browser's copy now says the app opens offline (to read, on Free).
  - Fixed on the way: typing in "New recipe" right as the page opened could be lost when the list arrived.
  - **Tests**: browser tests at computer and phone sizes open the app with no connection: Premium sees its recipes, opens another page, adds one and it syncs when back online; Free sees its recipes with editing paused.

### C5. Recipe list and recipe page (reading)
- **Goal**: Browse and read recipes.
- **Steps**:
  1. Recipe list with title, cover photo placeholder, categories; sort options.
  2. Recipe page: all fields laid out for reading, including section headings, everyone's ratings, favorites and signed notes (only when present), and "Last made … by …" with a **Made it** button (C1).
  3. Empty state as in `docs/design/design-direction.md` ("Empty states"): a faint ghosted grid, a short welcome, **Add recipe** and **Import**. Import is shown to everyone; what it offers depends on the flags.
  4. A few sample recipes you can add to try it out.
- **You check**: Add the sample recipes; browse on phone and desktop.
- **Done when**: Pages pass accessibility and keyboard tests.
- **Built (2026-10-08)** (`app/pages/RecipesPage.tsx`, `app/recipes/`):
  - **List**: cards with a placeholder cover (the title's first letter, until photos in D2), title, categories and total time, "Not synced yet" while waiting, and in a shared household the name of whoever added it (handwritten). Sort by title, newest or recently changed, remembered on the device. "Add recipe" asked for a title (until C6's editor).
  - **Empty state** as designed: ghosted cards fading out behind "Your recipe box is empty, for now", **Add recipe** and **Import**, plus "Or add 4 sample recipes to try".
  - **Sample recipes**: four written for Fennl (Green Chile Stew, Buttermilk Pancakes, Black Bean Tacos with Lime Crema, Lemon Olive Oil Cake), with section headings, times, servings, a person as source, nutrition on one, and categories (including Diet › Vegetarian and Desserts › Cakes). They're ordinary recipes in the account.
  - **Recipe page** (`/recipes/<id>`): the source person's name (handwritten) above the title, headnote, prep/cook/total, makes, difficulty, categories, ingredients in a card with section headings, numbered method that carries on across sections, notes then each person's signed note, nutrition per serving with where it came from, and the source. Ratings, favorites and "Added by" show only when there's something to show (and "Added by" only in a shared household).
  - **Made it**: "Last made Oct 3 by Sam" (shared by the household), "Made it today", and Undo for your own of today. **Move to Trash** at the bottom (restoring comes with Trash, C9).
  - Fixed on the way: asking the local copy for one recipe could get the wrong ID (a clash in the message's field names).
  - **Not yet**: setting your own rating, favorite and note (C6); the Mine / Partner's / All filter (with sharing, G1).
  - **Tests**: formatting and samples (unit); browser tests at computer and phone sizes for the empty state and samples, sorting, the recipe page and Made it (kept after a reload, undo), ratings/favorites/signed notes when present, keyboard use, and a missing recipe, with accessibility checks.

### C6. Recipe editor (text)
- **Goal**: Create and edit recipes by hand.
- **Steps**:
  1. Fields for everything in C1 except photos, links, and nutrition (later phases).
  1b. Your own rating, favorite and signed note on the recipe page (shown since C5).
  2. Ingredient and direction editors: one text box each (C1), with a heading button and a live preview showing how each line was understood.
  3. Autosave through the sync engine; in-session undo.
  4. Keyboard-efficient: no mouse needed to add, reorder, or remove lines.
- **You check**: Write one of your real recipes from scratch on desktop, then fix a typo on your phone.
- **Done when**: Editor tests pass, including keyboard-only.
- **Built (2026-10-08)** (`app/recipes/RecipeEditor.tsx`, `editorSession.ts`, `editing.ts`):
  - **Where**: **Add recipe** opens a new recipe's editor (`/recipes/<new id>/edit?new`); a recipe's page has **Edit recipe** (`/recipes/<id>/edit`).
  - **Fields**: title, "About this recipe", ingredients, method, prep/cook/total time, serves, makes, difficulty, where it's from (website, cookbook, person or somewhere else, with the fields each needs) and notes. Times are typed as words ("1 hr 30 min", "90", "1½ hours", "20 min plus resting") and tidied when you leave the box. A web address gets its "https://" if it's left off. Nutrition, imported time wording and imported difficulty wording are kept as they are.
  - **Ingredients and method**: one text box each. Beside it (below on a phone), "How Fennl reads it": each line as it will be saved, section headings marked and steps numbered. Pasted bullets and step numbers are cleaned off. The **Heading** button turns the line you're on into a section heading or back (Fennl spots most headings by itself: "For the crust:", or a short line in capitals).
  - **Keyboard**: Enter adds a line, an ordinary delete removes one, **Alt+↑ / Alt+↓** (Option on a Mac) moves the line you're on, and Tab reaches every field and button in order.
  - **Saving**: a moment after you stop typing, the fields that changed go to the sync engine ("All changes saved" / "Saving…" at the top). A new recipe saves once it has a title. A field with a problem (a web address that isn't one, a time over a month) is marked and waits; the rest still save, and **Done** takes you to the problem instead of leaving. On Free with no connection, editing pauses with a notice and what was typed saves when the connection is back.
  - **Undo / Redo**: one save at a time, for as long as the editor is open (version history across sessions is Premium, later).
  - **Changes from elsewhere** while the editor is open: a field you're not editing takes the newer value; the one you're typing in keeps what you typed (and it saves over the other, last change wins).
  - **Yours** (step 1b), on the recipe page: your rating (1 to 5 stars, or none), "A favorite of mine", and your note, signed with your name and saved as you type. They show here rather than in the household's ratings and signed notes, which now list only other people's.
  - **Fixed on the way** (`app/sync/`): two quick changes to the same field (rating 4, then 5) could reach the server with the same time, and the first one stayed. Every change made on a device is now at least a millisecond after the one before, and Free's changes keep their order when stamped as sent.
  - **Tests**: line moves, the cursor's line, reading times, web addresses, saving, undo/redo, changes from elsewhere and pausing (unit); browser tests at computer and phone sizes: a whole recipe written with the keyboard alone, undo/redo kept after a reload, a problem holding back only its field, a typo fixed on a second device (a phone) reaching the first, your rating/favorite/note kept, and Free pausing offline then saving, with accessibility checks.

### C7. Categories
- **Goal**: Organize recipes.
- **Steps**:
  1. Nested categories (e.g. Desserts > Cakes); create, rename, move, delete.
  2. Several categories per recipe; type-to-filter picker.
  3. Select many recipes and add/remove categories at once, with a preview, a count, and undo.
  4. Filter the recipe list by category.
- **You check**: Set up your own category tree and file a handful of recipes.
- **Done when**: Category changes sync between devices.
- **Built (2026-10-08)** (`app/categories/`):
  - **One tree for the household**: categories with the same full path ("Desserts › Cakes", ignoring case) show as one, whoever owns them (CLAUDE.md, "Recipe ownership in households"). Renaming, moving or deleting one changes every person's category of that path. A recipe is always filed under its owner's category of that path, which is created for the owner if they don't have it. The rules are in `tree.ts`, which works out the changes and the changes that undo them.
  - **Categories page** (`/categories`, from "Categories" on the recipe list): add a category (type "Desserts > Cakes" for one inside another), and Rename, Move (into another category or the top level, never into itself) and Delete each one. Deleting also deletes the categories inside it and takes recipes out of them; the recipes stay. Every change shows in a bar with **Undo**. Each category shows how many recipes are in it (including the ones inside it), and the count leads to the list filtered by it.
  - **A recipe's categories** in the editor: chips with × to take it out, and a box to type in. The list narrows as you type, arrow keys move through it, Enter chooses, and a name that doesn't exist yet offers "New category: …".
  - **Filtering the list**: a Category menu (with counts) next to Sort by, including "Not in a category". A category includes the ones inside it. The choice is kept in the address (`/?category=Desserts`), so it survives a reload, and a recipe page's category chips lead there.
  - **Select**: cards turn into checkboxes ("Select all shown" too). **Add to a category** (find or create one by typing) and **Take out of a category** each say what they'll do, with counts ("Add 1 recipe to Weeknight? 2 already there will stay as they are."), before doing it, then offer **Undo**.
  - **Saving many changes at once**: the sync engine takes a batch of changes in one go (`saveMany`), all or nothing.
  - **Tests**: the tree, its counts and each kind of change, including two people's same-named categories (unit); browser tests at computer and phone sizes: a tree built, renamed, moved, deleted and undone with the keyboard; many recipes filed and taken out, with previews, counts and undo; the filter kept in the address; choosing categories in the editor by typing; and a category renamed on one device showing on another, with accessibility checks.

### C8. Search
- **Goal**: Fast search across the library.
- **Steps**:
  1. Full-text search over title, ingredients, directions, notes, source, categories.
  2. Filters (category, rating, has photo) and predictable ordering.
  3. Works offline (Premium) and stays fast at 10,000 recipes.
- **You check**: Search your recipes by an ingredient, a word in the notes, and part of a title.
- **Done when**: Search performance test passes at 10,000 recipes.
- **Built (2026-10-08)** (`app/sync/search.ts`, the recipe list):
  - **On the device**: search runs on the browser's copy (SQLite full-text search, FTS5), so it works offline and needs no server. The index holds each recipe's title, headnote, ingredients, method, notes (the recipe's own and everyone's signed notes) and source, and is updated whenever a recipe or note changes here or arrives from the server. Categories are matched by their paths at search time, so renaming one doesn't re-index its recipes. Added as step 2 of the local schema (`app/sync/schema.ts`), which indexes what's already on a device once.
  - **How it matches**: every word typed must be found somewhere in the recipe, as the start of a word ("chick" finds "chicken"), ignoring case and accents ("jalapeno" finds "jalapeño").
  - **Ordering (predictable)**: recipes with every word in the title come first, then the rest; each group in the chosen sort order. Cards found elsewhere say where ("Ingredients: 1 teaspoon ground cumin"), with the words marked.
  - **Filters**: Category (C7) and a new **Rating** filter (your own: favorites, 5 stars, 4 and up, 3 and up, not rated yet), together with the search. All three are kept in the address (`?q=`, `?category=`, `?rating=`), so a reload keeps them.
  - **"Has a photo"** waits for photos (D2), where it will be added.
  - **Big recipe boxes**: the list shows 100 recipes at a time, with "Show 100 more".
  - **Speed** (the done-when test, `app/sync/search.test.ts`): 10,000 generated recipes, searched for very common words, two letters, three words and a word not there. Each search took 60–135 ms on the test machine (the test allows 300 ms); indexing all 10,000 took about 5 seconds, which on a device is spread across the first download.
  - **Tests**: matching, accents, every-word, categories, title-first, where it matched, Trash and edits (unit, on the same SQLite build in memory); browser tests at computer and phone sizes for an ingredient, a note and part of a title, ordering, the address, a note written just now, the rating and category filters, and searching with no connection (Premium), with accessibility checks.

### C9. Trash and restore
- **Goal**: Deleting is safe and reversible.
- **Steps**:
  1. Delete moves a recipe to Trash (tombstone); restore from Trash.
  2. Trash is emptied automatically after **30 days** (decided). Each item shows "deleted forever in N days", with an "Empty trash now" button. Expunging wipes content and photos but keeps a minimal tombstone so every device removes it.
- **You check**: Delete a recipe on one device, see it go to Trash on the other, restore it.
- **Done when**: Deletes and restores sync correctly.
- **Built (2026-10-08)** (`worker/sync/trash.ts`, `app/recipes/TrashPage.tsx`):
  - **Moving to Trash and back** is the synced "deleted" change from C3. After **Move to Trash**, the recipe list says "Moved “Pozole” to Trash." with **Undo**. A recipe's page, while it's in Trash, says so, says when it will be deleted for good, and offers **Put back**.
  - **Trash page** (`/trash`, linked from the recipe list): each recipe with when it was moved and "Deleted for good in N days", **Put back**, and **Delete for good**; **Empty Trash** for all of them. Deleting for good always asks first ("This can't be undone") and needs a connection (the server does it). Anything waiting to be sent goes first, so a recipe just put back isn't deleted.
  - **Deleting for good** (`expunged_at`, migration `0014_trash.sql`): the recipe's content is wiped, and so are the household's ratings, notes, "made it" days and category links for it. The row stays as a tombstone with a new `server_seq`, so every device learns of it and drops its copy. Changes to it afterwards are refused. Photos and version history will be wiped too once they exist (D2, F-stage).
  - **After 30 days**: the existing hourly scheduled job (`wrangler.jsonc` triggers) now also deletes for good what's been in Trash more than 30 days.
  - Either partner can empty the household's Trash, as either can move recipes to it.
  - **Also**: "Your note" on a recipe's page now says "Saving…" and "Saved." (a browser test reloaded the page before the note's one-second save; people deserve to see it too).
  - **Tests**: emptying Trash (content wiped, other devices told, no coming back, ratings and notes wiped), emptying only named recipes and never another household's, and the 30-day job (server); the days-left wording (unit); browser tests at computer and phone sizes for Undo on the list, putting back from a recipe's page and from Trash, deleting one and all after a question, the deleted recipe's old address, and a recipe deleted on one device appearing in Trash on another and put back there, with accessibility checks.

### C10. Full-library export
- **Goal**: Users can always take their recipes with them.
- **Steps**:
  1. Export everything as a file: a machine-readable format (JSON) plus a human-readable one (e.g. HTML or Markdown per recipe), with photos once Stage D is in.
  2. Works for every account, including free and expired.
- **You check**: Export your library and open the file.
- **Done when**: An export, re-imported into a test account, reproduces the library (round-trip test).
- **Built (2026-10-08)** (`worker/export/`, `shared/exportFormat.ts`, Settings › Download your recipes):
  - **`GET /api/export`** downloads `fennl-recipes-<date>.zip` of every recipe the household can see (not those in Trash). It's open to every signed-in account, whatever the plan, lapsed included. It's built and sent a batch of recipes at a time, so a large library never has to fit in the Worker's memory.
  - **In the .zip**: `index.html` (every recipe, A to Z, with categories), a page per recipe in `recipes/` (plain HTML that opens in any browser and prints cleanly: headnote, times, servings, ingredients and method with their section headings, notes and signed notes, ratings, "made it", nutrition, source, who added it), and `fennl-recipes.json`: Fennl's export format (version 1): the recipes as stored, categories as paths, the household's ratings, notes and "made it" days, and people by name.
  - **Reading it back**: `importChanges` turns an export into changes for any account, with new IDs. The exporter's own ratings, notes and "made it" days come along; other people's stay behind (they can't be anyone else's). A Fennl-file import screen comes with Stage E's import, which reviews before saving.
  - **Photos** go in once there are photos (D2).
  - New dependency: **fflate** (zip, MIT, no dependencies of its own).
  - Moved the shared wording helpers ("1 hr 30 min", "Serves 6") to `shared/recipeText.ts` so the app and the export use the same ones.
  - **Tests**: the round trip (an export read into another account exports the same library: recipes, section headings, times, servings, source, nutrition, categories including empty ones, ratings, notes, "made it"); a library bigger than one batch; no export without signing in; an empty library (server); reading a file back, skipping what can't be read, and only the exporter's opinions (unit); a browser test downloading from Settings at computer and phone sizes, checking the contents page, the data, and a recipe page opened in the browser.

### C11. Limits, usage bar, and over-limit behavior
- **Goal**: Free limits are enforced kindly, and dropping to Free never loses anything.
- **Steps**:
  1. Enforce the limits from B4: Free 100 recipes (Trash excluded) and 3 MB of text (Trash included), plus the per-recipe cap. A hidden cap gives a plain message ("This recipe is unusually large").
  2. Storage usage bar in Settings ("87 of 100 recipes"), with a small version next to "New recipe" when near or over.
  3. Over the limit (beta grant expired, downgrade, or household split): everything stays readable, editable, deletable, and exportable. New recipes, imports, and uploads are blocked with a friendly message until usage is back under.
- **You check**:
  - Set the free limit to 5 in the admin console and fill a test account.
  - The bar warns, then blocks "New recipe".
  - Editing and export still work.
  - Delete one recipe and you can add again.
- **Done when**: Limit, override, and over-limit cases are tested.
- **Built (2026-10-08)** (`shared/limits.ts`, `worker/sync/push.ts`, `worker/limits/`, `app/limits/`):
  - **The limits** come from the household's entitlements (`plan_limits`, then `limit_override`), never from code: Free starts at 100 recipes, 3 MB of recipe text and 256 KB per recipe. **Recipes** counts those not in Trash. **Recipe text** counts every recipe's text, Trash included, until it's deleted for good. In a shared household both people's recipes count together.
  - **What's blocked**: only adding. A new recipe needs fewer recipes than the limit and text under the limit; putting one back from Trash needs room in the count (its text counted all along). Editing, rating, "made it", categories, moving to Trash and downloading always work, however far over. So an account that drops to Free keeps everything and can change everything; it just can't add until it's back under. Imports (Stage E) and photos (Stage D) will use the same rule.
  - **Each recipe's size**: a recipe can't grow past the per-recipe cap (a recipe already over it can still be edited, as long as it doesn't grow). The editor says "This recipe is unusually large, so changes can't be saved. Shorten it, or split it into two recipes." and keeps what's typed until it's shorter.
  - **Server** (`POST /api/sync/push`): a refused addition gets the answer `limit` (with which limit), and so does anything else sent for a new recipe that was turned away. Text is measured by the database itself: a computed column, `recipe.text_bytes` (migration `0015_usage.sql`), adds up each field as stored, the way `recipeBytes` does, and an index makes a household's totals quick to read. Both push and pull answers now carry the household's usage and limits.
  - **App**: knows the usage from every sync (and remembers it for the next start).
    - **Settings › Recipe storage**: "87 of 100 recipes" and "1.2 MB of 3 MB of recipe text" as bars, and why adding is blocked when it is.
    - **Beside "Add recipe"**, from 80% of a limit: the bar and a "Recipe storage" link. When full or over, "Add recipe" explains instead of opening the editor ("You have 100 recipes, as many as your plan includes. To add another, move one you don't need to Trash. Everything you have stays yours to read, change and download."). The same goes for the empty page's buttons, a new recipe's address, and **Put back** in Trash and on a recipe's page.
  - **A recipe in Trash can be read in full** on its page (ingredients, method, notes and the rest), since it may have to wait there for room; before, its page showed only the title. Nothing on it can be changed until it's put back.
  - **Nothing typed is lost**: if the server turns away a new recipe anyway (the limit changed while it was being written, or a partner added one meanwhile), the device keeps it, marked "Not synced yet", with a notice that it's saved as soon as there's room. It goes as soon as there is.
  - The admin console's limit editing (B7) already changes all of this without a deploy. Tier limits are cached for up to a minute per server instance; household overrides apply at once.
  - **Tests**: server tests for the count (with Trash, putting back, Premium unlimited, an override, a shared household), text (measured as `recipeBytes` measures it; Trash counting until deleted for good), over the limits (everything editable, adding refused until there's room) and the per-recipe cap (including a recipe already over it); unit tests for the rules, the wording and the editor's size cap; browser tests at computer and phone sizes for the owner's check (limit of 5: the bar warns, then blocks; editing and download still work; Trash makes room; putting back needs room), an account over its limit, a new recipe turned away and kept until there's room, and an unusually large recipe, with accessibility checks.

### C12. Admin: act as user (impersonation)
- **Goal**: Help users and investigate abuse by seeing and acting exactly as they do.
- **Steps** (rules in `CLAUDE.md`, "Admin console"):
  1. "View as this user" from B7's account page. A reason is required (stored only in the admin log), with passkey re-confirmation.
  2. At least the user's full abilities. Every change is attributed to you in the admin log.
  3. **Silent**: nothing appears in the user's activity, devices, or sign-in history, and no sign-in emails go out. Password and email changes still send the standard security email.
  4. Passkey re-confirmation for password, email, deletion, and household actions.
  5. Ends automatically after 30 minutes, with a bright "Acting as …" banner. Other admins can't be impersonated.
  6. Never counts as a device and never triggers takeover. Saves go straight to the server. The user's data loads into a separate local copy that's wiped on exit.
  7. Email alert to you when impersonation starts.
- **You check**:
  - Act as a test account and edit a recipe.
  - The change appears on that account's own device with no sign of impersonation.
  - Exit, and the log shows your reason and the edit.
- **Done when**: Tests cover the blocked and silent behaviors, the device rules, and the log.
- **Built (2026-10-08)** (`worker/admin/impersonation.ts`, `app/acting/`, the console's account page):
  - **Starting**: an account's page in the console has **View as this user**, with a reason (5 to 500 characters, kept only in the admin log) and the passkey again (a passkey sign-in in the last 5 minutes, as for password and limit changes). Admin accounts can't be acted as. It's recorded first ("Started acting as them", with the reason), then the owner gets an email ("Fennl admin is acting as a user"), then Better Auth's admin plugin makes a session for the person, marked as the admin's, that ends after 30 minutes. The admin's own session waits behind it.
  - **Where it runs**: in production, on the admin address, behind Cloudflare Access. That address now serves the app's pages and APIs, but only to a session acting as someone (anyone else still gets only the console). Its cookies and browser storage are the admin address's own, apart from the app's address. In previews and locally it's the same address as the app.
  - **The bar**: every page shows "Acting as Petra Ng (petra@…). Every change is recorded under your name in the admin log. Ends at 4:45 PM." with **Stop acting as Petra Ng**. At the end time it leaves by itself.
  - **Every change in the log**: anything that changes their data, recorded under the admin before it's made (no record, no change). Sync changes are listed without recipe text ("recipe 1a2b3c4d edited: notes"). This happens in `requireHousehold`, which every household route already goes through, so new routes are covered too.
  - **The console's tools, not the app's**: while acting, the app can't change the password or email, send feedback, or use Better Auth's own account endpoints (only signing out, which ends acting). Those stay with the console's tools, which already ask for the passkey again (steps 3 and 4). Deleting an account and household actions don't exist yet; when they're built, they must be refused while acting and done from the console, with the passkey asked again.
  - **Silent**: nothing goes to the person. No device is registered and takeover never starts. The session is left out of their own session list, and out of "Last seen" in the console. Recipes they see were changed by them, as far as the app shows.
  - **Saves go straight to the server**, even on Premium (nothing queues). The app keeps a separate copy of their recipes for the visit (not their own copy, and not the admin's), empty at the start and wiped, file included, on the way out. Nothing about the account is remembered in the browser (for an offline start, the plan or usage).
  - **Stopping**: "Stopped acting as them" is recorded, Better Auth puts the admin's own session back, and the console opens on the person's account, where the log shows the reason and every change. In the console, the log now shows each entry's reason and what changed. While a browser is acting as someone, the console says so and offers to go back or stop.
  - **Tests**: server tests for starting (reason, passkey again, never an admin, not for others, not through Better Auth's own endpoint); acting (silent: no device, no email, not in their session list; straight to their account; each change logged under the admin with what changed; the console waits); refusals logging nothing; nothing queued even on Premium; ending by itself after 30 minutes; the admin address serving the app only while acting; and other changes (a color scheme) logged too. A browser test runs the owner's check: act as an account and edit a recipe; it shows on their own device with no banner and still one device; stop; the log shows the reason and the edit; the browser's app is the admin's own again. With accessibility checks.

## Stage D: Photos and images (Premium)

### D1. Image storage
- **Goal**: Store images safely in R2.
- **Steps**:
  1. Create R2 buckets (staging, production); no public access.
  2. Upload endpoint: entitlement check, per-file size limit, household quota, content-hash naming.
  3. Serve images only through the Worker, only to the owning household, with long caching.
  4. `image` table (owned per user, so photos follow their recipe in a household split). A household's quota is the sum over both members' images, computed from the `image` rows like recipe usage (C11) rather than kept in a separate `household_usage` counter, which would drift when someone joins or leaves (decided in D1, 2026-10-09).
  5. The starting quotas are already in `plan_limits` (migration `0016`; all editable from the admin console, per-account exceptions in `limit_override`):

     | Limit | Individual | Household | Trial |
     | --- | --- | --- | --- |
     | `image_quota_bytes` | 5 GB | 10 GB | 500 MB |
     | `image_quota_count` | 15,000 | 30,000 | 2,000 |
     | `image_max_file_bytes` | 5 MB | 5 MB | 5 MB |

     Beta grants get the full Individual or Household values (the trial values are for trials only). The trial is 500 MB so a Paprika library (about 250 MB of photos) can finish importing while someone is deciding to subscribe.
  6. Checks on every upload, on the server (never trust the browser's compression): allowed image type only, file signature (magic bytes) matches, size under `image_max_file_bytes`, upload rate limit per user and household. The same image uploaded twice (same content hash) counts once.
     - **Upload rate limits (Decided 2026-10-09)**: **120 uploads per minute per user** and **6,000 per day per household**. The per-minute limit stops a runaway or abusive client, and a 1,000-photo Paprika import still finishes in about 8 to 9 minutes. The daily limit means filling a 15,000-photo quota takes an attacker at least 3 days. Cost isn't the reason (R2 writes cost about $4.50 per million, by memory: verify); the photo-count quota is the hard cap. Rejected uploads (wrong type, too big, bad signature) count toward both limits.
     - Kept as `plan_limits` keys (for example `image_uploads_per_minute`, `image_uploads_per_day`), so they're editable from the admin console and `limit_override` can give one account an exception. They are never hard-coded.
     - Over the limit, the Worker answers HTTP 429 with a retry-after time, and the client waits and carries on by itself (the Paprika import already resumes, E13).
     - Unverified, check at the start of D1: whether Cloudflare's rate-limiting binding suits the per-minute window (it is meant for short windows and counts per location). The daily count goes in D1.
  7. At 80% of the quota show a warning; at 100% block new photos only. Nothing is ever deleted for being over quota.
- **You check**: Nothing visible yet; tests only.
- **Done when**: Tests prove other households and free accounts can't upload or read.
- **Built (2026-10-09)**: `image` table (migration `0017`); rate-limit keys (`0018`); `worker/images/` (`POST /api/images/upload`, `GET /api/images/:hash`); the private `IMAGES` R2 bucket (`wrangler.jsonc`, CI creates it). 22 server tests cover free and foreign households, file type by signature, size, quota (bytes, count, simultaneous uploads, shared households), rate limits, lapsed accounts and removed photos. Not yet: the app (D2), cleanup of removed photos' R2 files and the usage reconcile (D3).
- **Decisions**: ~~Starting image quotas~~ Settled 2026-10-08 (table above), reviewed again after D2 with real photo sizes. Cost basis: R2 storage is $0.015 per GB-month, egress free (Cloudflare pricing page, checked 2026-10-08), so 5 GB is about $0.08 per month.

### D2. Photos on recipes
- **Goal**: Add, view, and manage recipe photos.
- **Steps**:
  1. Add photos from the camera or files; resize and compress in the browser first, so nobody sees a loss in quality (starting settings, confirmed by the side-by-side test below):
     - Dish photos: longest edge at most 2400 px, WebP quality about 85. Never enlarge.
     - Web images from import: keep the file as downloaded if it is 2400 px or smaller and under about 1 MB; only re-encode larger ones.
     - GIFs (animated or not) are kept as they are, since the server accepts them (decided 2026-10-09: converting would lose the animation for a small saving). A GIF over the file-size limit becomes a still image (its first frame), and the person is told.
     - Cards, cookbook pages and screenshots (text and handwriting): longest edge at most 3000 px, WebP quality about 90 or higher.
     - Every photo: apply the camera's rotation, convert to sRGB, strip location data, resize with a high-quality resampler (not the default canvas scaling). If the re-encoded file is larger than the original, keep the original.
     - Encoder (researched 2026-10-09): Safari, on the Mac and the iPhone, can't make WebP from a canvas (it quietly gives a PNG). At equal quality a JPEG is about 1.4 times the size of a WebP (owner's test photos), so the owner approved a WebAssembly WebP encoder, `@jsquash/webp` (libwebp, Apache-2.0), run in a background worker (`app/photos/`). Checked with the photo test page, `/photo-trial` (like C2's storage test; also installable to the Home Screen): on an iPhone 18 Pro it encoded a cookbook page in under half a second, and Safari's JPEG was 1.7 to 1.9 times its size (`docs/research/2026-10-09-photo-trial.md`). **Decided 2026-10-09: the WebAssembly encoder on every browser**; the browser's own JPEG only if it can't load.
     - Photos are drawn through an `<img>` element (browsers turn it upright from its EXIF data) onto a canvas no larger than the result: iPhones refuse canvases over about 16.7 million pixels, and the owner's iPhone 18 Pro takes 24.5 MP photos. Only the pixels are stored, so the location in a camera photo never leaves the device.
     - Adding photos (decided 2026-10-09): on phones and tablets (any brand, judged by touch, not by brand), two buttons: "Take photo" opens the camera directly, and "Choose photos" picks one or more from the library or files. Computers get "Choose photos" and drag and drop. Two buttons because Chrome on Android 14 and 15 is reported to leave the camera out of a plain photo picker. The scanner-style multi-page capture is E9.
     - Very large photos (some Android phones take 200 MP): sized from the file's header first, and opened at a reduced size so a phone doesn't run out of memory.
     - Side-by-side test: run 10 to 20 real photos (food, a handwritten card, a cookbook page, a screenshot) through the settings and compare them at full size. The owner judges; the numbers stay adjustable.
  2. Many photos per recipe; pick the cover; reorder.
  3. Photos load lazily and are cached locally.
  4. Free accounts see a clear "Photos are a Premium feature" message.
- **You check**: Take a photo of a dish on your phone, add it to a recipe, see it on your laptop.
- **Done when**: Photo flows pass tests on phone and desktop sizes.

### D3. Image housekeeping
- **Goal**: Keep storage tidy and quotas honest.
- **Steps**:
  1. Delete orphaned images when recipes are permanently deleted.
  2. Scheduled job that reconciles `household_usage` against R2.
  3. R2 rule to clean up incomplete uploads.
  4. Add photos to C11's usage bar (households see the combined total and each member's share).
  5. 90-day photo grace period after dropping to Free: reminder emails (proposed at 30, 7, and 1 days left), then deletion. Resubscribing (or a new grant) cancels it.
- **You check**: Account page shows your photo usage.
- **Done when**: The reconcile job is tested.

## Stage E: The import engine (headline feature, Premium)

Import quality is the core of the product, so this stage starts by building a way to **measure** quality, then improves it with evidence.

### E1. Import foundations and the quality test set
- **Goal**: A common shape for imported recipes, and a scorecard.
- **Steps**:
  1. A "recipe draft" format that every importer produces, with a confidence level per field and a record of where each piece came from.
  2. `import_job` table: who, when, source type, status, draft, result recipe.
  3. **Quality test set**: you supply a sample of real inputs (around 30 web pages you care about, 20 card photos, 10 cookbook pages, 10 screenshots, a few PDFs, your Paprika export). I write the "correct answer" for each with you.
  4. A scoring tool that compares importer output to the correct answers field by field (title, each ingredient, each step, times, servings...).
- **You check**: Collect the samples (I'll give a checklist), and spot-check a few correct answers.
- **Done when**: The scorer runs in CI and prints a quality report.
- **Decisions**: Which sites and cards go in the test set. Private family cards stay private (the test set is not published).

### E2. Ingredient and quantity parser
- **Goal**: Understand ingredient lines like "1 ½ cups (190 g) flour, sifted" or "2–3 large eggs".
- **Steps**:
  1. Parse quantity (fractions, unicode fractions, ranges, decimals), unit, item, and notes.
  2. Keep the original text and link every number to where it appeared, including weights in parentheses.
  3. A large test suite of real-world ingredient lines.
- **You check**: A page where you can type ingredient lines and see how they're understood.
- **Done when**: The parser passes the test suite. (It's reused for scaling in Stage F.)

### E3. Structured web recipe extraction
- **Goal**: Read recipes from web pages that publish structured recipe data (most big recipe sites do).
- **Steps**:
  1. Read Schema.org recipe data (JSON-LD, then microdata).
  2. Clean up text: fractions, temperatures, section headings, line breaks, attribution.
  3. Diet labels the page lists (Schema.org `suitableForDiet`, or keywords like "gluten-free") become categories under **Diet** (C1).
  4. Pick up to 3 likely photos, with the best one as the cover.
  5. Run against saved copies of the test-set pages (no live fetching in tests).
- **You check**: Read the quality report for the web pages.
- **Done when**: Structured-data pages score at an agreed level on the scorecard.

### E4. Import review screen
- **Goal**: Every import is reviewed before it's saved. Nothing is ever silently added or overwritten.
- **Steps**:
  1. Side-by-side: the source (page snapshot or photo) next to the editable draft.
  2. Highlight fields with low confidence.
  3. Easy fixes: move a line from ingredients to directions, split or merge lines, fix fractions and temperatures.
  4. Pick which photos to keep; choose the cover.
  5. Duplicate check against the existing library ("This looks like a recipe you already have").
  6. Save creates the recipe, keeps provenance, and syncs.
- **You check**: Review and save a draft from the test set.
- **Done when**: Review flow passes keyboard and phone-size tests.

### E5. Chrome extension: skeleton and sign-in
- **Goal**: A Fennl button in Chrome that knows who you are.
- **Steps**:
  1. Manifest V3 extension with a toolbar button.
  2. Link the extension to your Fennl account securely (no password typed into the extension). The extension never collects passwords for recipe sites.
  3. Show "Premium required" for free accounts.
  4. Installable by testers from a private link or developer mode during the beta.
- **You check**: Install the extension, sign in through it, see your name.
- **Done when**: Sign-in linking is tested.
- **Decisions**: Publish to the Chrome Web Store as "unlisted" for the beta, or install manually?

### E6. Extension sends pages to Fennl
- **Goal**: Click the button on a recipe page and land on the review screen.
- **Steps**:
  1. The extension captures the page as you see it (including logged-in content) and sends it to the Worker.
  2. The Worker runs the extractor from E3 and creates an import job.
  3. The extension opens the review screen (E4) in Fennl.
  4. Chosen photos are downloaded and stored in R2, so recipes don't rely on the original site.
- **You check**: Import 5 recipes from sites you actually use, including one you're logged into.
- **Done when**: Works end to end on the web test set.

### E7. AI provider layer and cost controls
- **Goal**: A safe, swappable way to call Claude.
- **Steps**:
  1. Provider interface: "turn this text/image/PDF into a recipe draft", always returning the same draft format (E1). Claude is the first implementation.
  2. **Swappable by design**: the model name (and provider) comes from one config setting, never hardcoded in import code. Prompts and output validation sit above the provider interface, so changing models does not mean rewriting them. No other part of the app talks to an AI vendor directly.
  3. API key stored as a Worker secret; never sent to the browser or extension.
  4. `ai_usage` table: every call metered per household (tokens, model used, cost estimate).
  5. Monthly per-household cap and a global daily spending alarm.
  6. Start with **Claude Haiku**. Check current Anthropic model names and prices at this point and record them here.
  7. A "model comparison" script that runs the E1 quality test set through any configured model and prints accuracy and cost side by side. Used to decide whether to move up to a bigger Claude model (for example for handwriting) or to try Gemini or OpenAI later.
  8. Check the vendor's data-retention and training terms for API data, and note them for the privacy policy (H2).
- **You check**: Create an Anthropic API key (I'll guide you) and add it to the Worker. See usage on the admin page.
- **Done when**: Caps and metering are tested with a fake provider.
- **Decisions**: Monthly AI import cap per household for the beta; monthly spending alarm amount. (Provider and starting model are already decided: Claude Haiku, swappable.)

### E8. AI fallback for web pages without structured data
- **Goal**: Import from blogs and sites that don't publish recipe data.
- **Steps**:
  1. If E3 finds nothing (or something incomplete), send cleaned page text to the AI layer.
  2. The AI returns the same draft format, with confidence marks.
  3. Measure on the test set; compare quality and cost.
- **You check**: Import from a recipe blog with no structured data.
- **Done when**: Scores for unstructured pages meet an agreed level.

### E9. Photo capture and upload for import
- **Goal**: Get photos of cards and pages into Fennl comfortably, especially on a phone.
- **Steps**:
  1. Take photos with the phone camera or pick files; several per recipe (front/back, multi-page).
     - Capture (owner's request, 2026-10-09): a scanner-style live camera inside Fennl, to photograph page after page and then tap Done, since the phone's own camera hands back one photo per opening. In a Safari tab on an iPhone 18 Pro the live view gave 12 MP pictures, sharper than the phone's camera opened from a page (`docs/research/2026-10-09-photo-trial.md`). The phone's own camera stays as the fallback (and wherever the live view fails, such as a Home Screen app if the iOS 26 sideways reports hold).
  2. Reorder, rotate, crop, or remove pages before reading.
  3. Originals are compressed lightly (to stay readable: longest edge at most 3000 px, WebP quality about 90 or higher, see D2) and stored in R2; they count toward the quota.
- **You check**: Photograph a two-sided card on your phone and arrange the pages.
- **Done when**: Upload flow works on iPhone and Android.

### E10. Reading handwritten cards and printed pages
- **Goal**: Turn photos into a draft recipe.
- **Steps**:
  1. Send the page images to the AI layer with instructions tuned for recipe cards and cookbook pages.
  2. Keep line breaks and sections; separate the headnote (the story) from the directions; mark uncertain words.
  3. Review screen shows the photo next to the transcription with uncertain words highlighted.
  4. The original photo stays attached to the saved recipe.
  5. Measure on the card and cookbook test sets.
- **You check**: Import three of your hardest handwritten cards.
- **Done when**: Card and cookbook scores meet an agreed level.

### E11. Screenshots
- **Goal**: Import from screenshots of social posts, texts, and emails.
- **Steps**:
  1. Same path as E10, tuned for screenshots (ignore app chrome, usernames, like counts).
  2. Several screenshots can make one recipe.
- **You check**: Import a recipe from an Instagram caption screenshot.
- **Done when**: Screenshot scores meet an agreed level.

### E12. PDF import
- **Goal**: Import from PDFs, including ones with many recipes.
- **Steps**:
  1. Text PDFs: read the text directly (cheap). Scanned PDFs: treat each page as a photo.
  2. Detect where one recipe ends and the next begins; let the user adjust the split.
  3. Review recipes one by one, or accept several at once.
  4. Limits on PDF size and page count.
- **You check**: Import a multi-recipe PDF.
- **Done when**: PDF test set passes.
- **Decisions**: Maximum PDF size/pages for the beta.

### E13. Paprika 3 import
- **Goal**: Move a whole Paprika library into Fennl, losing nothing.
- **Steps**:
  1. Read the `.paprikarecipes` export file: a zip of gzipped JSON recipes, checked against a real export on 2026-10-07 (`docs/research/2026-10-07-paprika-export.md`). Still to check with the owner's files: how subcategories and the owner's own (or several) photos export. Paprika notes become the importing person's signed notes.
  2. Map every field, categories (including nested), photos, and ratings; keep Paprika's IDs so re-importing updates rather than duplicates.
  3. Preview: "1,240 recipes, 980 photos, 45 categories. 3 problems found."
  4. Import in batches, with progress, that can resume if the tab closes.
  5. Photos go to R2 within the quota; warn before going over.
  6. Check that the file really is a Paprika export, by its structure and never by its name or extension. All checks run on the server (the browser may pre-check for a faster message, but is never trusted), in this order, before anything is saved:
     1. **File type**: the zip file signature (magic bytes) must match.
     2. **Zip safety**, before unpacking: limits on the number of entries, the total unpacked size, and the compression ratio, so a small file can't expand into gigabytes (a "zip bomb"). Also a cap on how many recipes one import can add (the free-account cap is in `CLAUDE.md`, "Import sources").
     3. **Entries**: only entries ending in `.paprikarecipe` are read. If none match, reject the whole file ("This doesn't look like a Paprika export", for example a zip of images). If some match and others don't, ignore the extras and say so in the preview.
     4. **Gzip**: each recipe entry must decompress, with a cap on the unpacked size of each.
     5. **JSON**: each must parse and have the required fields (`uid`, `name`, and ingredients or directions). An entry that fails is listed as a problem in the preview and not imported.
     6. **Embedded photos**: the base64 photos (`photo_data` and others) are decoded and go through the same checks as any upload (allowed image type, file signature, size limit, D1 step 6), so an import can't bypass the image rules.
     7. Nothing is saved until the preview is reviewed, so a bad file can't write anything. The checks show a file is shaped like a Paprika export, not that Paprika made it; the recipes still go through the usual limits, quotas and review.
- **You check**: Import your real Paprika library and spot-check 20 recipes against Paprika. Also try a zip of images and a text file renamed `.paprikarecipes`: both are rejected with a clear message.
- **Done when**: Your library imports completely and a second import creates no duplicates. Tests cover the rejected files (a zip of images, a zip with the right entry names but bad JSON, a zip bomb, a corrupt gzip entry).
- **Decisions**: What to do if a library is bigger than the photo quota. The numbers for the zip limits (entries, unpacked size, compression ratio) and per-entry size, to set against your real 827-recipe, 39 MB library so it passes comfortably.

### E14. Import quality round
- **Goal**: Fix the worst problems found so far, by the numbers.
- **Steps**:
  1. Run the full scorecard; list the worst fields and sources.
  2. Fix the top issues (prompt changes, parser fixes, site-specific handling only where justified).
  3. Re-run and record the before/after numbers here.
- **You check**: Read the before/after report.
- **Done when**: Agreed quality targets are met, or the gaps are written down as known issues.

## Stage F: Cooking features

### F1. Scaling and unit conversion
- **Goal**: Change servings and switch units.
- **Steps**:
  1. Scale by servings or by a factor (½×, 2×, custom).
  2. Only scale numbers that can safely be scaled; show which were scaled and which weren't, so a weight in parentheses never contradicts the main amount.
  3. Convert between US and metric (volume and weight where sensible).
- **You check**: Double a recipe and convert it to metric.
- **Done when**: Scaling tests cover tricky cases (ranges, parenthetical weights, "a pinch").

### F2. Pan-size scaling
- **Goal**: "I have a 9×13 pan, this recipe is for 8×8."
- **Steps**:
  1. Common pan shapes (round, square, rectangle, loaf, bundt...) with area or volume math.
  2. Show the calculated factor and a note about baking times.
- **You check**: Scale a cake recipe to a different pan.
- **Done when**: Pan math tests pass.

### F3. Linked sub-recipes
- **Goal**: "1 cup BBQ sauce" can link to your BBQ sauce recipe.
- **Steps**:
  1. In the editor, search for and link a recipe to an ingredient.
  2. On the recipe page, expand the linked recipe in place, or open it.
  3. Detect loops (A links B links A) and cap how deep expansion goes.
  4. Deleting a linked recipe keeps the ingredient text and flags the broken link.
  5. Scaling the parent does not silently scale the sub-recipe.
- **You check**: Link a sauce to a main dish and expand it.
- **Done when**: Loop and deletion tests pass.

### F4. Nutrition
- **Goal**: Store and show nutrition.
- **Steps**:
  1. Per-serving values, entered by hand or imported (e.g. from Paprika or a web page), with their source recorded.
  2. A setting to hide nutrition everywhere without deleting it.
  3. Automatic calculation is not in the beta.
- **You check**: See nutrition on an imported recipe; hide it in Settings.
- **Done when**: Nutrition data survives import, edit, and export.

### F5. Cook mode
- **Goal**: Comfortable cooking from a phone or tablet.
- **Steps**:
  1. Big-text, one-step-at-a-time view; screen stays on (where the browser allows).
  2. Ingredients used in each step shown with that step, with amounts (scaled if scaling is on).
  3. Tap a time in a step ("bake 25 minutes") to start a timer; several timers at once.
  4. Check off ingredients and steps.
  5. At the last step, one tap answers "Made it today?" (C1's "last made").
- **You check**: Cook a real recipe from your phone.
- **Done when**: Cook mode works on iPhone and Android, keyboard-only on desktop.

### F6. Print view
- **Goal**: A clean printed recipe.
- **Steps**:
  1. Print layout with title, sections, source, scaling state, optional notes and nutrition.
- **You check**: Print a recipe (or save as PDF).
- **Done when**: Print layout tested in Chrome and Safari.

## Stage G: Premium sharing and history

### G1. Households: invite and join (merged recipe box)
- **Goal**: Two people share one recipe box (rules decided 2026-10-03; see `CLAUDE.md`, "Recipe ownership in households").
- **Steps**:
  1. Invite one person by email (max 2 members, enforce `max_members`).
  2. On joining, both people's devices download the other's recipes. Nothing is moved or copied on the server, and every recipe keeps its owner.
  3. Beta grants on joining: handled as decided in open question 15.
- **You check**: Invite a second test account. After accepting, both see one combined recipe box.
- **Done when**: Membership tests pass, including limits.
- **Decisions**: Open question 15.

### G1a. Merged categories and ownership labels
- **Steps**:
  1. Same-named categories show as one. Tagging a partner's recipe uses (or quietly creates) the owner's category of that name.
  2. "Added by <name>" on the recipe page, and a Mine / Partner's / All filter.
- **You check**: Both accounts have "Desserts". It appears once and holds both people's desserts. Filter to "Partner's".

### G1b. Equal-partner editing
- **Steps**: Either member can edit any recipe (per-field last-write-wins). Deleting a partner's recipe sends it to Trash, where either can restore it.
- **You check**: Edit the same recipe from both accounts. Delete your partner's recipe and restore it from the other account.

### G1c. Leaving and splitting
- **Steps**:
  1. Leaving or being removed starts the split. Each person first sees the partner's recipes (search, select all) and picks which to keep a copy of. Copies are new recipes they own, photos included.
  2. Each person returns to their own recipe box (their recipes plus copies). The partner's recipes disappear from their devices, and edits from a removed member's devices are refused.
  3. Anyone now over free limits follows C11's rules (nothing deleted, additions blocked).
- **You check**: Split two test accounts, keeping three copies. Each account shows the right recipes, and the copies are editable.
- **Done when**: Two-user tests cover conflicting edits, tagging a partner's recipe, delete and restore across members, a split with copies, a cut-off device, and re-joining after a split.

### G2. Version history
- **Goal**: See and restore earlier versions of a recipe.
- **Steps**:
  1. Save a snapshot on each meaningful change (not every keystroke).
  2. View past versions with differences highlighted.
  3. Restore creates a new version; history is never erased.
- **You check**: Edit a recipe a few times and restore an older version.
- **Done when**: History syncs and restore is tested.
- **Decisions**: How long history is kept.

## Stage H: Beta launch readiness

### H1. Abuse limits
- Rate limits on sign-up, sign-in, takeover, import, and uploads. Confirm the C11 limits are set correctly in production. Email verification required.
- Accounts never verified are removed after 24 hours (built early, in B7a).

### H2. Privacy, terms, and account deletion
- Plain privacy policy and terms (you supply or approve the wording; I'm not a lawyer). They cover the 100-recipe free limit, the 90-day photo grace period, 30-day Trash, and a general statement that Fennl staff may access accounts for support and to investigate abuse (covering silent impersonation). Self-service account deletion that removes D1 rows, recipes, and R2 images.
- **Acceptable use and illegal imagery (owner's request, 2026-10-08)**: the privacy policy and terms must include an acceptable-use section covering what may be uploaded (recipe-related photos only, no illegal content), that Fennl may remove content and suspend accounts that break the rules, how content is reported and removed, and what Fennl does about illegal imagery, including image scanning and legal reporting. The wording depends on the outcome of open question 21, so settle that first. Also state what photos are sent to third parties (the AI vendor, see the data-retention note above).
- Changing the account email was built early, in B7a.

### H3. Backups
- Checked 2026-10-03: D1 Time Travel restores to any minute in the last 30 days on **Workers Paid** (7 days on Free), but it overwrites the whole database. So the nightly per-household text export to R2 is required, since it's the only way to restore one account. A tested restore drill on staging.
- **Decision**: Confirm the Cloudflare account is on Workers Paid ($5/month) before real users arrive (open question 17).

### H4. Monitoring
- Error reporting and logs from the Worker and the app; alerts for errors and AI spend.
- **Decisions**: Which error-reporting service, if any (Cloudflare's built-in logs may be enough for the beta).

### H5. Beta rollout
- Production deploy on your domain, invite the first testers (feedback form from B8), and a short tester guide.

## Stage I: After the beta (outline only; detailed when we get there)

Not detailed yet on purpose. Each becomes its own set of phases later.

1. Stripe billing: Individual and Household plans, Stripe Tax, checkout (with Stripe promotion codes for discounts, decided in B5), customer portal, trials with a card up front, dunning (past due), cancel and resubscribe (`CLAUDE.md` unverified item 4). Includes the household billing rules in `CLAUDE.md`: payer keeps the plan, a joiner's value converts by money, and splits are proportional then equal, via Stripe credit balance. Also the impersonation billing limits (cancel and downgrade only).
2. Lapsed subscriptions: the over-limit rules and 90-day photo grace period are decided (built in C11 and D3 for expiring beta grants). Remaining: anything specific to paid lapses.
3. Moving beta testers onto paid plans.
4. Paste-a-link web import (reuses E3 and E8).
5. Phone share-button import.
6. Extensions for Edge, Firefox, Safari.
7. Manual "clip a field" fallback in the extension.
8. Social and video import.
9. Grocery list and meal planner.
10. Automatic nutrition calculation.
11. Live updates between household devices (Durable Object WebSocket, `CLAUDE.md` Phase 2).
12. Household "smart merge" beyond per-field last-write-wins, starting with line-by-line merging of ingredient and direction lists (owner's request, 2026-10-07; line IDs from C1 make it possible).

## Open questions tracked by this plan

Things to decide before the phase listed. Items already in `CLAUDE.md` are not repeated here.

| # | Question | Needed by |
| --- | --- | --- |
| 1 | ~~Domain and subdomain for the app~~ Decided: `beta.fennl.app`, stored only in `APP_HOSTNAME` | A1 |
| 2 | ~~Email-sending service~~ Decided: Resend, behind a swappable function | B2 |
| 3 | ~~Invite-only sign-up during beta? Beta grant length?~~ Decided 2026-10-04: invite-only; each code sets its own length (until a date, or a number of days) | B5 |
| 4 | ~~D1 vs. Durable Object for recipe storage~~ Decided 2026-10-07: D1 (`docs/research/2026-10-07-recipe-storage.md`) | C1 |
| 5 | ~~Trash retention days~~ Decided: 30 days, then auto-expunge | C9 |
| 6 | ~~Beta image quotas~~ Settled 2026-10-08 (D1); revisit after D2 | D1 |
| 7 | Quality test set contents and target scores | E1 |
| 8 | Chrome Web Store unlisted vs. manual install | E5 |
| 9 | AI cap per household and spending alarm | E7 |
| 14 | Should free accounts get a few "teaser" AI imports? (Owner undecided; revisit later) | Before public launch (Stage I) |
| 10 | PDF size and page limits | E12 |
| 11 | Paprika libraries larger than the photo quota | E13 |
| 12 | ~~Joining a household with existing recipes; leaving one~~ Decided: merged view, owners kept, copies on split | G1 |
| 13 | Version history retention | G2 |
| 15 | Beta grants and households: when two granted users join, whose grant covers the household? On a split, does each keep their own remaining grant? (Suggest: the household uses the longer grant; on a split each keeps their own original grant end date.) | G1 |
| 16 | Free structured import vs. the 100-recipe limit: a free user importing a 1,240-recipe Paprika library. Import up to the remaining allowance, with a clear message? (Suggest: yes, show the rest in the preview as "needs Premium".) | E3, E13 |
| 17 | ~~Is the Cloudflare account on Workers Paid ($5/month)?~~ Yes: switched on 2026-10-03 (B2 setup, step 1) | H3 (before H5) |
| 18 | ~~Should Cloudflare Access cover the whole preview Worker?~~ Decided 2026-10-03: yes, as part of B4a (not sooner) | B4a |
| 19 | ~~Changing an account's email address~~ Decided 2026-10-06: verify the new address first, notify the old one, keep every change so support can restore an earlier address. Built in B7a | B7a |
| 20 | ~~How long before an account never verified is removed?~~ Decided 2026-10-06: 24 hours from sign-up. An unverified email change simply expires after 24 hours. Built in B7a | B7a |
| 21 | Illegal imagery in stored photos (researched 2026-10-08). Cloudflare's free CSAM Scanning Tool compares images served through the Cloudflare cache against known-material lists (fuzzy hashing, so near-copies match), emails the owner daily, and blocks serving with an HTTP 451. Limits: it is unconfirmed whether images served by a Worker from R2 are scanned (the docs only say "served through the Cloudflare cache"); it scans only when an image is served, not at upload; it stops serving but does not delete the file from R2 or the `image` table; it only finds known material; and the legal duty to report stays with Fennl. To settle before public launch: (a) ask Cloudflare support whether Worker-served R2 images are covered, and turn the tool on either way; (b) if not covered, decide whether to check uploads against a hash-matching service instead; (c) an admin action to remove an image and suspend an account, recorded in `admin_audit_log` (admin console, C12 style); (d) legal advice on reporting duties. Not needed for the invite-only beta | Before public launch (H2) |

## Notes: AI provider research (2026-10-01)

Why Claude Haiku first, and what else was considered. Prices came from third-party roundups, not vendor pages, so they are **Unverified**; E7 re-checks them.

- **OCR services (Google Cloud Vision, Document AI)** only turn pixels into text. They don't understand recipes, so a second step (usually an AI model) would still be needed. Cloud Vision is about $1.50 per 1,000 images; Document AI Form Parser is about $30 per 1,000 pages and is built for invoices and forms. **Not used.**
- **Multimodal AI models** read the image or PDF and return structured data in one call, which suits handwriting, cookbook layouts, and screenshots. Candidates:
  - **Claude Haiku**: about $1 / $5 per million input / output tokens. **Chosen to start.**
  - **Gemini Flash**: similar or cheaper (introductory pricing runs to the end of 2026, then rises). Strong at reading documents. The main alternative to test.
  - **OpenAI GPT models**: comparable; no clear advantage found.
  - **Cloudflare Workers AI** open vision models: cheapest and fits the stack, but likely weaker on messy handwriting and cookbook layouts.
- **Rough cost**: a photo or page is about 1,500 input tokens and the recipe about 1,000 output tokens, so about half a cent per recipe or less on Haiku or Gemini Flash (an estimate). A 500-recipe import would cost a few dollars, so cost is not the deciding factor; accuracy is.
- **Plan**: build the provider layer so models are interchangeable (E7), measure on the real test set (E1), and change models only when the numbers say so (E14).

## Progress

| Phase | Status |
| --- | --- |
| A0 | Approved 2026-10-01; done when the `CLAUDE.md` update is merged |
| A1 | Done 2026-10-01: access check green (token, account, `terrastak.workers.dev`, D1, R2, `fennl.app` routes; no existing `beta` DNS record) |
| A2 | Done 2026-10-01 (merged) |
| A3 | Done 2026-10-01: PR #4 green (check, preview) with a working preview link. The first production deploy runs when it merges |
| A4 | Done 2026-10-03 (merged; live on the beta site) |
| A5 | Done 2026-10-03 (merged; live on the beta site) |
| B1 | Done 2026-10-03 (merged; staging and production databases created by CI) |
| B2 | Done 2026-10-03 (merged; live on the beta site with Resend email. Google and Apple wait on their setup steps) |
| B3 | Done 2026-10-03 (merged; live on the beta site) |
| B4 | Done 2026-10-03 (merged; live on the beta site) |
| B4a | Done 2026-10-05 (merged with B5; live). Owner's Access setup and admin accounts done 2026-10-06 |
| B5 | Done 2026-10-05 (merged with B4a; live, sign-up invite-only) |
| B6 | Done 2026-10-06 (merged; tested on the preview) |
| B7 | Done 2026-10-06 (merged; live) |
| B7a | Done 2026-10-06 (merged as #19; live) |
| B8 | Done 2026-10-07 (merged; live) |
| C1 | Done 2026-10-07 (merged) |
| C2 | Done 2026-10-07 (merged; tested on the owner's Mac, iPhone and Windows PC: SQLite on OPFS confirmed) |
| C3 | Done 2026-10-07 (merged; live) |
| C4 | Done 2026-10-07 (merged; the owner checked syncing between a Mac and an iPhone) |
| C4b | Done 2026-10-08 (merged; the owner opened Fennl offline on an iPhone and synced afterwards) |
| C5 | Done 2026-10-08 (merged; live) |
| C6 | Done 2026-10-08 (merged; the owner wrote a recipe on a computer and fixed a typo on a phone, on the preview) |
| C7 | Done 2026-10-08 (merged; live; the owner set up categories and filed recipes on the preview) |
| C8 | Done 2026-10-08 (merged; live; the owner searched by an ingredient, a note and part of a title on the preview) |
| C9 | Done 2026-10-08 (merged; live; the owner deleted on one device and put back on another, on the preview) |
| C10 | Done 2026-10-08 (merged; live) |
| C11 | Done 2026-10-08 (merged; live; the owner checked the limit of 5 on the preview) |
| C12 | Approved 2026-10-08; built, waiting for review |
| All others | Not started |
