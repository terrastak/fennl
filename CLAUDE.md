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
| Database access and migrations | Drizzle (schema in `worker/db/schema.ts`, migrations in `worker/db/migrations`, applied by Wrangler) | Decided (B1) |
| Billing | Stripe Billing + Stripe Tax, via Better Auth's Stripe plugin | Decided |
| Per-household live sync / recipe store | Durable Object (SQLite-backed) per household | Open (see "Sync architecture") |
| Local data layer in the browser | SQLite compiled to WASM on OPFS, or IndexedDB via Dexie | Leaning (SQLite/OPFS, for real SQL and full-text search) |
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

Every user gets a personal **household** (a Better Auth organization) at signup. Recipes belong to a household, not to a user. A Household plan lets a second member join. An Individual plan is a household with a seat limit of 1. A free account is a household with no subscription.

The **subscription attaches to the household** (Stripe plugin with organization customers). Entitlements are derived from the household's subscription, so every endpoint checks one thing: the household's current entitlement.

**Beta grants (Decided for the beta).** Entitlements are derived from the household's subscription **or from a beta grant**. A beta grant comes from an invite code and gives a household Premium for a set period. It is one more input to the same entitlement computation, not a separate code path. When a grant expires and there is no subscription, the household falls back to Free.

Derived entitlement fields (computed server-side, never trusted from the client):

- `tier`: `free` | `individual` | `household`
- `max_members`: 1 or 2
- `max_devices`: 1 for free, a cap for Premium
- `images_enabled`: boolean
- `image_quota_bytes`, `image_quota_count`, `image_max_file_bytes`: values Open
- `offline_enabled`, `history_enabled`: booleans
- `import_structured_enabled`, `import_ai_enabled`: booleans. Import is gated by what it costs, not by source. See "Import sources".

Subscription statuses to handle: active, trialing, past_due (dunning: do not remove members or shrink limits while payment is retried), canceled, and resubscribed after cancellation.

### Tables (D1)

Better Auth owns user, session, account, verification, organization, member, and invitation tables. The Stripe plugin owns the subscription table. Fennl-owned tables:

| Table | Purpose | Key columns |
| --- | --- | --- |
| `device` | Device registry for the one-device free limit and Premium cap | `id` (client-generated, random), `household_id`, `user_id`, `label`, `first_seen_at`, `last_seen_at`, `revoked_at` |
| `household_usage` | Quota tracking | `household_id`, `image_bytes`, `image_count`, `updated_at` |
| `image` | One row per stored image | `hash` (content hash), `household_id`, `bytes`, `content_type`, `created_at`, `deleted_at` |
| `recipe` | Recipe records (if stored in D1; see Sync architecture) | `id` (UUID), `household_id`, fields..., `updated_at`, `deleted_at`, `server_seq` |
| `recipe_version` | Premium version history | `id`, `recipe_id`, `snapshot`, `created_at`, `author_user_id` |
| `category` | Nested categories, per household | `id` (UUID), `household_id`, `parent_id`, `name`, sort order, `updated_at`, `deleted_at`, `server_seq` |
| `recipe_category` | Recipe-to-category links (many per recipe) | `recipe_id`, `category_id`, `updated_at`, `deleted_at`, `server_seq` |
| `recipe_photo` | Photos on a recipe, incl. kept import originals | `id` (UUID), `recipe_id`, `image_hash`, role (cover, photo, import original), sort order, `updated_at`, `deleted_at`, `server_seq` |
| `import_job` | One row per import attempt | `id`, `household_id`, `user_id`, source type, status, draft, provenance, resulting `recipe_id`, `created_at` |
| `ai_usage` | Metering for every AI call | `id`, `household_id`, `import_job_id`, provider, model, input/output tokens, estimated cost, `created_at` |
| `beta_invite` | Invite codes that grant Premium during the beta | `code`, `created_by`, `max_uses`, `uses`, grant duration, `expires_at`, `created_at` |

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
- The server assigns a monotonic `server_seq` (or cursor) on every accepted change. Clients pull "everything after cursor N".
- Images are stored and referenced by **content hash**.
- Conflict resolution: **per-field last-write-wins by default** (title, ingredients, notes, etc.). Premium "smart merging" for households is a feature to be designed (Open).
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

## API sketch

All routes require a valid Better Auth session. Every route resolves the caller's household entitlement first.

| Route | Purpose | Entitlement checks |
| --- | --- | --- |
| `POST /api/devices/register` | Register the browser's device ID | Under `max_devices`, else return takeover options |
| `POST /api/devices/takeover` | Make this browser the active device, revoke the previous one (free) or revoke a chosen one (Premium) | Authenticated member of the household |
| `POST /api/sync/push` | Submit changes `{deviceId, schemaVersion, changes[]}` | Device not revoked; free tier rejects queued/offline-batched pushes beyond a small size |
| `GET /api/sync/pull?since=<cursor>` | Fetch changes after the cursor | Device not revoked |
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

## Lapsed subscriptions (Open)

Need a policy before launch. Current thinking:

- Local and cloud text data stays fully readable and exportable.
- Premium features stop (sync beyond one device, offline queue, history, import, new image uploads).
- Images: a grace period of read-only access with export, then deletion after a stated number of days. The number of days is Open. Put it in the terms of service.
- Never hold recipes hostage: export must always work.

## Backups and durability

- Rely on Cloudflare's point-in-time restore for D1 and Durable Object SQLite. **Unverified**: confirm that both offer it and the retention window.
- Consider a nightly export of each account's text data to R2 as a second copy. Text is small. This is separate from the gated image storage.

## Free-tier abuse and operations

- Email verification, rate limits, and a retention policy for long-inactive free accounts.
- Privacy policy and account deletion flow.
- Cap free-tier text per account to prevent use as general storage.

## Unverified items and open questions

1. Whether Paddle or Polar have maintained Better Auth integrations (only matters if the merchant-of-record option is revisited).
2. Point-in-time restore availability and retention for D1 and SQLite-backed Durable Objects.
3. Browser eviction behavior on Safari (including installed PWAs), and how reliably `navigator.storage.persist()` is granted. Test on real devices.
4. Whether the Better Auth Stripe plugin's organization-customer flow handles cancel and resubscribe cleanly for our flat-seat-limit plans. A seat-sync bug in that area was fixed recently. Prefer flat plans with a seat limit to avoid the issue.
5. Final prices, device cap for Premium, image quotas, grace-period length.
6. Whether to gate the free tier by recipe count in addition to (or instead of) the one-device limit.
7. Whether to use a Durable Object per household or keep recipes in D1 for Phase 1.
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
- Never hardcode an AI model name or vendor outside the AI provider layer, and never call an AI vendor from client code.
- Never hardcode the app's hostname (currently `beta.fennl.app`; it will change). It lives only in the GitHub Actions variable `APP_HOSTNAME`. Deploy config gets it from there, and code reads its own origin from configuration or the incoming request.
