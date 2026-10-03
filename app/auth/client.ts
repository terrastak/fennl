import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Talks to Better Auth on this same site, at /api/auth. Sessions live in an http-only cookie. */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  // Mirrors the extra account fields in worker/auth/options.ts, so they're typed here too.
  plugins: [inferAdditionalFields({ user: { colorScheme: { type: "string", required: false } } })],
});

export const { useSession } = authClient;

/** Where links in account emails send people after they've been opened. */
export const AFTER_VERIFY_PATH = "/email-confirmed";
export const RESET_PASSWORD_PATH = "/reset-password";
