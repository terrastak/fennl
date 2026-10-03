/**
 * Fennl's server database tables (Cloudflare D1), defined with Drizzle.
 *
 * To change the database, edit this file and run `npm run db:generate`. That writes a new
 * migration in worker/db/migrations; commit it with the change. Never edit a migration that has
 * already been merged: write a new one instead.
 *
 * Better Auth's tables (users, sessions, sign-in accounts, verification tokens, rate limits) live
 * in ./auth-schema.ts, which `npm run auth:generate` writes from worker/auth/options.ts. Rerun it
 * after changing Better Auth's settings or version, then `npm run db:generate`.
 */
export * from "./auth-schema";
