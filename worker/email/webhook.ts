/**
 * Checks that a request to POST /api/email/events really comes from Resend (phase U14). Resend
 * sends its webhooks through Svix, which signs each one: an HMAC-SHA256 of
 * `${id}.${timestamp}.${body}` keyed with the signing secret (its `whsec_` prefix removed, then
 * base64-decoded), in a `svix-signature` header of space-separated `v1,<base64>` entries
 * (https://docs.svix.com/receiving/verifying-payloads/how-manual, checked 2026-11-04). Written
 * with the Worker's own WebCrypto, no library.
 */

/** How far a request's timestamp may be from now, either way (Standard Webhooks' default). */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export type WebhookCheck = "ok" | "missing_headers" | "stale" | "bad_signature";

function header(headers: Headers, name: string): string | null {
  return headers.get(`svix-${name}`) ?? headers.get(`webhook-${name}`);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Checks the request's signature headers against its raw body, before anything is read. */
export async function verifyWebhook(
  secret: string,
  headers: Headers,
  body: string,
  nowMs = Date.now(),
): Promise<WebhookCheck> {
  const id = header(headers, "id");
  const timestamp = header(headers, "timestamp");
  const signatures = header(headers, "signature");
  if (!id || !timestamp || !signatures) return "missing_headers";
  if (!/^\d{1,12}$/.test(timestamp)) return "stale";
  if (Math.abs(nowMs - Number(timestamp) * 1000) > WEBHOOK_TOLERANCE_MS) return "stale";

  const keyBytes = fromBase64(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  if (!keyBytes) return "bad_signature";
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const entry of signatures.split(" ")) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    const signature = fromBase64(value);
    if (!signature) continue;
    // crypto.subtle.verify compares in constant time.
    if (await crypto.subtle.verify("HMAC", key, signature, signed)) return "ok";
  }
  return "bad_signature";
}
