import { env } from "cloudflare:test";
import { app } from "../index";
import { ORIGIN } from "./visitor";

// Pretend Resend events for Worker tests (phase U14), signed the way Resend's (Svix) are.

function base64(bytes: ArrayBuffer | Uint8Array): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The svix-signature header's value for a body, signed with a `whsec_` secret. */
export async function svixSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${base64(signature)}`;
}

/** Posts an event to POST /api/email/events, signed with the test secret unless told otherwise. */
export async function postEmailEvent(
  event: unknown,
  options: { secret?: string; timestamp?: number; signed?: boolean; env?: Env } = {},
) {
  const body = JSON.stringify(event);
  const id = `msg_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor((options.timestamp ?? Date.now()) / 1000));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.signed !== false) {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = timestamp;
    headers["svix-signature"] = await svixSignature(
      options.secret ?? env.RESEND_WEBHOOK_SECRET!,
      id,
      timestamp,
      body,
    );
  }
  return app.request(
    `${ORIGIN}/api/email/events`,
    { method: "POST", headers, body },
    options.env ?? env,
  );
}

/** An email event for one email, as Resend sends it. */
export function emailEvent(
  type: string,
  emailId: string,
  extra: Record<string, unknown> = {},
  createdAt = new Date(),
) {
  return {
    type,
    created_at: createdAt.toISOString(),
    data: { email_id: emailId, created_at: createdAt.toISOString(), ...extra },
  };
}
