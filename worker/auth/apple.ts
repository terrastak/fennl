/**
 * Apple's "client secret" is a short JWT signed with the .p8 key from the Apple Developer
 * account (https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret).
 * It's made here, on the server, so it never has to be renewed by hand.
 */
export interface AppleKey {
  /** The Services ID, used as the OAuth client ID. */
  clientId: string;
  teamId: string;
  keyId: string;
  /** PEM text of the .p8 file. */
  privateKey: string;
}

const LIFETIME_SECONDS = 60 * 60 * 24; // Apple allows up to 6 months; a day is plenty.

let cached: { key: string; secret: string; expiresAt: number } | undefined;

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

export async function appleClientSecret(key: AppleKey, now = Date.now()): Promise<string> {
  const cacheKey = `${key.clientId}|${key.teamId}|${key.keyId}`;
  // Reuse the secret until it has less than an hour left.
  if (cached && cached.key === cacheKey && cached.expiresAt - now > 60 * 60 * 1000) {
    return cached.secret;
  }
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: "ES256", kid: key.keyId, typ: "JWT" };
  const claims = {
    iss: key.teamId,
    iat: issuedAt,
    exp: issuedAt + LIFETIME_SECONDS,
    aud: "https://appleid.apple.com",
    sub: key.clientId,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(key.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Web Crypto returns the raw r||s signature, which is exactly what ES256 JWTs use.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  const secret = `${signingInput}.${base64url(new Uint8Array(signature))}`;
  cached = { key: cacheKey, secret, expiresAt: (issuedAt + LIFETIME_SECONDS) * 1000 };
  return secret;
}
