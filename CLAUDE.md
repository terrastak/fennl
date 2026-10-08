# Fennl: architecture notes

Fennl is a modern, local-first recipe web app (Paprika 3-style feature set, aiming to be better). Cloudflare-based backend, subscriptions for individuals and 2-person households.

Read this file before making architecture, data-model, auth, billing, or sync decisions. If a task would contradict something marked **Decided**, stop and ask. Items marked **Leaning** are the current plan but can change. Items marked **Open** or **Unverified** must not be treated as settled.

The step-by-step build plan is in `spec.md`. Work happens one approved phase at a time; do not start a phase the owner has not approved.

## Status legend

- **Decided**: the owner has chosen this.
- **Leaning**: current working plan, not final.
- **Open**: needs a decision.
- **Unverified**: a factual claim that came from research or general knowledge and must be checked against current docs before relying on it.

## Stack

| Concern | Choice | Status |
| --- | --- | --- |
| Hosting / API | Cloudflare Workers | Decided |
| Relational data | Cloudflare D1 (auth, billing state, household membership, device registry, quotas) | Decided |
| Images | Cloudflare R2, gated behind paid tier | Decided |
| Auth | Better Auth (self-hosted in the Worker; D1 via Drizzle; organization plugin for households) | Decided |
| Sign-in methods | Email and password (confirmed email required), Google, Apple. Settings in `worker/auth/options.ts` | Decided (B2) |
| Email sending | Resend, only through the one `SendEmail` function in `worker/email/` | Decided (B2) |
| Workers plan | Workers Paid ($5/month): password hashing needs about 90 ms of CPU, the free plan allows 10 ms per request, and 30-day database backups need it | Decided (switched 2026-10-03) |
| Database access and migrations | Drizzle (schema in `worker/db/schema.ts`, migrations in `worker/db/migrations`, applied by Wrangler) | Decided (B1) |
| Billing | Stripe Billing + Stripe Tax, via Better Auth's Stripe plugin | Decided |
| Recipe store | D1, same database as accounts for now; per-owner databases if recipe data nears a few GB (`docs/research/2026-10-07-recipe-storage.md`) | Decided (C1, 2026-10-07) |
| Live updates between devices | Durable Object per household as a coordinator only, never the store | Open (sync Phase 2) |
| Local data layer in the browser | SQLite compiled to WASM (`@sqlite.org/sqlite-wasm`, `opfs-sahpool`) on OPFS, in a worker, with full-text search. Only one tab can open it at a time | Decided (C2, 2026-10-07; tested on real devices, `docs/research/2026-10-07-storage-trial.md`) |
| AI recipe reading (photos, PDFs, pages without structured data) | Anthropic Claude API, starting with Claude Haiku, called only from the Worker, behind a swappable provider interface | Leaning (see "AI import") |
| Sync framework | LiveStore | Open, not adopted. Beta-stage, event-sourced, would reshape the whole data layer. Revisit if it matures |

Stripe is the billing engine and Fennl is the merchant of record. A merchant-of-record provider (Paddle, Lemon Squeezy, Polar) was considered as an alternative for tax handling. Revisit only if tax filing becomes a burden.

## Core principle

**The cloud is the source of truth. The browser copy is a disposable cache.**

Browsers can evict local storage (OPFS, IndexedDB) without the user doing anything wrong. That is unacceptable for user recipes, so no data may exist only in the browser longer than a short sync window. Losing the local copy must cost the user nothing but a re-download.

UI copy should say: recipes are stored in your account, and the browser keeps a temporary copy for speed. Never imply data lives in the browser.

## Tiers

### Free (Leaning)

