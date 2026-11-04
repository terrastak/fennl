/**
 * The proof "Check your email" shows the server (phase U14): only the browser that just signed
 * up, or just signed in with the right password before verifying, may ask whether the sign-up
 * link arrived and fix a mistyped address. A signed cookie, `fennl_sign_up`, holding
 * `<user id>.<expiry in ms>.<signature>`, the signature an HMAC-SHA256 with BETTER_AUTH_SECRET.
 * Nothing is stored: every use re-checks the account (worker/account/signUpRoutes.ts), and it
 * ends with the account's 24 hours (worker/account/purge.ts).
 *
 * An address that already has an account gets a made-up user id from Better Auth's sign-up, so
 * its browser gets a proof that looks the same and leads nowhere: nothing shows which addresses
 * have accounts.
 */

export const SIGN_UP_PROOF_COOKIE = "fennl_sign_up";
export const SIGN_UP_PROOF_PATH = "/api/sign-up";
/** How long a proof lasts at most: the time an unverified account is kept. */
export const SIGN_UP_PROOF_MS = 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signed(userId: string, expiresAtMs: number) {
  return encoder.encode(`fennl-sign-up:${userId}.${expiresAtMs}`);
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** The cookie's value for this account, good until `expiresAtMs`. */
export async function signUpProof(
  secret: string,
  userId: string,
  expiresAtMs: number,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    signed(userId, expiresAtMs),
  );
  return `${userId}.${expiresAtMs}.${toBase64Url(signature)}`;
}

/** The Set-Cookie header for a proof, sent only to Fennl's own /api/sign-up routes. */
export function signUpProofCookie(
  value: string,
  expiresAtMs: number,
  secure: boolean,
  now = Date.now(),
): string {
  const maxAge = Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
  return [
    `${SIGN_UP_PROOF_COOKIE}=${value}`,
    `Path=${SIGN_UP_PROOF_PATH}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function proofFromCookie(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(/;\s*/)) {
    const [name, ...value] = part.split("=");
    if (name === SIGN_UP_PROOF_COOKIE) return value.join("=");
  }
  return null;
}

/**
 * The user id a request's proof names, when its signature checks out and it hasn't expired.
 * That alone doesn't mean the account exists: a decoy's id names nobody.
 */
export async function provenUserId(
  secret: string,
  headers: Headers,
  now = Date.now(),
): Promise<string | null> {
  const proof = proofFromCookie(headers);
  if (!proof) return null;
  const parts = proof.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts as [string, string, string];
  if (!userId || !/^\d{1,15}$/.test(expires)) return null;
  const expiresAtMs = Number(expires);
  if (expiresAtMs <= now) return null;
  const bytes = fromBase64Url(signature);
  if (!bytes) return null;
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify(
    "HMAC",
    await key(secret),
    bytes,
    signed(userId, expiresAtMs),
  );
  return ok ? userId : null;
}
