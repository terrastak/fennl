import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { isColorScheme } from "../shared/appearance";
import { healthStatus } from "../shared/health";
import { removeUnverifiedAccounts } from "./account/purge";
import { accountRoutes } from "./account/routes";
import { adminAccountRoutes } from "./admin/accountRoutes";
import { accountNames } from "./admin/accounts";
import { passedAccess } from "./admin/access";
import { adminAreaAllowedOn, isAdminPath, isStaticFile, onAdminHost } from "./admin/area";
import { recentAdminActions } from "./admin/audit";
import { accessContext, checkAdmin, passkeyCount, requireAdmin } from "./admin/requireAdmin";
import { createAuth, signInMethods } from "./auth/auth";
import { adminCodeRoutes, codeRoutes } from "./codes/routes";
import { deviceRoutes } from "./devices/routes";
import { adminFeedbackRoutes, feedbackRoutes } from "./feedback/routes";
import { database, databaseStatus } from "./db/client";
import { passkey, user } from "./db/schema";
import { devOutbox } from "./email/outbox";
import { householdEntitlements } from "./entitlements/entitlements";
import { householdSummary } from "./household/household";
import { requireHousehold } from "./household/requireHousehold";
import { readSetting } from "./settings/settings";
import { syncRoutes } from "./sync/routes";

// Every request reaches this Worker first (run_worker_first in wrangler.jsonc). It answers /api/*,
// keeps the admin area to its own address, and hands everything else to the built files.
export const app = new Hono<{ Bindings: Env }>();

/** The app's "Page not found" screen, with a real 404 status. */
async function appNotFound(c: Context<{ Bindings: Env }>) {
  const page = await c.env.ASSETS.fetch(new Request(new URL("/", c.req.url)));
  return new Response(page.body, { status: 404, headers: page.headers });
}

// Where the admin area may appear (worker/admin/area.ts).
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  if (isAdminPath(path) && !adminAreaAllowedOn(c.env, url)) {
    return path.startsWith("/api/") ? c.json({ error: "not_found" }, 404) : appNotFound(c);
  }
  if (onAdminHost(c.env, url)) {
    // The admin address serves the admin console and the APIs it needs, nothing else.
    const allowedApi =
      path === "/api/health" || path.startsWith("/api/admin/") || path.startsWith("/api/auth/");
    if (path.startsWith("/api/") && !allowedApi) return c.json({ error: "not_found" }, 404);
    if (!path.startsWith("/api/") && !isAdminPath(path) && !isStaticFile(path)) {
      return c.redirect("/admin", 302);
    }
  }
  await next();
});

app.get("/api/health", async (c) => {
  const health = healthStatus(await databaseStatus(database(c.env.DB)));
  return c.json(health, health.status === "ok" ? 200 : 503);
});

// Which build the server runs, so an open app can tell when a newer release is live (phase C4).
// Tests run without a build, so there's no version there.
app.get("/api/version", (c) =>
  c.json({ version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev" }),
);

// Better Auth's household (organization) endpoints stay closed until sharing is built (phase G1):
// people must not create, delete, rename or switch households on their own.
app.all("/api/auth/organization/*", (c) => c.json({ error: "not_found" }, 404));

// Better Auth's admin endpoints (set-role, impersonate, ban...) are never reachable from outside.
// The admin role is granted only by a database command; Fennl's own /api/admin routes call the
// plugin from the server when a tool needs it (phases B7 and C12).
app.all("/api/auth/admin/*", (c) => c.json({ error: "not_found" }, 404));

// Passkeys belong to the admin area: past Cloudflare Access, and registration only for admins.
// An admin without any passkey may register a first one from a password session (to set up
// the account); after that, adding one needs a passkey session.
app.all("/api/auth/passkey/*", async (c, next) => {
  const path = new URL(c.req.url).pathname.replace("/api/auth/passkey/", "");
  if (!(await passedAccess(c.req.raw, c.env, accessContext(c)))) {
    return c.json({ error: "access_required" }, 403);
  }
  if (path === "generate-authenticate-options" || path === "verify-authentication") {
    return next();
  }
  if (path === "generate-register-options" || path === "verify-registration") {
    const auth = await createAuth(c.env, c.req.raw);
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) return c.json({ error: "signed_out" }, 401);
    if (result.user.role !== "admin") return c.json({ error: "not_admin" }, 403);
    if (result.session.authMethod !== "passkey") {
      const db = database(c.env.DB);
      if ((await passkeyCount(db, result.user.id)) > 0) {
        return c.json({ error: "passkey_required" }, 403);
      }
    }
    return next();
  }
  // Listing, renaming and deleting passkeys: full admin checks.
  const check = await checkAdmin(c.req.raw, c.env, accessContext(c));
  if (!check.ok) return c.json(check.body, check.status);
  return next();
});

// Sign-up, sign-in, sign-out, sessions, email verification and password reset (Better Auth).
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = await createAuth(c.env, c.req.raw);
  return auth.handler(c.req.raw);
});

// Which sign-in buttons the app should show on this deployment, and whether creating an account
// needs an invite code right now.
app.get("/api/sign-in-methods", async (c) =>
  c.json({
    ...signInMethods(c.env),
    signUpCodeRequired: await readSetting(database(c.env.DB), "sign_up_requires_code"),
  }),
);

