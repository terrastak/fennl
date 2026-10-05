/**
 * How a session was signed in, recorded on the session (session.auth_method). The admin area
 * only accepts sessions signed in with a passkey (CLAUDE.md, "Admin console").
 */
export type SignInMethod = "passkey" | "password" | "email_link" | "google" | "apple" | "other";

/** Works out the method from the Better Auth endpoint that is creating the session. */
export function signInMethodFor(path: string | undefined): SignInMethod {
  if (!path) return "other";
  if (path === "/passkey/verify-authentication") return "passkey";
  if (path === "/sign-in/email") return "password";
  if (path === "/verify-email") return "email_link";
  if (path.startsWith("/callback/google")) return "google";
  if (path.startsWith("/callback/apple")) return "apple";
  return "other";
}
