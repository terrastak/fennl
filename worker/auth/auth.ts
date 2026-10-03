import { betterAuth } from "better-auth";
import { database } from "../db/client";
import { createEmailSender } from "../email/email";
import { appleClientSecret } from "./apple";
import { authOptions } from "./options";

/** Google's settings, when both parts are present. */
function googleSettings(env: Env) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = env;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/** Apple's settings, when all four parts are present. */
function appleSettings(env: Env) {
  const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = env;
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) return undefined;
  return {
    clientId: APPLE_CLIENT_ID,
    teamId: APPLE_TEAM_ID,
    keyId: APPLE_KEY_ID,
    privateKey: APPLE_PRIVATE_KEY,
  };
}

/** Which sign-in methods this deployment offers, from the settings it has. */
export function signInMethods(env: Env) {
  return { email: true, google: Boolean(googleSettings(env)), apple: Boolean(appleSettings(env)) };
}

/** Builds Better Auth for one request. Its address comes from the request itself. */
export async function createAuth(env: Env, request: Request) {
  // Never fall back to a default: sessions signed with a known secret could be forged.
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set.");
  const apple = appleSettings(env);
  return betterAuth(
    authOptions({
      origin: new URL(request.url).origin,
      secret: env.BETTER_AUTH_SECRET,
      db: database(env.DB),
      sendEmail: createEmailSender(env),
      google: googleSettings(env),
      apple: apple && { clientId: apple.clientId, clientSecret: await appleClientSecret(apple) },
    }),
  );
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;
