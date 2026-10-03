import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import type { Database } from "../db/client";
import * as schema from "../db/schema";
import type { SendEmail } from "../email/email";
import { passwordResetEmail, verificationEmail } from "../email/templates";
import { activeHouseholdFor } from "../household/household";

export interface AuthSettings {
  /** This deployment's own origin, taken from the incoming request (never hardcoded). */
  origin: string;
  secret: string;
  db: Database;
  sendEmail: SendEmail;
  google?: { clientId: string; clientSecret: string } | undefined;
  apple?: { clientId: string; clientSecret: string } | undefined;
}

export const AUTH_BASE_PATH = "/api/auth";
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Better Auth settings for Fennl. Kept free of Cloudflare specifics so the schema generator
 * (worker/auth/cli.ts) can load it too.
 */
export function authOptions(settings: AuthSettings) {
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  if (settings.google) socialProviders.google = { ...settings.google, prompt: "select_account" };
  if (settings.apple) socialProviders.apple = settings.apple;

  return {
    appName: "Fennl",
    baseURL: settings.origin,
    basePath: AUTH_BASE_PATH,
    secret: settings.secret,
    database: drizzleAdapter(settings.db, { provider: "sqlite", schema }),
    telemetry: { enabled: false },
    // Apple posts its answer back from its own site (response_mode=form_post).
    trustedOrigins: ["https://appleid.apple.com"],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await settings.sendEmail(passwordResetEmail(user, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in before confirming sends a fresh link.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await settings.sendEmail(verificationEmail(user, url));
      },
    },
    socialProviders,
    user: {
      additionalFields: {
        // The color scheme follows the account to every device (CLAUDE.md, "Design"). Only
        // PUT /api/account/appearance changes it, after checking the value; Better Auth's own
        // update-user endpoint can't (input: false).
        colorScheme: { type: "string", required: false, input: false },
      },
    },
    // Households are Better Auth organizations (CLAUDE.md, "Entitlements model"). Their HTTP
    // endpoints are closed in worker/index.ts until sharing arrives (phase G1); B3 only needs
    // each person's own household, which Fennl manages itself (worker/household/).
    plugins: [organization({ allowUserToCreateOrganization: false, membershipLimit: 2 })],
    databaseHooks: {
      session: {
        create: {
          // Every new session starts in the person's household, creating it on first sign-in.
          before: async (session) => ({
            data: {
              ...session,
              activeOrganizationId: await activeHouseholdFor(settings.db, session.userId),
            },
          }),
        },
      },
    },
    account: {
      // Google and Apple confirm the email address, so signing in with them joins an existing
      // account with the same email instead of making a second one.
      accountLinking: { enabled: true, trustedProviders: ["google", "apple"] },
    },
    // Every session check reads the database (no cookie cache), so signing out, resetting a
    // password or removing a device takes effect everywhere at once.
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      // Per IP address. Paths are relative to /api/auth.
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 60, max: 2 },
        "/sign-in/social": { window: 60, max: 10 },
        // "Who's signed in?" runs on every page load and only reads; limiting it would add a
        // database write to each one.
        "/get-session": false,
      },
    },
    advanced: {
      // Cloudflare puts the visitor's real address in this header and doesn't let clients set it.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: { generateId: () => crypto.randomUUID() },
    },
  } satisfies BetterAuthOptions;
}
