import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetCachedAccessKeys, passedAccess, verifyAccessToken } from "./access";

const TEAM = "fennl-test.cloudflareaccess.com";
const AUD = "aud-admin-123";
const SETTINGS = { teamDomain: TEAM, audiences: [AUD] };

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey;

async function sign(claims: Record<string, unknown>, kid = "key-1", key = keyPair.privateKey) {
  const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

const now = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({
  aud: [AUD],
  iss: `https://${TEAM}`,
  exp: now() + 600,
  iat: now(),
  email: "owner@example.com",
});

beforeEach(async () => {
  forgetCachedAccessKeys();
  keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [{ ...publicJwk, kid: "key-1", alg: "RS256" }] });
    }
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Cloudflare Access tokens", () => {
  it("accept a token signed by the team for our application", async () => {
    expect(await verifyAccessToken(await sign(goodClaims()), SETTINGS)).toBe(true);
  });

  it("refuse tokens for another application, another team, or that have expired", async () => {
    expect(await verifyAccessToken(await sign({ ...goodClaims(), aud: ["other"] }), SETTINGS)).toBe(
      false,
    );
    expect(
      await verifyAccessToken(
        await sign({ ...goodClaims(), iss: "https://evil.cloudflareaccess.com" }),
        SETTINGS,
      ),
    ).toBe(false);
    expect(await verifyAccessToken(await sign({ ...goodClaims(), exp: now() - 1 }), SETTINGS)).toBe(
      false,
    );
  });

  it("refuse tokens signed with any other key, or tampered with", async () => {
    const stranger = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    expect(
      await verifyAccessToken(await sign(goodClaims(), "key-1", stranger.privateKey), SETTINGS),
    ).toBe(false);
    expect(await verifyAccessToken(await sign(goodClaims(), "unknown-key"), SETTINGS)).toBe(false);

    const [header, , signature] = (await sign(goodClaims())).split(".");
    const forged = b64url(JSON.stringify({ ...goodClaims(), email: "attacker@example.com" }));
    expect(await verifyAccessToken(`${header}.${forged}.${signature}`, SETTINGS)).toBe(false);
    expect(await verifyAccessToken("not-a-token", SETTINGS)).toBe(false);
  });
});

/** The test environment without the local-development switch. */
function withoutBypass(): Env {
  const { ACCESS_DEV_BYPASS: _bypass, ...rest } = env;
  void _bypass;
  return rest;
}

describe("passing Access", () => {
  const configured = { ...env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const request = (headers: Record<string, string> = {}, url = "https://admin.example.test/") =>
    new Request(url, { headers });

  it("trusts Cloudflare's own Access context for our application", async () => {
    expect(await passedAccess(request(), configured, { aud: AUD } as CloudflareAccessContext)).toBe(
      true,
    );
    expect(
      await passedAccess(request(), configured, { aud: "other" } as CloudflareAccessContext),
    ).toBe(false);
  });

  it("checks the token header otherwise", async () => {
    const token = await sign(goodClaims());
    expect(
      await passedAccess(request({ "cf-access-jwt-assertion": token }), configured, undefined),
    ).toBe(true);
    expect(await passedAccess(request(), configured, undefined)).toBe(false);
  });

  it("lets the local-development switch work only on localhost, and only when unconfigured", async () => {
    const bypass = { ...env, ACCESS_DEV_BYPASS: "true" };
    expect(await passedAccess(request({}, "http://localhost:5173/admin"), bypass, undefined)).toBe(
      true,
    );
    expect(
      await passedAccess(request({}, "https://admin.example.test/admin"), bypass, undefined),
    ).toBe(false);
    expect(
      await passedAccess(
        request({}, "http://localhost:5173/admin"),
        { ...configured, ACCESS_DEV_BYPASS: "true" },
        undefined,
      ),
    ).toBe(false);
    expect(
      await passedAccess(request({}, "http://localhost:5173/admin"), withoutBypass(), undefined),
    ).toBe(false);
  });
});
