import { Hono } from "hono";
import { normalizeEmail } from "../../shared/email";
import { isLimitKey } from "../../shared/entitlements";
import {
  cancelEmailChange,
  emailInUse,
  restoreEmail,
  startEmailChange,
} from "../account/emailChange";
import { emailChangeLink, sendEmailChangeLink } from "../account/routes";
import { createAuth } from "../auth/auth";
import { generateCode } from "../codes/codes";
import { createEmailSender } from "../email/email";
import { temporaryPasswordEmail } from "../email/templates";
import {
  accountDetail,
  accountHousehold,
  findAccount,
  isLimitTier,
  listPlanLimits,
  parseLimitValue,
  planLimit,
  removeOverride,
  searchAccounts,
  setMustChangePassword,
  setOverride,
  setPlanLimit,
  signOutEverywhere,
} from "./accounts";
import { recordAdminAction } from "./audit";
import { freshPasskeyProblem, requireAdmin, type AdminContext } from "./requireAdmin";

// The admin console's account tools (phase B7). Every route is behind requireAdmin; every
// change is recorded in the audit log before it's made; password and limit changes need the
// passkey again (CLAUDE.md, "Admin console").

export const adminAccountRoutes = new Hono<{
  Bindings: Env;
  Variables: { admin: AdminContext };
}>();

adminAccountRoutes.use("*", requireAdmin);

/**
 * The app's own address, for links in emails sent from the admin address. In production that's
 * APP_HOSTNAME; in previews and locally the admin console shares the app's address.
 */
export function appOrigin(env: Env, request: Request): string {
  return env.APP_HOSTNAME ? `https://${env.APP_HOSTNAME}` : new URL(request.url).origin;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  return ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

adminAccountRoutes.get("/accounts", async (c) =>
  c.json(await searchAccounts(c.var.admin.db, c.req.query("q") ?? "")),
);

adminAccountRoutes.get("/accounts/:id", async (c) => {
  const admin = c.var.admin;
  const detail = await accountDetail(admin.db, c.req.param("id"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  // Looking at someone's account is itself an admin action.
  await recordAdminAction(
    c.env,
    { adminUserId: admin.userId, action: "account.viewed", targetUserId: detail.id },
    c.req.raw,
  );
  return c.json(detail);
});

/** Password help, the default: Better Auth's own reset email, linking to the app. */
adminAccountRoutes.post("/accounts/:id/password-reset", async (c) => {
  const admin = c.var.admin;
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  const signOut = (await body(c.req.raw)).signOutEverywhere === true;
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "account.password_reset_sent",
      targetUserId: person.id,
      details: { signOutEverywhere: signOut },
    },
    c.req.raw,
  );
  const origin = appOrigin(c.env, c.req.raw);
  const auth = await createAuth(c.env, new Request(origin));
  await auth.api.requestPasswordReset({
    body: { email: person.email, redirectTo: `${origin}/reset-password` },
  });
  const sessionsEnded = signOut ? await signOutEverywhere(admin.db, person.id) : 0;
  return c.json({ ok: true, sessionsEnded });
});

/**
 * The fallback: a temporary password, shown to the admin once, which the person must change
 * at their next sign-in. Admins never choose or see a lasting password, and admin accounts are
 * refused (this must never become a way into another admin's account).
 */
adminAccountRoutes.post("/accounts/:id/temporary-password", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  if (person.role === "admin") return c.json({ error: "target_is_admin" }, 403);
  const signOut = (await body(c.req.raw)).signOutEverywhere !== false;

  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "account.temporary_password_set",
      targetUserId: person.id,
      details: { signOutEverywhere: signOut },
    },
    c.req.raw,
  );
  const password = `${generateCode()}-${generateCode().slice(0, 4)}`;
  const auth = await createAuth(c.env, c.req.raw);
  await auth.api.setUserPassword({
    body: { userId: person.id, newPassword: password },
    headers: c.req.raw.headers,
  });
  await setMustChangePassword(admin.db, person.id, true);
  const sessionsEnded = signOut ? await signOutEverywhere(admin.db, person.id) : 0;
  // The standard security email still goes out (CLAUDE.md); it never contains the password.
  await createEmailSender(c.env)(
    temporaryPasswordEmail(person, `${appOrigin(c.env, c.req.raw)}/sign-in`),
  ).catch((error: unknown) => console.error("Temporary password notice not sent", error));
  return c.json({ password, sessionsEnded });
});

adminAccountRoutes.post("/accounts/:id/sign-out-everywhere", async (c) => {
  const admin = c.var.admin;
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  await recordAdminAction(
    c.env,
    { adminUserId: admin.userId, action: "account.signed_out_everywhere", targetUserId: person.id },
    c.req.raw,
  );
  return c.json({ sessionsEnded: await signOutEverywhere(admin.db, person.id) });
});

/**
 * Changing someone's email for them (phase B7a). Like their own change, it waits for the link sent
 * to the new address; the account keeps its address until then. Admin accounts are refused.
 */
