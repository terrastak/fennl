import { Hono } from "hono";
import { recordAdminAction } from "../admin/audit";
import { requireAdmin, type AdminContext } from "../admin/requireAdmin";
import { database } from "../db/client";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import { readSetting, writeSetting } from "../settings/settings";
import {
  availableCode,
  codeById,
  codeSummary,
  codeUses,
  createCode,
  disableCode,
  listCodes,
  parseChanges,
  parseNewCode,
  toAdminCode,
  updateCode,
} from "./admin";
import { codeProblem, findCode, normalizeCode, redeemCode } from "./codes";
import { SIGN_UP_CODE_COOKIE, SIGN_UP_CODE_COOKIE_PATH, signUpCodeCookie } from "./signUp";

/** Ten tries per ten minutes: plenty for typos, far too few to guess a code. */
const CODE_TRIES = { max: 10, windowMs: 10 * 60 * 1000 };

// ---------------------------------------------------------------------------------------------
// For people: using a code at sign-up, or from the Account page.
// ---------------------------------------------------------------------------------------------

export const codeRoutes = new Hono<{ Bindings: Env }>();

/**
 * The sign-up page checks the code first, so a mistake shows before anyone leaves for Google or
 * Apple. A good code is kept in a short-lived cookie for Better Auth's sign-up hook, which checks
 * it again (worker/codes/signUp.ts).
 */
codeRoutes.post("/api/sign-up/code", async (c) => {
  const db = database(c.env.DB);
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await withinRateLimit(db, `sign-up-code:${ip}`, CODE_TRIES))) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
  if (!normalizeCode(body.code)) return c.json({ error: "invalid" }, 400);

  const required = await readSetting(db, "sign_up_requires_code");
  const code = await findCode(db, body.code);
  const problem = codeProblem(code, new Date(), { forSignUp: required });
  if (problem || !code) return c.json({ error: problem ?? "not_found" }, 400);

  c.header("set-cookie", signUpCodeCookie(code.code, new URL(c.req.url).protocol === "https:"));
  return c.json({ ok: true });
});

/** Forgets a code entered earlier (the person cleared the field). */
codeRoutes.delete("/api/sign-up/code", (c) => {
  c.header(
    "set-cookie",
    `${SIGN_UP_CODE_COOKIE}=; Path=${SIGN_UP_CODE_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
  return c.json({ ok: true });
});

/** A signed-in person uses a code for their household. */
codeRoutes.post("/api/codes/redeem", requireHousehold, async (c) => {
  const { db, userId, household } = c.var.signedIn;
  if (!(await withinRateLimit(db, `redeem-code:${userId}`, CODE_TRIES))) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
  if (!normalizeCode(body.code)) return c.json({ error: "invalid" }, 400);
  const result = await redeemCode(db, body.code, { userId, householdId: household.householdId });
  if (!result.ok) return c.json({ error: result.problem }, 400);
  return c.json(await householdEntitlements(db, household.householdId));
});

// ---------------------------------------------------------------------------------------------
// For admins: making and managing codes, and the invite-only switch. Every change is recorded in
// the audit log first (no record, no change).
// ---------------------------------------------------------------------------------------------

export const adminCodeRoutes = new Hono<{ Bindings: Env; Variables: { admin: AdminContext } }>();

adminCodeRoutes.use("*", requireAdmin);

adminCodeRoutes.get("/codes", async (c) => c.json(await listCodes(c.var.admin.db)));

adminCodeRoutes.post("/codes", async (c) => {
  const admin = c.var.admin;
  const parsed = parseNewCode(await c.req.json<unknown>().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const code = await availableCode(admin.db, parsed.value.code);
  if (!code) return c.json({ error: "code_taken" }, 409);
  const input = { ...parsed.value, code };
  await recordAdminAction(
    c.env,
    { adminUserId: admin.userId, action: "code.created", details: { ...input } },
    c.req.raw,
  );
  const created = await createCode(admin.db, input, admin.userId);
  return c.json(toAdminCode(created), 201);
});

adminCodeRoutes.get("/codes/:id", async (c) => {
  const code = await codeById(c.var.admin.db, c.req.param("id"));
  if (!code) return c.json({ error: "not_found" }, 404);
  return c.json({ code: toAdminCode(code), uses: await codeUses(c.var.admin.db, code) });
});

adminCodeRoutes.patch("/codes/:id", async (c) => {
  const admin = c.var.admin;
  const code = await codeById(admin.db, c.req.param("id"));
  if (!code) return c.json({ error: "not_found" }, 404);
  const parsed = parseChanges(await c.req.json<unknown>().catch(() => null), code);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "code.updated",
      details: { before: codeSummary(code), changes: parsed.value },
    },
    c.req.raw,
  );
  await updateCode(admin.db, code, parsed.value);
  const updated = await codeById(admin.db, code.id);
  return c.json(toAdminCode(updated ?? code));
});

adminCodeRoutes.post("/codes/:id/disable", async (c) => {
  const admin = c.var.admin;
  const code = await codeById(admin.db, c.req.param("id"));
  if (!code) return c.json({ error: "not_found" }, 404);
  if (code.disabledAt) return c.json({ error: "already_disabled" }, 409);
  const body = await c.req.json<{ endAccess?: unknown }>().catch(() => ({ endAccess: undefined }));
  const endAccess = body.endAccess === true;
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "code.disabled",
      details: { ...codeSummary(code), endAccess },
    },
    c.req.raw,
  );
  await disableCode(admin.db, code, endAccess);
  const updated = await codeById(admin.db, code.id);
  return c.json(toAdminCode(updated ?? code));
});

adminCodeRoutes.get("/settings", async (c) =>
  c.json({ signUpRequiresCode: await readSetting(c.var.admin.db, "sign_up_requires_code") }),
);

adminCodeRoutes.put("/settings", async (c) => {
  const admin = c.var.admin;
  const body = await c.req
    .json<{ signUpRequiresCode?: unknown }>()
    .catch(() => ({ signUpRequiresCode: undefined }));
  if (typeof body.signUpRequiresCode !== "boolean") {
    return c.json({ error: "invalid_setting" }, 400);
  }
  const before = await readSetting(admin.db, "sign_up_requires_code");
  await recordAdminAction(
    c.env,
    {
      adminUserId: admin.userId,
      action: "setting.changed",
      details: { key: "sign_up_requires_code", from: before, to: body.signUpRequiresCode },
    },
    c.req.raw,
  );
  await writeSetting(admin.db, "sign_up_requires_code", body.signUpRequiresCode, admin.userId);
  return c.json({ signUpRequiresCode: body.signUpRequiresCode });
});
