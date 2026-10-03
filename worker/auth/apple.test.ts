import { describe, expect, it } from "vitest";
import { appleClientSecret } from "./apple";

function decode(part: string) {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64)) as Record<string, unknown>;
}

function toPem(der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

describe("Apple client secret", () => {
  it("is an ES256 JWT that Apple's checks accept", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pem = toPem((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const now = Date.UTC(2026, 9, 3);

    const jwt = await appleClientSecret(
      { clientId: "app.fennl.signin", teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem },
      now,
    );
    const [header, claims, signature] = jwt.split(".");

    expect(decode(header!)).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    expect(decode(claims!)).toEqual({
      iss: "TEAM123456",
      iat: now / 1000,
      exp: now / 1000 + 86400,
      aud: "https://appleid.apple.com",
      sub: "app.fennl.signin",
    });
    const sig = Uint8Array.from(atob(signature!.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      sig,
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it("accepts a key pasted with literal \\n instead of line breaks", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
    ])) as CryptoKeyPair;
    const pem = toPem((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const jwt = await appleClientSecret({
      clientId: "other.client",
      teamId: "T",
      keyId: "K",
      privateKey: pem.replace(/\n/g, "\\n"),
    });
    expect(jwt.split(".")).toHaveLength(3);
  });
});