// Invite and promo codes: at sign-up and from the Account page.
app.route("/", codeRoutes);

// The browsers each household uses, and the device limit (phase B6).
app.route("/", deviceRoutes);

// Sending and fetching recipe changes (phase C3).
app.route("/", syncRoutes);

// The caller's household, for the Account page.
app.get("/api/household", requireHousehold, async (c) => {
  const { db, userId, household } = c.var.signedIn;
  return c.json(await householdSummary(db, household, userId));
});

// What the caller's household may do: its plan and limits (computed here, never by the app).
app.get("/api/entitlements", requireHousehold, async (c) => {
  const { db, household } = c.var.signedIn;
  return c.json(await householdEntitlements(db, household.householdId));
});

// Choosing a new password, required after a temporary one from support (phase B7). Not behind
// requireHousehold, which refuses until this is done.
app.post("/api/account/password", async (c) => {
  const auth = await createAuth(c.env, c.req.raw);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  } | null;
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return c.json({ error: "invalid" }, 400);
  }
  if (currentPassword === newPassword) return c.json({ error: "SAME_PASSWORD" }, 400);
  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: false },
      headers: c.req.raw.headers,
    });
  } catch (error) {
    const code = (error as { body?: { code?: string } }).body?.code ?? "FAILED";
    return c.json({ error: code }, 400);
  }
  await database(c.env.DB)
    .update(user)
    .set({ mustChangePassword: false })
    .where(eq(user.id, result.user.id));
  return c.json({ ok: true });
});

// Sending feedback from the app (phase B8).
app.route("/", feedbackRoutes);

// Changing the account's email address (phase B7a).
app.route("/", accountRoutes);

// The account's color scheme, which follows the person to every device.
app.put("/api/account/appearance", requireHousehold, async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  const colorScheme = (body as { colorScheme?: unknown } | null)?.colorScheme;
  if (!isColorScheme(colorScheme)) return c.json({ error: "invalid_color_scheme" }, 400);
  const { db, userId } = c.var.signedIn;
  await db.update(user).set({ colorScheme }).where(eq(user.id, userId));
  return c.json({ colorScheme });
});

// The admin console's own data. Every route here goes through requireAdmin.
app.get("/api/admin/me", requireAdmin, async (c) => {
  const admin = c.var.admin;
  const passkeys = await admin.db
    .select({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt })
    .from(passkey)
    .where(eq(passkey.userId, admin.userId))
    .all();
  return c.json({
    name: admin.name,
    email: admin.email,
    signedInAt: admin.signedInAt.toISOString(),
    expiresAt: admin.expiresAt.toISOString(),
    passkeys,
  });
});

// The activity log, newest first; ?account=<user id> shows only actions by or about that account.
app.get("/api/admin/audit", requireAdmin, async (c) => {
  const rows = await recentAdminActions(c.env, 100, c.req.query("account") || undefined);
  const names = await accountNames(
    c.var.admin.db,
    [...new Set(rows.flatMap((r) => [r.adminUserId, r.targetUserId ?? ""]))].filter(Boolean),
  );
  return c.json(
    rows.map((row) => ({
      ...row,
      adminEmail: names.get(row.adminUserId) ?? null,
      targetEmail: row.targetUserId ? (names.get(row.targetUserId) ?? null) : null,
      details: row.details ? (JSON.parse(row.details) as unknown) : null,
    })),
  );
});

// Codes and the invite-only switch (phase B5).
app.route("/api/admin", adminCodeRoutes);

// Account lookup, password help, overrides and tier limits (phase B7).
app.route("/api/admin", adminAccountRoutes);

// The feedback inbox (phase B8).
app.route("/api/admin", adminFeedbackRoutes);

app.all("/api/admin/*", (c) => c.json({ error: "not_found" }, 404));

// Local development and tests only: emails that would have been sent.
app.get("/api/dev/outbox", (c) => {
  if (c.env.DEV_EMAIL_OUTBOX !== "true" || c.env.RESEND_API_KEY) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(devOutbox.list(c.req.query("to")));
});

// The admin console's page. The API above does the real checks; this keeps the page itself
// behind Access too.
app.get("/admin", serveAdmin);
app.get("/admin/*", serveAdmin);

async function serveAdmin(c: Context<{ Bindings: Env }>) {
  if (!(await passedAccess(c.req.raw, c.env, accessContext(c)))) {
    return c.text("The admin area is closed.", 403);
  }
  return c.env.ASSETS.fetch(new Request(new URL("/admin", c.req.url)));
}

// Everything else: unknown API routes get JSON; pages and files come from the built app.
app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

/**
 * Scheduled work (wrangler.jsonc "triggers"). Every hour: remove accounts whose email was never
 * verified (worker/account/purge.ts).
 */
async function scheduled(_controller: ScheduledController, env: Env) {
  const removed = await removeUnverifiedAccounts(database(env.DB));
  if (removed.length > 0) {
    // Kept in the Worker's logs (no admin did this, so it isn't in the admin audit log).
    console.log(`Removed ${removed.length} account(s) never verified: ${removed.join(", ")}`);
  }
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
