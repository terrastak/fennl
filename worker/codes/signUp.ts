import { APIError } from "better-auth/api";
import { SIGN_UP_CODE_ERRORS, codeProblemMessage } from "../../shared/codes";
import type { Database } from "../db/client";
import { ensurePersonalHousehold } from "../household/household";
import { readSetting } from "../settings/settings";
import { codeProblem, findCode, releaseUse, reserveUse, saveGrant, type PromoCode } from "./codes";

/**
 * The code someone entered on the sign-up page. POST /api/sign-up/code checks it and keeps it in
 * this cookie, so it reaches Better Auth with every way of signing up: the email form, and the
 * return from Google or Apple (a top-level navigation back to /api/auth/callback, which carries
 * SameSite=Lax cookies; Apple's form post is turned into one by Better Auth).
 */
export const SIGN_UP_CODE_COOKIE = "fennl_code";
export const SIGN_UP_CODE_COOKIE_PATH = "/api/auth";
export const SIGN_UP_CODE_MAX_AGE = 30 * 60;

export function signUpCodeCookie(code: string, secure: boolean): string {
  return [
    `${SIGN_UP_CODE_COOKIE}=${encodeURIComponent(code)}`,
    `Path=${SIGN_UP_CODE_COOKIE_PATH}`,
    `Max-Age=${SIGN_UP_CODE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function codeFromCookie(headers: Headers | null | undefined): string | null {
  const cookie = headers?.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(/;\s*/)) {
    const [name, ...value] = part.split("=");
    if (name === SIGN_UP_CODE_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

/** The parts of Better Auth's endpoint context the sign-up hooks use. */
export interface SignUpContext {
  headers?: Headers | undefined;
  request?: Request | undefined;
  setCookie?: (name: string, value: string, options?: Record<string, unknown>) => unknown;
}

function refuse(code: string, message: string): never {
  throw new APIError("BAD_REQUEST", { code, message });
}

/** Codes reserved by checkSignUp, waiting for the new account to exist (keyed by the request). */
const reserved = new WeakMap<object, PromoCode>();

/**
 * Runs before Better Auth creates any account, whichever way someone signs up. While sign-up is
 * invite-only, it refuses without a usable code that allows sign-up. With a code (required or
 * not), it takes one use of it now; grantSignUpCode gives the Premium once the account exists.
 */
export async function checkSignUp(
  db: Database,
  ctx: SignUpContext | null | undefined,
  now = new Date(),
): Promise<void> {
  const required = await readSetting(db, "sign_up_requires_code");
  const entered = codeFromCookie(ctx?.headers ?? ctx?.request?.headers);
  if (!entered) {
    if (required)
      refuse(
        SIGN_UP_CODE_ERRORS.required,
        "Fennl is invite-only for now. Enter your invite code to create an account.",
      );
    return;
  }

  const code = await findCode(db, entered);
  const problem = codeProblem(code, now, { forSignUp: required });
  if (problem || !code) {
    if (required) refuse(SIGN_UP_CODE_ERRORS.invalid, codeProblemMessage(problem ?? "not_found"));
    // Sign-up is open: an unusable promo code just doesn't give anything.
    return;
  }
  if (!(await reserveUse(db, code.id, now))) {
    if (required) refuse(SIGN_UP_CODE_ERRORS.invalid, codeProblemMessage("used_up"));
    return;
  }
  if (ctx) reserved.set(ctx, code);
}

/** Runs after the account is created: the Premium for the code checkSignUp reserved. */
export async function grantSignUpCode(
  db: Database,
  userId: string,
  ctx: SignUpContext | null | undefined,
  now = new Date(),
): Promise<void> {
  const code = ctx ? reserved.get(ctx) : undefined;
  if (!ctx || !code) return;
  reserved.delete(ctx);
  try {
    const householdId = await ensurePersonalHousehold(db, userId);
    await saveGrant(db, code, { userId, householdId }, now);
  } catch (error) {
    await releaseUse(db, code.id);
    console.error("Couldn't save the Premium for a sign-up code", error);
  }
  // The code has done its job in this browser.
  try {
    ctx.setCookie?.(SIGN_UP_CODE_COOKIE, "", { path: SIGN_UP_CODE_COOKIE_PATH, maxAge: 0 });
  } catch {
    // No response to set it on (a server-side call): nothing to clear.
  }
}