- Single user, **one active device**.
- Text-only recipes. **No image uploads, no R2 access.**
- **Limits (Decided 2026-10-03):** 100 recipes (Trash doesn't count) and a **3 MB hard cap on recipe text** per account (Trash counts). Every tier has a per-recipe size cap (about 256 KB, Leaning). Premium text caps: 50 MB Individual, 100 MB Household. All limits live in the D1 `plan_limits` table, with per-account exceptions in `limit_override`. Both are editable from the admin console without a deploy. **Never hard-code limits.** Effective limit = an unexpired account override, else the tier limit.
- Server-first writes: a save goes to the server immediately; the local store is a read cache. Editing requires a connection.
- No offline edit queue, no multi-device sync.
- Basic in-session undo only.
- Full-library text export is always available.

### Premium (Leaning)

- Many devices (soft cap, value TBD, roughly 5 to 10) with continuous sync.
- Offline editing: changes queue locally and sync later.
- Images stored in R2, subject to quotas.
- Households: two members sharing one library, with merging of both members' changes.
- Recipe version history and saved undo across sessions.
- Import (Paprika and others). Idea under consideration: let free users preview an import and require an upgrade to commit.

### Plans (Leaning)

- **Individual**: monthly and annual price, 1 seat.
- **Household**: monthly and annual price, flat price, **2 seats**. Do **not** use per-seat billing; use a flat plan with a seat limit.

Exact prices: Open.

### Beta scope (Decided for the invite-only beta)

The first release is an **invite-only beta**. Invited testers get Premium free (see "Beta grants"); Stripe billing is built after the beta, before public launch.

- In the beta: import (see "Import sources"), multiple photos per recipe with a cover photo, nested categories (several per recipe), linked sub-recipes, nutrition (stored and shown; no automatic calculation), scaling and unit conversion, pan-size scaling, cook mode.
- After the beta: grocery list, meal planner, automatic nutrition calculation, paste-a-link and phone share-button import, extensions for other browsers, social and video import.
- One web app for phone and computer equally, installable to the home screen.

## Entitlements model (Leaning)

Every user gets a personal **household** (a Better Auth organization) at signup. Recipes are **owned by a user** and **shared through a household** (see "Recipe ownership in households"). A Household plan lets a second member join. An Individual plan is a household with a seat limit of 1. A free account is a household with no subscription.

The **subscription attaches to the household** (Stripe plugin with organization customers). Entitlements are derived from the household's subscription, so every endpoint checks one thing: the household's current entitlement.

**Beta grants (Decided for the beta).** Entitlements are derived from the household's subscription **or from a beta grant**. A beta grant comes from an invite code and gives a household Premium for a set period. It is one more input to the same entitlement computation, not a separate code path. When a grant expires and there is no subscription, the household falls back to Free.

**Invite and promo codes (Decided 2026-10-04, built in B5, `worker/codes/`).** Beta invites and promo codes are the same thing: a `promo_code` that gives a household free Premium (Individual or Household) **until a set date** (moving the date moves it for everyone who used the code), **for a number of days** from each use, or with **no end date** (ended only by turning the code off). Each use is a `premium_grant` row; the household's best active grant is the grant input above (`source: promo_code`). A code may or may not allow creating an account. **Sign-up is invite-only during the beta** (the `sign_up_requires_code` switch in `app_setting`, changed from the admin console); Better Auth's user-creation hook enforces it for every sign-in method. **Price discounts are Stripe promotion codes** (Stage I), never Fennl codes: Fennl codes never touch money.

Derived entitlement fields (computed server-side by `householdEntitlements` in `worker/entitlements/`, never trusted from the client; built in B4):

- `tier`: `free` | `individual` | `household`, plus `source` (`free`, `subscription`, `promo_code`), `trialing`, `past_due`, and `ends_at`
- `max_members`: 1 or 2
- `max_devices`: 1 for free, a cap for Premium
- `max_recipes`, `max_text_bytes`, `max_recipe_bytes`: the recipe limits (`null` means no limit)
- `images_enabled`: boolean
- `image_quota_bytes`, `image_quota_count`, `image_max_file_bytes`: values Open
- `offline_enabled`, `history_enabled`: booleans
- `import_structured_enabled`, `import_ai_enabled`: booleans. Import is gated by what it costs, not by source. See "Import sources".

Subscription statuses to handle: active, trialing, past_due (dunning: do not remove members or shrink limits while payment is retried), canceled, and resubscribed after cancellation.

### Recipe ownership in households (Decided 2026-10-03)

- **Every recipe, category, and image has a permanent owner** (`owner_user_id`, the person who created it). Edits by a partner never change the owner.
- **A household is a sharing group, not a container.** Members see the union of all members' recipes as one recipe box. Joining or leaving changes visibility only; no recipe rows are moved or rewritten.
- **Equal partners:** either member can edit any recipe. Deleting a partner's recipe moves it to Trash, where either member can restore it.
- **Subtle ownership:** "Added by <name>" on the recipe page, and an optional Mine / Partner's / All filter.
- **Personal opinions (Decided 2026-10-07):** rating, favorite and a signed note are stored per person (`recipe_opinion`) and shown to the whole household only when present ("★★★★ Brian · ★★★ Sarah"). "Last made" is shared, with who made it (`recipe_made`).
- **Categories merge by name:** same-named categories (case-insensitive, full path such as "Desserts › Cakes") show as one. A recipe's category links always point to the *recipe owner's* categories. Tagging a partner's recipe uses the owner's category of that name, creating it if missing. Built in C7 (`app/categories/tree.ts`): editing a merged category (rename, move, delete) edits every person's category of that path.
- **Splitting:** each person leaves with the recipes they own. Before the split completes, each can choose partner recipes to keep a **copy** of: a new recipe with a new ID, owned by the keeper, recording `copied_from`. Photos are copied with it.
- A user belongs to at most one shared household at a time. While shared, their active household is the shared one and their personal household is dormant. After a split they return to their personal household.
- Open: how beta grants combine when two granted users join, and what each keeps on a split (`spec.md` open question 15).

### Household billing rules (Decided 2026-10-03; applies once Stripe billing exists, Stage I)

- **The original payer keeps the plan** after a split (and may switch it to Individual).
- **Joining with a paid plan:** the joiner's unused prepaid value is converted into value on the Household plan, and their own subscription ends. Convert by **money, not days**, since the plans cost different amounts.
- **Splitting:** while the original combined money is still being used, the remaining value is split in the proportion each partner contributed when they combined. Once that money is used up and the plan has renewed, any remaining time is split **equally**. Because the joiner's value extends the *end* of the paid period, remaining value is never a mix of the two.
- The other partner's share becomes credit toward their own plan. Record contributions in `household_plan_contribution` so the split math is auditable.
- Leaning mechanism: **Stripe customer credit balance**, not pushing renewal dates with `trial_end`, because a `trial_end` extension makes the subscription read as "trialing". The Better Auth Stripe plugin has no credit support, so this is custom Stripe code. Tax treatment of credits is Unverified.

### Tables (D1)

Better Auth owns user, session, account, verification, organization, member, and invitation tables. The Stripe plugin owns the subscription table. Fennl-owned tables:

| Table | Purpose | Key columns |
| --- | --- | --- |
| `device` | Device registry for the one-device free limit and Premium cap (built in B6, `worker/devices/`) | `id` (client-generated, random; primary key with `user_id`), `household_id`, `user_id`, `label`, `session_id`, `first_seen_at`, `last_seen_at`, `revoked_at`, `revoked_reason` |
| `household_usage` | Quota tracking (a shared household's quota is the sum of its members' owned images) | `household_id`, `image_bytes`, `image_count`, `updated_at` |
| `image` | One row per stored image per owner | `hash` (content hash), `owner_user_id`, `bytes`, `content_type`, `created_at`, `deleted_at` |
| `recipe` | Recipe records (C1: `shared/recipe.ts`, `docs/design/recipe-model.md`; built in C3, `worker/sync/`). Ingredients and directions are lists inside the record (JSON), every line with its own ID | `id` (UUID), `owner_user_id`, `copied_from`, one column per `RECIPE_FIELDS` field, `import`, `field_times` (when each field last changed), `created_at`, `updated_by_user_id`, `updated_at`, `deleted_at`, `server_seq` |
| `recipe_opinion` | One person's rating, favorite and signed note on a recipe; shown to the household (C3) | `recipe_id`, `user_id`, `owner_user_id` (the recipe's), `rating`, `favorite`, `note`, `field_times`, `updated_at`, `deleted_at`, `server_seq` |
| `recipe_made` | "Made it" records; the latest is the household's "last made" (C3) | `id`, `recipe_id`, `user_id`, `owner_user_id` (the recipe's), `made_on`, `updated_at`, `deleted_at`, `server_seq` |
| `recipe_version` | Premium version history | `id`, `recipe_id`, `snapshot`, `created_at`, `author_user_id` |
| `category` | Nested categories, owned per user and merged by name in the household view (C3) | `id` (UUID), `owner_user_id`, `parent_id`, `name`, `sort_order`, `field_times`, `updated_at`, `deleted_at`, `server_seq` |
| `recipe_category` | Recipe-to-category links (many per recipe) (C3) | `recipe_id`, `category_id`, `owner_user_id` (the recipe's), `field_times`, `updated_at`, `deleted_at`, `server_seq` |
| `sync_counter` | One row: the last `server_seq` handed out, shared by every synced table (C3) | `id`, `value` |
| `recipe_photo` | Photos on a recipe, incl. kept import originals (built with D2, since it needs images) | `id` (UUID), `recipe_id`, `image_hash`, role (cover, photo, import original), sort order, `updated_at`, `deleted_at`, `server_seq` |
| `import_job` | One row per import attempt | `id`, `household_id`, `user_id`, source type, status, draft, provenance, resulting `recipe_id`, `created_at` |
| `ai_usage` | Metering for every AI call | `id`, `household_id`, `import_job_id`, provider, model, input/output tokens, estimated cost, `created_at` |
| `plan_limits` | Every tier limit (recipe count, text caps, device caps, image quotas), editable without a deploy | `tier`, `key`, `value`, `updated_at`, `updated_by` |
| `limit_override` | Per-account limit exceptions, which beat the tier limit | `household_id`, `key`, `value`, `expires_at`, `note`, `created_by`, `created_at` |
| `admin_audit_log` | Every admin action. Append-only (database triggers), copied to the R2 bucket `fennl-audit` under a 365-day lock | `id`, `admin_user_id`, `action`, `target_user_id`, `reason`, `details`, `created_at` |
| `household_plan_contribution` | Each partner's contributed plan value when combining, used for the split math (Stage I) | `household_id`, `user_id`, `contributed_value_cents`, `currency`, `source_subscription_id`, `combined_at`, `settled_at` |
| `feedback` | Messages sent from the in-app feedback form (built in B8, `worker/feedback/`); tracked in the admin inbox, replies go from the owner's own email app | `id`, `user_id`, `household_id`, `message`, `page`, `app_version`, `device`, `user_agent`, `created_at`, `read_at`, `replied_at`, `done_at`, `note`, `updated_at` |
| `promo_code` | Invite and promo codes that give free Premium (B5; replaces the planned `beta_invite`) | `id`, `code`, `label`, `tier`, `access_until` or `access_days` (neither: no end date), `allows_sign_up`, `max_uses`, `uses`, `redeem_by`, `disabled_at`, `created_by`, `created_at`, `updated_at` |
| `premium_grant` | Premium a household got from a code, one row per person per code | `id`, `household_id`, `user_id`, `promo_code_id`, `tier`, `starts_at`, `ends_at` (null: the code's `access_until`, or no end), `revoked_at`, `created_at` |
| `email_change` | Every change to an account's email (B7a, `worker/account/`): waits for the link sent to the new address; admins can restore an earlier address | `id`, `user_id`, `kind` (change or restore), `old_email`, `old_email_verified_at`, `new_email`, `admin_user_id`, `token_hash`, `created_at`, `expires_at`, `completed_at`, `cancelled_at` |
| `app_setting` | App-wide switches the admin console changes without a deploy (for now, invite-only sign-up) | `key`, `value`, `updated_at`, `updated_by` |

Columns marked with a description rather than a name are settled in the phase that builds the table (see `spec.md`). Category and photo rows are synced like recipes, so the sync columns may move with the recipe store if recipes end up in a Durable Object.

Notes:

- A device row is a **browser profile**, not a physical device. A private window or cleared site data looks like a new device.
- Eviction recovery and device switching are the same event (the device ID disappears with the storage). The **takeover flow must be self-service and fast**. Do not add long cooldowns. Light rate limiting for abuse only.

## Design (Decided, phase A4)

The look is recorded in `docs/design/design-direction.md` and implemented as CSS variables in `app/styles/tokens.css`. Screens use the tokens and never hardcode colors, fonts or sizes.

- Headings: Commissioner (flair axis 80, weight 540). Body: Instrument Sans. Handwritten touches: Caveat, used sparingly (names, greetings, captions, family notes); a recipe's source is just the person's name.
- Two color schemes, Harbor and Heirloom, each with light and dark. **The color scheme is an account-level setting** (it follows the user to every device; store it server-side with the user's account). Light/Dark/Match my device is also offered.

## Data model rules (sync-ready)

- All records use **client-generated UUIDs**, so a local library can attach to an account later without ID clashes.
- Every synced row has `updated_at` and `deleted_at`. **Never hard-delete synced rows**; use tombstones so other devices learn about deletions.
- The server assigns a monotonic `server_seq` on every accepted change. Data is owned per user and households only grant visibility, so clients keep **one cursor per owner** they can see. They pull "everything owned by X after cursor N" for each current household member. When a member joins, devices pull the newcomer's library from cursor 0. When a member leaves, devices drop that owner's rows locally. That is a visibility change, not a deletion, so no tombstones are written.
- **Access rule:** every recipe read and write requires that the recipe's owner is a current member of the caller's active household.
- **Trash (Decided 2026-10-03):** deleted recipes stay in Trash for 30 days, then a nightly job expunges them. Expunging wipes content, versions, and orphaned photos, but keeps a minimal tombstone (id, owner, `deleted_at`, `server_seq`).
- D1 has no interactive transactions (Better Auth uses `batch()` for atomicity). Sync writes must be batched or conditional updates, not read-decide-write inside a transaction.
- Images are stored and referenced by **content hash**.
- Conflict resolution: **per-field last-write-wins by default**, over the fields in `RECIPE_FIELDS` (`shared/recipe.ts`). Built in C3: each change carries the device's time, corrected on arrival for a wrong device clock (the push says when it was sent); a field is kept only if its change is newer than the stored `field_times` entry, all inside one SQL statement per change, so there's no read-decide-write. Moving to Trash and back counts as one more field. The ingredient and direction lists are one field each for now; line-by-line merging is wanted later (every line already has an ID). Other Premium "smart merging" for households is to be designed (Open).
- **Ingredients and directions are edited as text** (one box each) and stored as lines; `shared/recipeLines.ts` converts between the two and keeps line IDs stable across edits. The text as written is always the master copy; how a line was read (amount, unit) is derived and re-read when the text changes.
- Server migrations run before new code is deployed, so every migration must stay compatible with the code already running (add first; drop or rename only in a later change). Never edit a merged migration.
- Client schema migrations are required, since local databases live on user devices. The sync protocol carries a client schema version and rejects incompatible clients with an upgrade prompt.

## Sync architecture

Start simple, keep the upgrade path open.

1. **Phase 1: HTTP pull/push** against D1 (or a per-household Durable Object), cursor-based, as described above. Easiest to build and debug. Changes arrive when a device polls or opens the app.
2. **Phase 2 (optional): Durable Object per household with a WebSocket**, for live updates between household members' devices and a single place to enforce entitlements.

Durable Object facts (from Cloudflare docs, verify before depending on them): SQLite-backed objects have their own embedded SQLite database, up to 10 GB each, with unlimited objects; one object is single-threaded and is meant to scale out, not up. A household is a good fit for one object.

## Write paths

**Free tier**: user edits, debounce 1 to 2 seconds, push to the server. The local store is updated from the server's response. If offline or the push fails, show a clear banner and block further edits rather than queueing them.

**Premium**: user edits write locally and append to an outbox. A background process pushes the outbox. Retry with backoff. Show sync status ("Saved to cloud" or "N changes waiting").

**Both**: flush pending changes on page hide or close (`fetch` with `keepalive` or `sendBeacon`). Request persistent storage (`navigator.storage.persist()`) for Premium users.

Built in C4 (`app/sync/`): one outbox and one code path for both; `offline_enabled` decides whether changes may wait (Premium) or editing pauses while a save can't go through (Free). One tab owns the local copy (Web Locks) and the others go through it (BroadcastChannel). The app asks `GET /api/version` and offers a reload when a newer release is live. C4b: a service worker (`app/offline/sw.js`, file list written by `vite.config.ts`) keeps the app's own files so it opens with no connection; the last signed-in person and their plan's `offline_enabled` are remembered for offline starts only (never the sign-in itself). C6: the recipe editor (`app/recipes/editorSession.ts`) saves the changed fields about a second after typing stops, through the same outbox; every change a device makes is stamped at least a millisecond after the one before, so the later of two quick changes to a field wins.

## API sketch

All routes require a valid Better Auth session. Every route resolves the caller's household entitlement first.

| Route | Purpose | Entitlement checks |
| --- | --- | --- |
| `POST /api/devices/register` | Register the browser's device ID | Under `max_devices`, else return takeover options |
| `POST /api/devices/takeover` | Make this browser the active device, revoke the previous one (free) or revoke a chosen one (Premium) | Authenticated member of the household |
| `GET /api/devices`, `POST /api/devices/:id/sign-out` | Settings › Devices: list active devices, sign another one out | Authenticated; only the caller's own devices can be signed out |
| `POST /api/sync/push` | Submit changes `{deviceId, schemaVersion, sentAt, changes[]}` (built in C3; shapes in `shared/sync.ts`) | Device registered and not revoked; app schema version; without `offline_enabled`, every change must be under 2 minutes old when sent |
| `GET /api/sync/pull?deviceId=&schemaVersion=&since=<owner>:<seq>,...` | Fetch changes after each owner's cursor, in pages (C3) | Device registered and not revoked; only owners in the caller's household |
| `POST /api/images/upload` (or `/upload-url`) | Upload an image via the Worker or a short-lived signed URL | `images_enabled`, per-file size, total quota |
| `GET /api/images/:hash` | Serve an image | Caller's household owns it; never public bucket URLs |
| `GET /api/export` | Full-library export | Always allowed, including lapsed accounts |
| `POST /api/import` | Import recipes | `import_structured_enabled` for Paprika files and pages with structured data; `import_ai_enabled` plus the AI usage cap for anything that calls the AI |
| `GET /api/recipes/:id/versions` | Version history | `history_enabled` |

## R2 and image rules (Decided: R2 is gated)

- Clients never receive R2 credentials or public URLs.
- Uploads go through a Worker (or Worker-issued short-lived signed URLs) **only after** the entitlement and quota check.
- Enforce a per-file size limit and per-household totals (bytes and count). Reconcile `household_usage` against actual R2 contents periodically.
- Compress and resize in the client before upload (WebP or AVIF). Largest cost lever.
- Use R2 lifecycle rules to abort incomplete multipart uploads. Delete orphaned objects when recipes are deleted.
- Trial accounts get a lower image quota. Require a payment method up front for trials (the Better Auth Stripe plugin limits one trial per account, but a new account can dodge that).

## Import sources (Decided for the beta)

Import is the headline feature. It is gated by cost, using two flags (**Decided**, changed from "Premium only" on 2026-10-03):

| Flag | Covers | Free tier |
| --- | --- | --- |
| `import_structured_enabled` | Paprika library files and web pages with Schema.org data. No AI call, so no marginal cost. | **Yes**, text only (no photos, since free has no R2 access), with a size cap on how many recipes one import can add |
| `import_ai_enabled` | Photos, PDFs, screenshots, handwritten cards, and pages with no structured data. Each one calls the AI. | No (Premium only) |

Keeping imported photos and original-card photos needs `images_enabled`. A free Paprika import brings in the text and drops the photos, and tells the user so. Add a new import source by deciding which of the two flags it falls under, not by adding a flag per source.

- **Web pages**: a **Chrome extension** (desktop) is the first and, during the beta, only web import path. It reads the page as the user sees it, so logged-in and paywalled sites work. It never collects passwords for recipe sites. Extraction order: Schema.org structured data first, then AI for pages without it.
- **Photos and documents**: handwritten cards (front/back, multi-card), printed cookbook pages (multi-page), screenshots, and PDFs (possibly many recipes per file).
- **Paprika 3**: full library import with photos and categories, essential for the beta. Re-importing must update rather than duplicate.
- **Original photos are always kept** with the imported recipe.
- **Every import is reviewed before saving.** Nothing is silently added or overwritten.
- **Measured quality.** Import accuracy is scored field by field against a real test set; see `spec.md` phase E1.
- **Not in the beta**: paste-a-link import, phone share button, other browsers' extensions, social and video import.

## AI import (Leaning)

AI reads recipes from photos (handwritten cards, cookbook pages), screenshots, PDFs, and web pages that have no structured recipe data. Import is gated by `import_ai_enabled` (Premium only).

- **One multimodal model call, no separate OCR service.** A multimodal model reads the image or PDF and returns a structured recipe draft in one step. OCR-only services (for example Google Cloud Vision) return plain text only and would still need an AI step, so they are not used.
- **Starting model: Claude Haiku** via the Anthropic API. Researched 2026-10-01 against Gemini Flash, OpenAI GPT models, Google Cloud Vision / Document AI, and Cloudflare Workers AI. Rough cost is about half a cent per recipe or less, so accuracy matters more than price.
- **Swappable by design.** All AI calls go through one provider interface in the Worker that returns a fixed recipe-draft shape. The model name and provider come from configuration, never hardcoded in import code. Prompts and output validation sit above the interface. Switching to a bigger Claude model, Gemini, or OpenAI must be a config change or one new adapter file.
- **Server only.** The API key is a Worker secret. It never reaches the browser or the extension. Clients never call an AI vendor directly.
- **Gated and metered.** Check `import_ai_enabled` and the household's AI usage cap before any AI call. Record every call in `ai_usage` (household, model, tokens, estimated cost). Keep a global spending alarm. Enforce file size and page limits.
- **Review before save.** AI output is a draft. The user reviews it, and the original photo or page is kept with the recipe (counts toward the image quota).
- **Measure, then change models.** Compare models on a real test set (accuracy and cost) before switching.
- **Privacy.** User photos go to a third-party vendor. Check the vendor's API data-retention and training terms and state them in the privacy policy.
- **Open:** whether free accounts get a few "teaser" AI imports. Not decided; revisit before public launch. Until then, AI import is Premium only.

## Admin console (Decided 2026-10-03)

An admin console exists before the beta, **including impersonation**. Admin security must be strong enough that it can't become a way to compromise accounts. The measures below are Leaning; `spec.md` B4a, B7, and C12 have the details.

- Served on a **separate admin hostname** behind **Cloudflare Access**, so it's gated before any Fennl code runs. The hostname is never hardcoded (GitHub variable `ADMIN_HOSTNAME`, like `APP_HOSTNAME`). Access is free for up to 50 users and also covers the preview Worker. Built in B4a (`worker/admin/`): the Worker re-checks Access on every admin request, and every `/api/admin` route goes through `requireAdmin`.
- **Passkey or hardware key required** for admins (`@better-auth/passkey`, plus our own check that admin sessions were created with a passkey). No SMS, and no password-only access. Admins use a dedicated admin account.
- The admin role is granted **only by a direct database command**. Remove the Better Auth admin plugin's `set-role` permission through custom access control. Never add an in-app path to grant admin.
- Admin sessions: 30 minutes idle and 8 hours maximum. Re-confirm with the passkey for impersonation, password changes, and limit changes. Email alerts go to the owner on every admin sign-in and impersonation start.
- `admin_audit_log` is append-only and continuously copied to separate storage the console can't write to.
- Must-have tools: account lookup, password help, tier-limit editing, per-account overrides, invite codes, and a feedback inbox.
  - Password help defaults to a reset email. The fallback is a temporary password that must be changed at the next sign-in (not built into Better Auth, so a small custom flag: `user.must_change_password`, built in B7). Admins never see or choose a user's lasting password.
- **Impersonation is silent to the user**, so abuse can be investigated without alerting them. It never appears in their activity, devices, or sign-in history, and sends no sign-in emails. A reason is required, stored only in `admin_audit_log`.
  - The admin has **at least the user's full abilities**, and every change is attributed to the admin in the log.
  - Leaning safeguards:
    - Passkey re-confirmation for password, email, deletion, household, and billing actions.
    - Standard security emails still go out for password and email changes.
    - Sessions auto-end after 30 minutes (Better Auth defaults to 1 hour; set `impersonationSessionDuration`), with a visible banner.
    - Other admins can't be impersonated (the plugin's default).
  - Impersonation never registers as a device or triggers takeover. Writes go straight to the server with no outbox, and data sits in an isolated local store that's wiped on exit.
  - **Billing while impersonating (Decided):** cancel and downgrade only. Anything that charges the user's card is blocked, and refunds and credits go through the Stripe dashboard.
- The privacy policy carries a general statement that Fennl staff may access accounts for support and abuse investigation.

## Lapsed subscriptions and over-limit accounts

**Decided (2026-10-03):** when an account drops to Free (a beta grant expiring, a downgrade, a lapse, or a household split) and is over the free limits, **nothing is deleted or hidden**. Everything stays readable, editable, and exportable. **New additions are blocked** (new recipes, imports, anything that grows storage) until usage is back under the limits. Show a **storage usage bar** in Settings and next to the blocked action. **Photos:** 90 days of full view and download access, with reminder emails, then deletion. Resubscribing within the window cancels deletion. Recipe text is never deleted.

Other current thinking:

- Local and cloud text data stays fully readable and exportable.
- Premium features stop (sync beyond one device, offline queue, history, import, new image uploads).
- The 90-day photo grace period goes in the terms of service.
- Never hold recipes hostage: export must always work.

## Backups and durability

- D1 Time Travel (checked 2026-10-03): always on, restore to any minute in the last **30 days on Workers Paid** (7 days on Workers Free). SQLite-backed Durable Objects also have 30-day point-in-time recovery.
- A D1 restore **overwrites the whole database in place**, rolling back every account. It can't recover one person's deleted recipes. The nightly per-household text export to R2 is therefore **required**, not optional. It also keeps copies longer than 30 days. This is separate from the gated image storage.

## Free-tier abuse and operations

- Email verification, rate limits, and a retention policy for long-inactive free accounts.
- **Decided (2026-10-06, built in B7a):** an email-and-password account never verified is removed 24 hours after sign-up (hourly Cron Trigger, `worker/account/purge.ts`), giving back its invite code's use. Changing an account's email always waits for the link sent to the new address (24 hours, then it expires and nothing changes); the old address is told; every change is kept so an admin can restore an earlier address. `user.email_verified_at` records when the current address was verified.
- Privacy policy and account deletion flow.
- Free-tier text cap: 3 MB per account, plus the 100-recipe limit (see "Free").

## Unverified items and open questions

1. Whether Paddle or Polar have maintained Better Auth integrations (only matters if the merchant-of-record option is revisited).
2. ~~Point-in-time restore for D1 and Durable Objects.~~ Checked 2026-10-03; see "Backups and durability". Needs Workers Paid for 30 days.
3. Browser eviction behavior on Safari, and how reliably `navigator.storage.persist()` is granted. Partly checked 2026-10-03: Safari deletes script-writable storage after 7 days of Safari use without visiting the site. Home Screen apps are exempt, and `persist()` is granted heuristically (e.g. Home Screen). Tested on real devices 2026-10-07 (C2): `persist()` was granted in Chrome, Firefox (after its prompt) and an iPhone Home Screen app, but not in Edge in a tab, so a browser tab can't count on it. The 7-day removal can't be tested in one sitting.
4. Whether the Better Auth Stripe plugin's organization-customer flow handles cancel and resubscribe cleanly for our flat-seat-limit plans. Docs checked 2026-10-03: organization billing (`customerType: "organization"`), cancel, and restore exist, but there's no credit or plan-time transfer support. Still needs a hands-on test in Stage I.
5. Final prices, device cap for Premium, image quotas. (Photo grace period: decided, 90 days.)
6. ~~Whether to gate the free tier by recipe count.~~ Decided: 100 recipes and a 3 MB text cap, plus the one-device limit.
7. ~~Whether to use a Durable Object per household or keep recipes in D1 for Phase 1.~~ Decided 2026-10-07: D1 (see "Stack"). Checked: D1 databases hold 10 GB, 50,000 per account; Workers with a Durable Object get no preview (version) URLs.
8. Design of household "smart merge" beyond per-field last-write-wins.
9. LiveStore: revisit only if its maturity improves; adopting it means rewriting the data layer around events.
10. Current Claude Haiku model name, price, image and PDF limits, and the Anthropic API data-retention terms. The 2026-10-01 research used third-party roundups, not vendor pages. Check official docs before building the AI layer.
11. Whether free accounts get teaser AI imports (Open, owner undecided).

## Working conventions for Claude Code

- Prefer small, reviewable changes. Ask before changing anything marked **Decided**.
- When a task depends on an **Unverified** claim, check current official docs first and say what you found.
- Entitlement checks live on the server. Never trust tier, device status, or quota from the client.
- Keep the free/Premium difference in entitlement flags, not in separate code paths wherever possible: one client, one data layer.
- Do not add dependencies for sync, auth, or billing without asking.
- Every API route that reads or writes household data goes through `requireHousehold` (`worker/household/`), which only ever resolves a household the caller is a member of. Better Auth's organization endpoints stay closed at the Worker until G1 opens the ones sharing needs.
- Never hard-code plan limits; read them from `plan_limits` and `limit_override`.
- Never add an in-app way to grant the admin role. Admin actions record to the audit log (`recordAdminAction`) before they change anything.
- Never hardcode an AI model name or vendor outside the AI provider layer, and never call an AI vendor from client code.
- Secrets reach the Worker only from GitHub secrets via CI (`--secrets-file`). Never commit them or put them in `wrangler.jsonc`. List new ones in `worker/env.d.ts` and the setup docs.
- Never hardcode the app's hostname (currently `beta.fennl.app`; it will change). It lives only in the GitHub Actions variable `APP_HOSTNAME`. Deploy config gets it from there, and code reads its own origin from configuration or the incoming request.
