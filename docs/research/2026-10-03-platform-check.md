# Platform check (2026-10-03)

Facts checked against current official docs during a parallel planning conversation. Only findings that apply to the current stack are kept: React + Vite, Hono on Workers, D1, Drizzle, Better Auth, and Resend. The Next.js/vinext and Cloudflare Email Sending comparisons from that conversation are dropped because `main` doesn't use them.

## Backups (D1 Time Travel)

- Always on. Restore to any minute in the last **30 days on Workers Paid**, **7 days on Workers Free**.
- A restore "is a destructive operation, and overwrites the database in place". It rolls back every account. The nightly per-household export to R2 is therefore the only way to restore one account, and it can keep copies longer than 30 days.
- SQLite-backed Durable Objects have the same 30-day point-in-time recovery.

## Better Auth

- 1.5+ supports D1 natively. **D1 has no interactive transactions**; Better Auth uses `batch()` for atomicity, and Fennl's sync writes must do the same.
- **Organization plugin**: function-based membership limits (useful for the 1-or-2-member rule).
- **Stripe plugin**: organization billing via `customerType: "organization"` and `referenceId`, plan `limits`, cancel and restore, and one trial per account. It handles `checkout.session.completed` and `customer.subscription.created/updated/deleted`. **No credit-balance or plan-time transfer support**, so household billing rules need custom Stripe code.
- **Admin plugin**:
  - Covers roles, `setUserPassword`, revoking sessions, ban/unban, and impersonation (`impersonationSessionDuration` defaults to 1 hour; admins can't be impersonated without an `impersonate-admins` permission).
  - Includes a `set-role` endpoint callable by admins. Remove it through custom access control so there's no in-app path to admin.
  - "Must change password at next sign-in" is not built in.
- **Passkeys**: a separate package, `@better-auth/passkey`. Requiring passkeys for a role is not built in, so a custom check is needed.

## Browser storage

- SQLite WASM `opfs-sahpool` mode needs no COOP/COEP headers, works on Safari 16.4+, and is the fastest OPFS option. It allows one connection per database, so multi-tab use needs coordination. The `opfs` mode needs COOP/COEP and doesn't work on Safari below 17.
- Safari deletes all script-writable storage after 7 days of Safari use without visiting the site. Home Screen web apps are exempt. `persist()` is granted heuristically ("whether the website is opened as a Home Screen Web App").

## Stripe: sharing household plan value

- **Customer credit balance**: credit "automatically applies to the next invoice". The ledger is immutable (reverse rather than edit). Credit is per customer, so moving value between partners means a debit on one and a credit on the other, recorded in our own table. Tax interaction is Unverified.
- **Pushing the renewal date** with `trial_end` + `proration_behavior: none` works, but makes the subscription "trialing". That collides with entitlement logic and Better Auth's one-trial rule. **Leaning: credit balance.**

## Cloudflare Access (admin gate)

- Zero Trust Free covers up to 50 users with no overage billing (about $3/user beyond that).
- Access can protect a hostname, or a Worker "together with all of its preview deployments".

## Cloudflare Worker Previews (FYI for A3)

- Cloudflare now offers **Worker Previews** (`wrangler preview` / Workers Builds) with stable per-branch links. Its docs steer branch and PR testing away from aliased Version URLs, because those use the resources configured for that Worker version.
- A3's setup avoids that problem by uploading versions to a separate `fennl-preview` Worker with staging bindings. No change needed; worth knowing if A3 is revisited.

## Sources

- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Durable Objects SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Better Auth 1.5](https://better-auth.com/blog/1-5)
- [Better Auth Stripe plugin](https://www.better-auth.com/docs/plugins/stripe)
- [Better Auth admin plugin](https://www.better-auth.com/docs/plugins/admin)
- [Better Auth passkey plugin](https://www.better-auth.com/docs/plugins/passkey)
- [SQLite WASM persistence](https://sqlite.org/wasm/doc/trunk/persistence.md)
- [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [WebKit: 7-day cap and Home Screen exemption](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
- [Stripe customer balance](https://docs.stripe.com/billing/customer/balance)
- [Stripe free trials](https://docs.stripe.com/billing/subscriptions/trials/free-trials)
- [Cloudflare Access application types](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/)
- [Zero Trust free plan](https://blog.cloudflare.com/teams-plans/)
- [Workers Builds and Previews](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Previews: compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/)
