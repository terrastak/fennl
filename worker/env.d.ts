/**
 * Everything the Worker receives from Cloudflare: bindings from wrangler.jsonc, plus secrets.
 * Written by hand (`wrangler types` only generates the runtime types) so that optional settings
 * stay optional. Keep it in step with wrangler.jsonc.
 *
 * Secrets are set by CI from GitHub secrets (docs/setup/b2-email-and-sign-in.md), or come from
 * .dev.vars in local development.
 */
interface FennlEnv {
  /** D1 database: "fennl" in production, "fennl-preview" for previews (wrangler.jsonc). */
  DB: D1Database;
  /** Signs sign-in sessions. CI creates it once per Worker; Cloudflare keeps it. */
  BETTER_AUTH_SECRET: string;
  /** Resend API key. Without it, email can't be sent (except to the local dev outbox). */
  RESEND_API_KEY?: string;
  /** Sender for account emails, for example `Fennl <hello@mail.example.com>`. */
  EMAIL_FROM?: string;
  /** "Continue with Google" appears only when both are set. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** "Continue with Apple" appears only when all four are set. CLIENT_ID is the Services ID. */
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  /** The .p8 key file's contents (PEM, "-----BEGIN PRIVATE KEY-----"). */
  APPLE_PRIVATE_KEY?: string;
  /** "true" only in local development and tests: keep emails in memory instead of sending them. */
  DEV_EMAIL_OUTBOX?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- names the interface above
interface Env extends FennlEnv {}

declare namespace Cloudflare {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- used by cloudflare:test
  interface Env extends FennlEnv {}
}
