import { describe, expect, it } from "vitest";
import {
  encryptForBrowser,
  fromBase64Url,
  pushKey,
  toBase64Url,
  vapidAuthorization,
} from "./webPush";

// U10: Web Push messages, checked against the worked example in RFC 8291 (Appendix A).

const strip = (text: string) => text.replace(/\s+/g, "");

describe("encrypting for a browser", () => {
  it("matches RFC 8291's example exactly", async () => {
    const asPublic = fromBase64Url(
      strip(`BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg
             Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8`),
    );
    const body = await encryptForBrowser(
      fromBase64Url("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
      {
        p256dh: strip(`BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-
                       JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4`),
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      {
        salt: fromBase64Url("DGv6ra1nlYgDCS1FRnbzlw"),
        senderKey: {
          kty: "EC",
          crv: "P-256",
          d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
          x: toBase64Url(asPublic.slice(1, 33)),
          y: toBase64Url(asPublic.slice(33, 65)),
        },
      },
    );
    // The message in section 5 of the RFC.
    expect(toBase64Url(body)).toBe(
      strip(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
             mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
             pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`),
    );
  });
});

describe("Fennl's push key", () => {
  it("is missing without the secret, and refused when it isn't a key", async () => {
    expect(await pushKey(undefined)).toBeNull();
    expect(await pushKey("not a key")).toBeNull();
  });

  it("signs a token the public key checks, for the push service's own address", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const key = (await pushKey(JSON.stringify(jwk)))!;
    const raw = new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    );
    expect(key.publicKey).toBe(toBase64Url(raw));

    const now = Date.UTC(2026, 9, 28, 12);
    const header = await vapidAuthorization(
      "https://web.push.apple.com/QGuQyavXutnMrRw",
      key,
      "https://fennl.example",
      now,
    );
    const match = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
    expect(match[4]).toBe(key.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(match[2]!))) as object;
    expect(claims).toEqual({
      aud: "https://web.push.apple.com",
      exp: now / 1000 + 12 * 60 * 60,
      sub: "https://fennl.example",
    });
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      fromBase64Url(match[3]!),
      new TextEncoder().encode(`${match[1]}.${match[2]}`),
    );
    expect(verified).toBe(true);
  });
});
