/**
 * Cloudflare Access sits in front of the admin area (CLAUDE.md, "Admin console"): people sign in
 * to Access before any Fennl code runs. The Worker still checks, so a request that somehow
 * skips Access (a misconfiguration, a missing policy) is refused here too.
 *
 * A request passes if either:
 *  - Cloudflare says Access authenticated it (ctx.access, with an audience tag we expect), or
 *  - it carries a valid Access token (the Cf-Access-Jwt-Assertion header, or else the
 *    CF_Authorization cookie Access sets: RS256, signed by the team's current keys, issued by our
 *    team, for one of our audience tags, not expired).
 * Fennl's Worker serves static assets, and Cloudflare doesn't pass ctx.access to such Workers
 * (checked 2026-10-06), so in practice the token is what's checked.
 * In local development only, ACCESS_DEV_BYPASS=true lets requests to localhost through.
 */
interface AccessJwk extends JsonWebKey {
  kid: string;
}

interface AccessSettings {
  teamDomain: string;
  audiences: string[];
}

const KEYS_CACHE_MS = 60 * 60 * 1000;
let keyCache: { teamDomain: string; loadedAt: number; keys: AccessJwk[] } | undefined;

export function forgetCachedAccessKeys(): void {
  keyCache = undefined;
}

function accessSettings(env: Env): AccessSettings | null {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const audiences = (env.ACCESS_AUD ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  return teamDomain && audiences.length > 0 ? { teamDomain, audiences } : null;
}

function base64UrlDecode(part: string): Uint8Array {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function teamKeys(teamDomain: string, now: number, refresh = false): Promise<AccessJwk[]> {
  if (!refresh && keyCache?.teamDomain === teamDomain && now - keyCache.loadedAt < KEYS_CACHE_MS) {
    return keyCache.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Couldn't fetch Access keys (${res.status})`);
  const body = (await res.json()) as { keys?: AccessJwk[] };
  keyCache = { teamDomain, loadedAt: now, keys: body.keys ?? [] };
  return keyCache.keys;
}

/** Checks a Cf-Access-Jwt-Assertion token. Returns false for anything that isn't valid. */
export async function verifyAccessToken(
  token: string,
  settings: AccessSettings,
  now = Date.now(),
): Promise<boolean> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return false;
  const header = decodeJson(headerPart);
  const claims = decodeJson(payloadPart);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return false;

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.some((aud) => typeof aud === "string" && settings.audiences.includes(aud))) {
    return false;
  }
  if (claims.iss !== `https://${settings.teamDomain}`) return false;
  const seconds = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp <= seconds) return false;
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) return false;

  // Keys rotate; if the token names a key we don't have, fetch the current set once.
  let keys = await teamKeys(settings.teamDomain, now);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await teamKeys(settings.teamDomain, now, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return false;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
}

/** The CF_Authorization cookie Cloudflare Access sets after sign-in. */
function accessCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(/;\s*/)) {
    const [name, ...value] = part.split("=");
    if (name === "CF_Authorization" && value.length > 0) return value.join("=");
  }
  return null;
}

function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

/** True only if Cloudflare Access let this request through (see the top of this file). */
export async function passedAccess(
  request: Request,
  env: Env,
  access: CloudflareAccessContext | undefined,
): Promise<boolean> {
  const settings = accessSettings(env);
  if (settings) {
    if (access && settings.audiences.includes(access.aud)) return true;
    const token = request.headers.get("cf-access-jwt-assertion") ?? accessCookie(request);
    if (token) {
      try {
        return await verifyAccessToken(token, settings);
      } catch {
        return false;
      }
    }
    return false;
  }
  // Not configured: closed, except for local development.
  return env.ACCESS_DEV_BYPASS === "true" && isLocalhost(new URL(request.url));
}
