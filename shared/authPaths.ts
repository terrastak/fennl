/**
 * Where Better Auth's sign-up link lands once the address is verified. The app has its own copy
 * (app/auth/client.ts); the Worker uses this one when it sends a sign-up link itself (phase U14,
 * worker/account/signUpRoutes.ts). Keep the two the same.
 */
export const AFTER_VERIFY_PATH = "/email-confirmed";
