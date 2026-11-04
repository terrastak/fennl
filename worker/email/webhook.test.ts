import { describe, expect, it } from "vitest";
import { verifyWebhook } from "./webhook";

// Svix's own example (https://docs.svix.com/receiving/verifying-payloads/how-manual).
const SECRET = "whsec_plJ3nmyCDGBKInavdOK15jsl";
const BODY = '{"event_type":"ping","data":{"success":true}}';
const ID = "msg_loFOjxBNrRLzqYUf";
const TIMESTAMP = "1731705121";
const SIGNATURE = "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=";
const NOW = Number(TIMESTAMP) * 1000;

function headers(values: Record<string, string>, prefix = "svix") {
  return new Headers(
    Object.fromEntries(Object.entries(values).map(([k, v]) => [`${prefix}-${k}`, v])),
  );
}

const good = { id: ID, timestamp: TIMESTAMP, signature: SIGNATURE };

describe("checking Resend's webhook signature", () => {
  it("accepts Svix's test example", async () => {
    expect(await verifyWebhook(SECRET, headers(good), BODY, NOW)).toBe("ok");
  });

  it("accepts any one matching signature among several", async () => {
    const signature = `v1,bm90IHRoZSByaWdodCBvbmU= ${SIGNATURE}`;
    expect(await verifyWebhook(SECRET, headers({ ...good, signature }), BODY, NOW)).toBe("ok");
  });

  it("accepts the webhook- headers too", async () => {
    expect(await verifyWebhook(SECRET, headers(good, "webhook"), BODY, NOW)).toBe("ok");
  });

  it("refuses a changed body, a wrong signature or another secret", async () => {
    expect(await verifyWebhook(SECRET, headers(good), BODY.replace("true", "false"), NOW)).toBe(
      "bad_signature",
    );
    const wrong = { ...good, signature: "v1,sAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" };
    expect(await verifyWebhook(SECRET, headers(wrong), BODY, NOW)).toBe("bad_signature");
    expect(await verifyWebhook(SECRET, headers({ ...good, signature: "v2,abc" }), BODY, NOW)).toBe(
      "bad_signature",
    );
    expect(await verifyWebhook("whsec_b3RoZXJzZWNyZXQ=", headers(good), BODY, NOW)).toBe(
      "bad_signature",
    );
  });

  it("refuses a timestamp more than 5 minutes off either way", async () => {
    expect(await verifyWebhook(SECRET, headers(good), BODY, NOW + 4 * 60_000)).toBe("ok");
    expect(await verifyWebhook(SECRET, headers(good), BODY, NOW + 6 * 60_000)).toBe("stale");
    expect(await verifyWebhook(SECRET, headers(good), BODY, NOW - 6 * 60_000)).toBe("stale");
    expect(await verifyWebhook(SECRET, headers({ ...good, timestamp: "soon" }), BODY, NOW)).toBe(
      "stale",
    );
  });

  it("refuses a request without the headers", async () => {
    expect(await verifyWebhook(SECRET, new Headers(), BODY, NOW)).toBe("missing_headers");
    const noSignature = { id: good.id, timestamp: good.timestamp };
    expect(await verifyWebhook(SECRET, headers(noSignature), BODY, NOW)).toBe("missing_headers");
  });
});
