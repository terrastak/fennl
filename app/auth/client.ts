import { createAuthClient } from "better-auth/react";

/** Talks to Better Auth on this same site, at /api/auth. Sessions live in an http-only cookie. */
export const authClient = createAuthClient({ basePath: "/api/auth" });

export const { useSession } = authClient;

/** Where links in account emails send people after they've been opened. */
export const AFTER_VERIFY_PATH = "/email-confirmed";
export const RESET_PASSWORD_PATH = "/reset-password";