adminAccountRoutes.post("/accounts/:id/email", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  if (person.role === "admin") return c.json({ error: "target_is_admin" }, 403);
  const newEmail = normalizeEmail((await body(c.req.raw)).newEmail);
  if (!newEmail) return c.json({ error: "invalid_email" }, 400);
  if (newEmail === person.email) return c.json({ error: "same_email" }, 400);
  // Admins may know the address is taken: it's in the console anyway.
  if (await emailInUse(admin.db, newEmail, person.id)) {
    return c.json({ error: "email_in_use" }, 409);
  }
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "account.email_change_started",
      targetUserId: person.id,
      details: { from: person.email, to: newEmail },
    },
    c.req.raw,
  );
  const { token } = await startEmailChange(admin.db, person, newEmail, admin.userId);
  const link = emailChangeLink(appOrigin(c.env, c.req.raw), token);
  await sendEmailChangeLink(c.env, { email: newEmail, name: person.name }, link, true);
  return c.json(await accountDetail(admin.db, person.id));
});

adminAccountRoutes.delete("/accounts/:id/email-change", async (c) => {
  const admin = c.var.admin;
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "account.email_change_cancelled",
      targetUserId: person.id,
    },
    c.req.raw,
  );
  if (!(await cancelEmailChange(admin.db, person.id))) return c.json({ error: "not_found" }, 404);
  return c.json(await accountDetail(admin.db, person.id));
});

/**
 * Puts back an address the account used before, at once (it was verified then), for when someone
 * else took the account over. The account is signed out everywhere and the restored address gets
 * a password reset email, since whoever changed the email probably has the password too.
 */
adminAccountRoutes.post("/accounts/:id/email/restore", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  if (person.role === "admin") return c.json({ error: "target_is_admin" }, 403);
  const email = normalizeEmail((await body(c.req.raw)).email);
  if (!email) return c.json({ error: "invalid_email" }, 400);
  if (await emailInUse(admin.db, email, person.id)) return c.json({ error: "email_in_use" }, 409);

  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "account.email_restored",
      targetUserId: person.id,
      details: { from: person.email, to: email },
    },
    c.req.raw,
  );
  const result = await restoreEmail(admin.db, person, email, admin.userId);
  if (result === "not_previous") return c.json({ error: "not_previous" }, 400);
  if (result === "email_in_use") return c.json({ error: "email_in_use" }, 409);

  const sessionsEnded = await signOutEverywhere(admin.db, person.id);
  const origin = appOrigin(c.env, c.req.raw);
  const auth = await createAuth(c.env, new Request(origin));
  await auth.api.requestPasswordReset({ body: { email, redirectTo: `${origin}/reset-password` } });
  return c.json({ detail: await accountDetail(admin.db, person.id), sessionsEnded });
});

/** A per-account exception to one limit (limit_override), with an optional end and a note. */
adminAccountRoutes.put("/accounts/:id/overrides/:key", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const key = c.req.param("key");
  if (!isLimitKey(key)) return c.json({ error: "invalid_key" }, 400);
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  const household = await accountHousehold(admin.db, person.id);
  if (!household) return c.json({ error: "no_household" }, 409);

  const input = await body(c.req.raw);
  const value = parseLimitValue(input.value);
  if (!value.ok) return c.json({ error: "invalid_value" }, 400);
  let expiresAt: Date | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined) {
    expiresAt = typeof input.expiresAt === "string" ? new Date(input.expiresAt) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      return c.json({ error: "invalid_expiry" }, 400);
    }
  }
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) || null : null;

  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "limit.override_set",
      targetUserId: person.id,
      details: {
        householdId: household.id,
        key,
        value: value.value,
        expiresAt: expiresAt?.toISOString() ?? null,
        note,
      },
    },
    c.req.raw,
  );
  await setOverride(
    admin.db,
    household.id,
    { key, value: value.value, expiresAt, note },
    admin.userId,
  );
  return c.json(await accountDetail(admin.db, person.id));
});

adminAccountRoutes.delete("/accounts/:id/overrides/:key", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const key = c.req.param("key");
  if (!isLimitKey(key)) return c.json({ error: "invalid_key" }, 400);
  const person = await findAccount(admin.db, c.req.param("id"));
  if (!person) return c.json({ error: "not_found" }, 404);
  const household = await accountHousehold(admin.db, person.id);
  if (!household) return c.json({ error: "not_found" }, 404);
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "limit.override_removed",
      targetUserId: person.id,
      details: { householdId: household.id, key },
    },
    c.req.raw,
  );
  if (!(await removeOverride(admin.db, household.id, key))) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(await accountDetail(admin.db, person.id));
});

/** Every tier limit (plan_limits). */
adminAccountRoutes.get("/limits", async (c) => c.json(await listPlanLimits(c.var.admin.db)));

adminAccountRoutes.put("/limits/:tier/:key", async (c) => {
  const admin = c.var.admin;
  const reconfirm = freshPasskeyProblem(admin);
  if (reconfirm) return c.json(reconfirm, 403);
  const tier = c.req.param("tier");
  const key = c.req.param("key");
  if (!isLimitTier(tier) || !isLimitKey(key)) return c.json({ error: "invalid_limit" }, 400);
  const value = parseLimitValue((await body(c.req.raw)).value);
  if (!value.ok) return c.json({ error: "invalid_value" }, 400);
  const before = await planLimit(admin.db, tier, key);
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "limit.tier_changed",
      details: { tier, key, from: before?.value ?? null, to: value.value },
    },
    c.req.raw,
  );
  await setPlanLimit(admin.db, tier, key, value.value, admin.userId);
  return c.json(await listPlanLimits(admin.db));
});
