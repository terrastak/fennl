// Sending a Web Push message (U10): the standard every browser's push service takes, done with the
// Worker's own WebCrypto, so no library. Two parts:
//
// - Fennl says who it is with a signed token (VAPID, RFC 8292), made from the key in the Worker
//   secret PUSH_PRIVATE_KEY. The browser was given the matching public key when it subscribed,
//   and its push service only takes messages signed by it.
// - What's sent is encrypted for that one browser (RFC 8291, "aes128gcm"), so the push service
//   (Apple, Google, Mozilla, Microsoft) passes it on without being able to read it.

const encoder = new TextEncoder();

function text(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(encoder.encode(value));
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const plain = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(plain + "=".repeat((4 - (plain.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

/** HKDF with one block of output, which is all Web Push needs (RFC 8291 section 3.4). */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** An uncompressed P-256 public key (65 bytes) as a JWK's x and y. */
function publicJwk(raw: Uint8Array): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(raw.slice(1, 33)),
    y: toBase64Url(raw.slice(33, 65)),
  };
}

function rawPublic(jwk: JsonWebKey): Uint8Array<ArrayBuffer> {
  if (!jwk.x || !jwk.y) throw new Error("Not a P-256 key");
  return concat(new Uint8Array([4]), fromBase64Url(jwk.x), fromBase64Url(jwk.y));
}

/** ECDH with the other side's public key (the Workers types call it "$public"; it's "public"). */
export function ecdhWith(publicKey: CryptoKey): SubtleCryptoDeriveKeyAlgorithm {
  return { name: "ECDH", public: publicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
}

/** Fixed values, for checking against the example in RFC 8291 only. */
export interface EncryptOptions {
  salt?: Uint8Array<ArrayBuffer>;
  /** The one-off sender key, as a private JWK. */
  senderKey?: JsonWebKey;
}

/**
 * The message body for one browser (RFC 8291): a one-off key pair and the browser's public key
 * make a shared secret, mixed with the browser's auth secret into the key and nonce for AES-GCM.
 */
export async function encryptForBrowser(
  plaintext: Uint8Array<ArrayBuffer>,
  browser: { p256dh: string; auth: string },
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromBase64Url(browser.p256dh);
  const authSecret = fromBase64Url(browser.auth);
  const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;

  let senderPrivate: CryptoKey;
  let senderPublic: Uint8Array<ArrayBuffer>;
  if (options.senderKey) {
    senderPrivate = await crypto.subtle.importKey("jwk", options.senderKey, ecdh, false, [
      "deriveBits",
    ]);
    senderPublic = rawPublic(options.senderKey);
  } else {
    const pair = (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    senderPublic = new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    );
  }
  const browserKey = await crypto.subtle.importKey("jwk", publicJwk(uaPublic), ecdh, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhWith(browserKey), senderPrivate, 256),
  );

  const keyInfo = concat(text("WebPush: info\0"), uaPublic, senderPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the message, then the delimiter that marks the last record.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      concat(plaintext, new Uint8Array([2])),
    ),
  );
  // Header: salt, record size (4096), the sender key's length and the key itself.
  const header = concat(salt, new Uint8Array([0, 0, 16, 0, senderPublic.length]), senderPublic);
  return concat(header, ciphertext);
}

/** Fennl's push key, from the Worker secret (a private JWK, made by CI; ci.yml). */
export interface PushKey {
  privateKey: CryptoKey;
  /** What browsers subscribe with (applicationServerKey). */
  publicKey: string;
}

export async function pushKey(secret: string | undefined): Promise<PushKey | null> {
  if (!secret) return null;
  try {
    const jwk = JSON.parse(secret) as JsonWebKey;
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    return { privateKey, publicKey: toBase64Url(rawPublic(jwk)) };
  } catch (error) {
    console.error("PUSH_PRIVATE_KEY isn't a P-256 private key", error);
    return null;
  }
}

/**
 * The Authorization header (RFC 8292): a token for the push service's own address, valid 12
 * hours, naming who to contact (`subject`, Fennl's address).
 */
export async function vapidAuthorization(
  endpoint: string,
  key: PushKey,
  subject: string,
  now = Date.now(),
): Promise<string> {
  const json = (value: object) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${json({ typ: "JWT", alg: "ES256" })}.${json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject,
  })}`;
  // WebCrypto's ECDSA signature is r and s side by side, exactly what a JWT's ES256 wants.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key.privateKey,
      encoder.encode(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${key.publicKey}`;
}

/** "sent"; "gone": the browser unsubscribed, forget it; "failed": try again shortly. */
export type PushResult = "sent" | "gone" | "failed";

export async function sendPush(
  browser: { endpoint: string; p256dh: string; auth: string },
  message: object,
  key: PushKey,
  subject: string,
  options: { ttlSeconds: number },
): Promise<PushResult> {
  const body = await encryptForBrowser(text(JSON.stringify(message)), browser);
  const headers: Record<string, string> = {
    authorization: await vapidAuthorization(browser.endpoint, key, subject),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(options.ttlSeconds),
    urgency: "high",
  };
  let res: Response;
  try {
    res = await fetch(browser.endpoint, { method: "POST", headers, body });
  } catch (error) {
    console.error("Couldn't reach the push service", error);
    return "failed";
  }
  if (res.ok) return "sent";
  // 404 and 410: the subscription has ended (RFC 8030 section 7.3).
  if (res.status === 404 || res.status === 410) return "gone";
  console.error(`Push service answered ${res.status}: ${await res.text().catch(() => "")}`);
  // Anything else but a busy or failing service won't work on a retry either (a 403, for one, is
  // a subscription made with an earlier push key).
  return res.status === 429 || res.status >= 500 ? "failed" : "gone";
}
