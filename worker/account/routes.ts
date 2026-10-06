import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { maskEmail, normalizeEmail, type EmailStatus } from "../../shared/email";
import { database } from "../db/client";
import { session, user } from "../db/schema";
import { createEmailSender } from "../email/email";
import { emailChangeEmail, emailChangedNotice } from "../email/templates";
import { requireHousehold } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import {
  cancelEmailChange,
  completeEmailChange,
  emailInUse,
  startEmailChange,
  waitingEmailChange,
} from "./emailChange";

// Changing your own email address from Settings (phase B7a). See worker/account/emailChange.ts.

export const accountRoutes = new Hono<{ Bindings: Env }>();

/** Changing the address needs a sign-in from the last day (Better Auth's "fresh session" age). */
const FRESH_SIGN_IN_MS = 24 * 60 * 60 * 1000;

/** Where the link in the email lands: an app page that finishes the change. */
export function emailChangeLink(origin: string, token: string): string {
  return `${origin}/verify-email-change?token=${token}`;
}

/** Sends the link to the new address. A failed send is logged; the person can ask again. */
export async function sendEmailChangeLink(
  env: Env,
  to: { email: string; name: string },
  link: string,
  bySupport: boolean,
) {
  await createEmailSender(env)(emailChangeEmail(to, link, bySupport)).catch((error: unknown) =>
    console.error("Email change link not sent", error),
  );
}

accountRoutes.get("/api/account/email", requireHousehold, async (c) => {
  const { db, userId } = c.var.signedIn;
  const person = await db.select().from(user).where(eq(user.id, userId)).get();
  if (!person) return c.json({ error: "unauthorized" }, 401);
  const waiting = await waitingEmailChange(db, userId);
  const status: EmailStatus = {
    email: person.email,
    emailVerified: person.emailVerified,
    emailVerifiedAt: person.emailVerifiedAt?.toISOString() ?? null,
    pending: waiting?.expiresAt
      ? { email: waiting.newEmail, expiresAt: waiting.expiresAt.toISOString() }
      : null,
  };
  return c.json(status);
});

accountRoutes.post("/api/account/email", requireHousehold, async (c) => {
  const { db, userId, sessionId, impersonating } = c.var.signedIn;
  // An admin acting as the person changes the email from the admin console instead (C12).
  if (impersonating) return c.json({ error: "not_while_impersonating" }, 403);
  const current = await db
    .select({ createdAt: session.createdAt })
    .from(session)
    .where(eq(session.id, sessionId))
    .get();
  if (!current || Date.now() - current.createdAt.getTime() > FRESH_SIGN_IN_MS) {
    return c.json({ error: "sign_in_again" }, 403);
  }
  if (!(await withinRateLimit(db, `email-change:${userId}`, { max: 5, windowMs: 60 * 60_000 }))) {
    return c.json({ error: "too_many" }, 429);
  }
  const body = (await c.req.json().catch(() => null)) as { newEmail?: unknown } | null;
  const newEmail = normalizeEmail(body?.newEmail);
  if (!newEmail) return c.json({ error: "invalid_email" }, 400);
  const person = await db.select().from(user).where(eq(user.id, userId)).get();
  if (!person) return c.json({ error: "unauthorized" }, 401);
  if (newEmail === person.email) return c.json({ error: "same_email" }, 400);

  const { token, expiresAt } = await startEmailChange(db, person, newEmail, null);
  // An address another account uses gets no email, but the answer is the same, so this can't be
  // used to find out who has an account. The change can never complete.
  if (!(await emailInUse(db, newEmail, userId))) {
    const link = emailChangeLink(new URL(c.req.url).origin, token);
    await sendEmailChangeLink(c.env, { email: newEmail, name: person.name }, link, false);
  }
  return c.json({ pending: { email: newEmail, expiresAt: expiresAt.toISOString() } });
});

accountRoutes.delete("/api/account/email/pending", requireHousehold, async (c) => {
  const { db, userId } = c.var.signedIn;
  return (await cancelEmailChange(db, userId))
    ? c.json({ ok: true })
    : c.json({ error: "not_found" }, 404);
});

/**
 * The page the link opens sends its secret here. No sign-in needed: having the link proves the
 * person reads the new address. The old address then gets a notice.
 */
accountRoutes.post("/api/account/email/verify", async (c) => {
  const db = database(c.env.DB);
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await withinRateLimit(db, `email-verify:${ip}`, { max: 20, windowMs: 10 * 60_000 }))) {
    return c.json({ error: "too_many" }, 429);
  }
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const outcome = await completeEmailChange(db, token);
  if (outcome.result === "done") {
    await createEmailSender(c.env)(
      emailChangedNotice(
        { email: outcome.oldEmail, name: outcome.name },
        maskEmail(outcome.newEmail),
      ),
    ).catch((error: unknown) => console.error("Email change notice not sent", error));
  }
  return c.json({ result: outcome.result });
});
