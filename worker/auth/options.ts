import type { BetterAuthOptions } from "better-auth";
import { eq } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { admin, organization } from "better-auth/plugins";
import { adminAccessControl, adminRoles } from "../admin/roles";
import { checkSignUp, grantSignUpCode } from "../codes/signUp";
import type { Database } from "../db/client";
import * as schema from "../db/schema";
import type { SendEmail } from "../email/email";
import { passwordResetEmail, verificationEmail } from "../email/templates";
import { activeHouseholdFor } from "../household/household";
import { signInMethodFor, type SignInMethod } from "./signInMethod";

/** A new session, as the admin area's alerts and audit log see it (worker/admin/events.ts). */
export interface SessionCreatedEvent {
  userId: string;
  sessionId: string;
  method: SignInMethod;
  request: Request | undefined;
}

export interface AuthSettings {
  /** This deployment's own origin, taken from the incoming request (never hardcoded). */
  origin: string;
  secret: string;
  db: Database;
  sendEmail: SendEmail;
  google?: { clientId: string; clientSecret: string } | undefined;
  apple?: { clientId: string; clientSecret: string } | undefined;
  /** Runs after every new session (admin sign-in alerts and audit log). */
  onSessionCreated?: ((event: SessionCreatedEvent) => Promise<void>) | undefined;
  /** Runs after a passkey is registered. */
  onPasskeyRegistered?:
    ((userId: string, request: Request | undefined) => Promise<void>) | undefined;
}

export const AUTH_BASE_PATH = "/api/auth";

/**
 * Which addresses a passkey works on. A passkey is tied to this "relying party ID". Every preview
 * link is its own address (pr-15-fennl-preview.<account>.workers.dev), so on workers.dev it's the
 * account's subdomain (<account>.workers.dev), and an admin's passkey works on every preview.
 * Elsewhere (the admin address, localhost) it's the exact address.
 */
export function passkeyRpId(hostname: string): string {
  const labels = hostname.split(".");
  return hostname.endsWith(".workers.dev") && labels.length > 3
    ? labels.slice(-3).join(".")
    : hostname;
}
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Better Auth settings for Fennl. Kept free of Cloudflare specifics so the schema generator
 * (worker/auth/cli.ts) can load it too.
 */
export function authOptions(settings: AuthSettings) {
  const origin = new URL(settings.origin);
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
      // A new password from the reset email replaces a temporary one from support (phase B7).
      onPasswordReset: async ({ user: person }) => {
        await settings.db
          .update(schema.user)
          .set({ mustChangePassword: false })
          .where(eq(schema.user.id, person.id));
      },
      sendResetPassword: async ({ user, url }) => {
        await settings.sendEmail(passwordResetEmail(user, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in before verifying sends a fresh link.
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
        // Set when an admin gives a temporary password (phase B7): the app asks for a new one
        // before anything else, and household routes refuse until it's changed.
        mustChangePassword: {
          type: "boolean",
          required: false,
          input: false,
          defaultValue: false,
        },
        // When the current email address was verified (phase B7a). Set by the hooks below for
        // every way an address gets verified, and by Fennl's own email change
        // (worker/account/emailChange.ts). Null on older accounts: "date not recorded".
        emailVerifiedAt: { type: "date", required: false, input: false },
      },
      // Better Auth's own email change is off (the default): Fennl runs its own, which keeps
      // every change so support can restore an earlier address (worker/account/emailChange.ts).
    },
    plugins: [
      // Households are Better Auth organizations (CLAUDE.md, "Entitlements model"). Their HTTP
      // endpoints are closed in worker/index.ts until sharing arrives (phase G1); B3 only needs
      // each person's own household, which Fennl manages itself (worker/household/).
      organization({ allowUserToCreateOrganization: false, membershipLimit: 2 }),
      // The admin role (user.role). Its HTTP endpoints are closed in worker/index.ts, and its
      // permissions leave out "set-role" (worker/admin/roles.ts).
      admin({
        ac: adminAccessControl,
        roles: adminRoles,
        defaultRole: "user",
        adminRoles: ["admin"],
        impersonationSessionDuration: 30 * 60,
      }),
      // Passkeys, used only in the admin area for now (worker/admin/).
      passkey({
        rpID: passkeyRpId(origin.hostname),
        rpName: "Fennl",
        origin: origin.origin,
        registration: {
          afterVerification: async ({ user, ctx }) => {
            await settings.onPasskeyRegistered?.(user.id, ctx.request);
          },
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Every new account, however it's made (email, Google, Apple), passes the invite and
          // promo code check (worker/codes/signUp.ts).
          before: async (newUser, ctx) => {
            await checkSignUp(settings.db, ctx);
            // Google and Apple hand over addresses they've already verified.
            return newUser.emailVerified
              ? { data: { ...newUser, emailVerifiedAt: new Date() } }
              : undefined;
          },
          after: async (user, ctx) => {
            await grantSignUpCode(settings.db, user.id, ctx);
          },
        },
        update: {
          // The link in a verification email, or Google or Apple joining an unverified account.
          before: async (data) =>
            data.emailVerified === true && !("emailVerifiedAt" in data)
              ? { data: { ...data, emailVerifiedAt: new Date() } }
              : undefined,
        },
      },
      session: {
        create: {
          // Every new session starts in the person's household (created on first sign-in), and
          // records how it was signed in.
          before: async (session, ctx) => ({
            data: {
              ...session,
              activeOrganizationId: await activeHouseholdFor(settings.db, session.userId),
              authMethod: signInMethodFor(ctx?.path),
              lastActiveAt: new Date(),
            },
          }),
          after: async (session, ctx) => {
            await settings.onSessionCreated?.({
              userId: session.userId,
              sessionId: session.id,
              method: signInMethodFor(ctx?.path),
              request: ctx?.request,
            });
          },
        },
      },
    },
    account: {
      // Google and Apple verify the email address, so signing in with them joins an existing
      // account with the same email instead of making a second one.
      accountLinking: { enabled: true, trustedProviders: ["google", "apple"] },
    },
    // Every session check reads the database (no cookie cache), so signing out, resetting a
    // password or removing a device takes effect everywhere at once.
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      additionalFields: {
        // How this session was signed in, and (for admin sessions) when it was last used.
        authMethod: { type: "string", required: false, input: false },
        lastActiveAt: { type: "date", required: false, input: false },
      },
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
