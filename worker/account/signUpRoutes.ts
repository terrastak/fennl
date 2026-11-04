import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { AFTER_VERIFY_PATH } from "../../shared/authPaths";
import { normalizeEmail } from "../../shared/email";
import type { SignUpEmailState } from "../../shared/emailDelivery";
import { createAuth } from "../auth/auth";
import { database, type Database } from "../db/client";
import { account, emailMessage, user } from "../db/schema";
import { recordWithheldLink } from "../email/delivery";
import { withinRateLimit } from "../rateLimit";
import { emailInUse, isUniqueViolation } from "./emailChange";
import { SIGN_UP_PROOF_MS, provenUserId, signUpProof, signUpProofCookie } from "./signUpProof";

// "Check your email" after signing up (phase U14): whether the sign-up link arrived, and fixing
// a mistyped address in place, so the name, password and invite code are kept. Only the browser
// holding the proof (./signUpProof.ts) can ask, and only about its own sign-up. Every answer
// looks the same whether or not the proof names a real account.

export const signUpRoutes = new Hono<{ Bindings: Env }>();

const HOUR = 60 * 60 * 1000;

/** The account a proof names, while it is still waiting to be verified with a password. */
async function waitingAccount(db: Database, userId: string) {
  return db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(
      and(
        eq(user.id, userId),
        eq(user.emailVerified, false),
        sql`exists (select 1 from ${account} where ${account.userId} = ${user.id} and ${account.providerId} = 'credential')`,
      ),
    )
    .get();
}

/**
 * What the newest sign-up link says. Every link goes to the account's address at the time, so
 * after a fix the newest is the one to the new address, or, for an address another account uses,
 * the record of the link withheld, which reads as `waiting` just as a link sent does.
 */
async function linkState(db: Database, userId: string): Promise<SignUpEmailState> {
  const latest = await db
    .select({ status: emailMessage.status })
    .from(emailMessage)
    .where(and(eq(emailMessage.userId, userId), eq(emailMessage.kind, "verification")))
    .orderBy(desc(emailMessage.sentAt))
    .limit(1)
    .get();
  switch (latest?.status) {
    case "bounced":
    case "complained":
    case "suppressed":
      return "not_arriving";
    case "delayed":
    case "soft_bounced":
      return "delayed";
    case "failed":
      return "not_sent";
    default:
      return "waiting";
  }
}

signUpRoutes.get("/api/sign-up/status", async (c) => {
  const db = database(c.env.DB);
  const userId = await provenUserId(c.env.BETTER_AUTH_SECRET, c.req.raw.headers);
  const person = userId ? await waitingAccount(db, userId) : undefined;
  const state: SignUpEmailState = person ? await linkState(db, person.id) : "waiting";
  return c.json({ state });
});

/**
 * Sends the sign-up link to a corrected address. The account's address changes in place (no
 * email change is recorded: the mistyped address was never the person's), and the 24 hours to
 * verify still count from signing up. An address another account uses gets the same answer and
 * no email (as in B7a).
 */
signUpRoutes.post("/api/sign-up/address", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
  const newEmail = normalizeEmail(body?.email);
  if (!newEmail) return c.json({ error: "invalid_email" }, 400);

  const db = database(c.env.DB);
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const userId = await provenUserId(c.env.BETTER_AUTH_SECRET, c.req.raw.headers);
  // Counted for a decoy's id as for a real one, so the limits don't tell them apart either.
  const withinLimits =
    (await withinRateLimit(db, `sign-up-address-ip:${ip}`, { max: 10, windowMs: HOUR })) &&
    (!userId ||
      (await withinRateLimit(db, `sign-up-address:${userId}`, { max: 5, windowMs: HOUR })));
  if (!withinLimits) return c.json({ error: "too_many" }, 429);

  const person = userId ? await waitingAccount(db, userId) : undefined;
  if (!person) return c.json({ ok: true });

  // An address another account uses: nothing changes and nothing is sent, but the withheld link
  // is recorded, so Check your email then reads the same as for a link sent.
  const withhold = async () => {
    await recordWithheldLink(db, person.id, newEmail);
    return c.json({ ok: true });
  };
  if (newEmail !== person.email) {
    if (await emailInUse(db, newEmail, person.id)) return withhold();
    try {
      const [changed] = await db
        .update(user)
        .set({ email: newEmail, emailProblem: null, updatedAt: new Date() })
        .where(
          and(eq(user.id, person.id), eq(user.email, person.email), eq(user.emailVerified, false)),
        )
        .returning({ id: user.id })
        .all();
      if (!changed) return c.json({ ok: true });
    } catch (error) {
      if (isUniqueViolation(error)) return withhold();
      throw error;
    }
  }

  // Through Better Auth, so the email, its link and its record are the sign-up link's own.
  try {
    const auth = await createAuth(c.env, c.req.raw);
    await auth.api.sendVerificationEmail({
      body: { email: newEmail, callbackURL: AFTER_VERIFY_PATH },
    });
  } catch (error) {
    // Recorded as not sent (worker/email/email.ts), which "Check your email" then says.
    console.error("Sign-up link to a corrected address not sent", error);
  }
  return c.json({ ok: true });
});

/**
 * Gives the browser its proof (phase U14), from Better Auth's own answers in worker/index.ts:
 * a sign-up (200, with the new account's id, or a made-up one for an address that already has an
 * account), or a sign-in with the right password to an account not yet verified (403
 * EMAIL_NOT_VERIFIED, which Better Auth only answers once the password checked out). Nothing else
 * gives one; asking for the link again doesn't.
 */
export async function withSignUpProof(
  env: Env,
  url: URL,
  /** A copy of the request, for the address a sign-in gave. */
  request: Request | null,
  response: Response,
  now = Date.now(),
): Promise<Response> {
  const path = url.pathname;
  let userId: string | null = null;
  let expiresAtMs = now + SIGN_UP_PROOF_MS;
  try {
    if (path === "/api/auth/sign-up/email" && response.status === 200) {
      const answer = (await response.clone().json()) as { user?: { id?: unknown } } | null;
      userId = typeof answer?.user?.id === "string" ? answer.user.id : null;
    } else if (path === "/api/auth/sign-in/email" && response.status === 403 && request) {
      const answer = (await response.clone().json()) as { code?: unknown } | null;
      if (answer?.code !== "EMAIL_NOT_VERIFIED") return response;
      const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
      if (!email) return response;
      const person = await database(env.DB)
        .select({ id: user.id, createdAt: user.createdAt })
        .from(user)
        .where(eq(user.email, email))
        .get();
      if (!person) return response;
      userId = person.id;
      // Until the account is removed (24 hours after signing up), and at least a minute.
      expiresAtMs = Math.max(
        now + 60_000,
        Math.min(expiresAtMs, person.createdAt.getTime() + SIGN_UP_PROOF_MS),
      );
    }
  } catch (error) {
    console.error("Couldn't give the sign-up proof", error);
    return response;
  }
  if (!userId) return response;

  const value = await signUpProof(env.BETTER_AUTH_SECRET, userId, expiresAtMs);
  const secure = url.protocol === "https:";
  const headers = new Headers(response.headers);
  headers.append("set-cookie", signUpProofCookie(value, expiresAtMs, secure, now));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
