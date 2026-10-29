import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_PUSH, type TimerPush } from "../../shared/timerAlerts";
import { database } from "../db/client";
import { pushSubscription, timerAlert, user } from "../db/schema";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";
import {
  deliverTimerAlert,
  removeOldTimerAlerts,
  scheduleTimerAlert,
  type TimerAlertMessage,
} from "./timerAlerts";
import { ecdhWith, fromBase64Url, toBase64Url } from "./webPush";

// U10: timers that alert the browser that started them, with the phone locked.

const db = () => database(env.DB);
let counter = 0;

beforeAll(async () => {
  await setUpDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A browser's push keys, as the browser would make them. */
async function browserKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, p256dh: toBase64Url(raw), auth: toBase64Url(auth), authBytes: auth };
}

/** What the browser reads from a push (RFC 8291, the receiving side). */
async function decrypt(
  body: Uint8Array<ArrayBuffer>,
  keys: Awaited<ReturnType<typeof browserKeys>>,
): Promise<unknown> {
  const salt = body.slice(0, 16);
  const senderRaw = body.slice(21, 21 + body[20]!);
  const ciphertext = body.slice(21 + body[20]!);
  const sender = await crypto.subtle.importKey(
    "raw",
    senderRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhWith(sender), keys.pair.privateKey, 256),
  );
  const hmac = async (key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
          "sign",
        ]),
        data,
      ),
    );
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const text = (s: string) => new TextEncoder().encode(s);
  const one = new Uint8Array([1]);
  const ikm = await hmac(
    await hmac(keys.authBytes, shared),
    join(text("WebPush: info\0"), fromBase64Url(keys.p256dh), senderRaw, one),
  );
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, join(text("Content-Encoding: aes128gcm\0"), one))).slice(0, 16);
  const nonce = (await hmac(prk, join(text("Content-Encoding: nonce\0"), one))).slice(0, 12);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]),
      ciphertext,
    ),
  );
  expect(plain.at(-1)).toBe(2);
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

interface Person {
  v: Visitor;
  userId: string;
  deviceId: string;
}

async function person(): Promise<Person> {
  const v = await signUpConfirmed(`timer-alerts-${++counter}@example.com`);
  const deviceId = crypto.randomUUID();
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  expect(await res.json()).toEqual({ status: "ok" });
  const session = await v.session();
  return { v, userId: session!.user.id, deviceId };
}

async function call(v: Visitor, method: string, path: string, body?: unknown) {
  const res = await v.request(path, { method, ...(body === undefined ? {} : { body }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Each browser's own address at its push service. */
const endpoint = (p: Person) => `https://web.push.apple.com/${p.deviceId}`;

async function subscribe(p: Person, keys?: Awaited<ReturnType<typeof browserKeys>>) {
  const k = keys ?? (await browserKeys());
  return call(p.v, "PUT", "/api/push/subscription", {
    deviceId: p.deviceId,
    endpoint: endpoint(p),
    keys: { p256dh: k.p256dh, auth: k.auth },
  });
}

/** Queue messages sent, without a real queue. */
function queued() {
  return vi.spyOn(env.TIMER_ALERTS, "send").mockResolvedValue(undefined as never);
}

function startTimer(p: Person, id: string, endsAt: number, label = "Bake 25 minutes") {
  return call(p.v, "PUT", `/api/push/timers/${id}`, {
    deviceId: p.deviceId,
    endsAt,
    label,
    recipeTitle: "Banana bread",
    path: "/recipes/abc/cook",
  });
}

describe("subscribing a browser", () => {
  it("gives the key browsers subscribe with", async () => {
    const p = await person();
    const { body } = await call(p.v, "GET", "/api/push/key");
    expect(body.key).toMatch(/^B[A-Za-z0-9_-]{86}$/);
  });

  it("keeps one subscription per browser, and turning off removes it", async () => {
    const p = await person();
    expect((await subscribe(p)).status).toBe(200);
    expect((await subscribe(p)).status).toBe(200);
    const rows = await db()
      .select()
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, p.userId))
      .all();
    expect(rows).toHaveLength(1);
    const shown = await call(p.v, "GET", `/api/push/subscription?deviceId=${p.deviceId}`);
    expect(shown.body.endpoint).toBe(endpoint(p));

    await call(p.v, "DELETE", `/api/push/subscription?deviceId=${p.deviceId}`);
    const after = await call(p.v, "GET", `/api/push/subscription?deviceId=${p.deviceId}`);
    expect(after.body.endpoint).toBeNull();
  });

  it("only sends to the browsers' own push services", async () => {
    const p = await person();
    const keys = await browserKeys();
    for (const address of [
      "https://evil.example/push",
      "http://web.push.apple.com/x",
      "https://web.push.apple.com.evil.example/x",
      "https://user:pw@fcm.googleapis.com/fcm/send/x",
    ]) {
      const res = await call(p.v, "PUT", "/api/push/subscription", {
        deviceId: p.deviceId,
        endpoint: address,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      });
      expect(res.status, address).toBe(400);
    }
    for (const address of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      const res = await call(p.v, "PUT", "/api/push/subscription", {
        deviceId: p.deviceId,
        endpoint: address,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      });
      expect(res.status, address).toBe(200);
    }
  });

  it("needs one of the person's own browsers, still signed in", async () => {
    const p = await person();
    const keys = await browserKeys();
    const res = await call(p.v, "PUT", "/api/push/subscription", {
      deviceId: crypto.randomUUID(),
      endpoint: endpoint(p),
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
    expect(res).toMatchObject({ status: 403, body: { error: "device_not_registered" } });
  });

  it("moves a browser to the person signed in on it now", async () => {
    const first = await person();
    const second = await person();
    const keys = await browserKeys();
    const body = (p: Person) => ({
      deviceId: p.deviceId,
      endpoint: "https://fcm.googleapis.com/fcm/send/shared-browser",
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
    await call(first.v, "PUT", "/api/push/subscription", body(first));
    await call(second.v, "PUT", "/api/push/subscription", body(second));
    const rows = await db()
      .select()
      .from(pushSubscription)
      .where(eq(pushSubscription.endpoint, "https://fcm.googleapis.com/fcm/send/shared-browser"))
      .all();
    expect(rows.map((r) => r.userId)).toEqual([second.userId]);
  });
});

describe("timers", () => {
  it("are only kept for a browser that gets alerts", async () => {
    const p = await person();
    const send = queued();
    const res = await startTimer(p, crypto.randomUUID(), Date.now() + 60_000);
    expect(res).toMatchObject({ status: 409, body: { error: "not_subscribed" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("wait on the queue until the timer ends", async () => {
    const p = await person();
    await subscribe(p);
    const send = queued();
    const id = crypto.randomUUID();
    const endsAt = Date.now() + 25 * 60_000;
    expect((await startTimer(p, id, endsAt)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const [message, options] = send.mock.calls[0]!;
    expect(message).toEqual({ userId: p.userId, timerId: id, endsAt, origin: "http://localhost" });
    expect(options!.delaySeconds).toBeGreaterThanOrEqual(25 * 60 - 2);
    expect(options!.delaySeconds).toBeLessThanOrEqual(25 * 60);
  });

  it("refuse what isn't a timer", async () => {
    const p = await person();
    await subscribe(p);
    queued();
    const id = crypto.randomUUID();
    expect((await startTimer(p, id, Date.now() + 8 * 24 * 60 * 60_000)).status).toBe(400);
    expect((await startTimer(p, id, Date.now() - 5 * 60_000)).status).toBe(400);
    expect((await startTimer(p, id, Date.now() + 60_000, "  ")).status).toBe(400);
    const elsewhere = await call(p.v, "PUT", `/api/push/timers/${id}`, {
      deviceId: p.deviceId,
      endsAt: Date.now() + 60_000,
      label: "Bake",
      recipeTitle: "",
      path: "//evil.example/",
    });
    expect(elsewhere.status).toBe(400);
  });

  it("are someone's own: another person's timer of the same id is apart", async () => {
    const a = await person();
    const b = await person();
    await subscribe(a);
    await subscribe(b);
    queued();
    const id = crypto.randomUUID();
    await startTimer(a, id, Date.now() + 60_000, "Ours");
    await startTimer(b, id, Date.now() + 60_000, "Theirs");
    await call(b.v, "DELETE", `/api/push/timers/${id}`);
    const mine = await db()
      .select()
      .from(timerAlert)
      .where(and(eq(timerAlert.userId, a.userId), eq(timerAlert.id, id)))
      .get();
    expect(mine).toMatchObject({ label: "Ours", cancelledAt: null });
  });
});

describe("sending the alert", () => {
  async function ready(endsInMs = 0) {
    const p = await person();
    const keys = await browserKeys();
    await subscribe(p, keys);
    queued();
    const id = crypto.randomUUID();
    const endsAt = Date.now() + endsInMs;
    await startTimer(p, id, endsAt);
    const message: TimerAlertMessage = {
      userId: p.userId,
      timerId: id,
      endsAt,
      origin: "https://fennl.example",
    };
    return { p, keys, id, endsAt, message };
  }

  function pushService(status = 201) {
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status }));
  }

  it("sends the browser that started it what the timer was for, readable only by it", async () => {
    const { p, keys, id, message } = await ready();
    const fetched = pushService();
    expect(await deliverTimerAlert(env, message)).toBe("sent");
    expect(fetched).toHaveBeenCalledTimes(1);
    const [url, init] = fetched.mock.calls[0]!;
    expect(url).toBe(endpoint(p));
    const headers = init!.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.ttl).toBe("600");
    expect(headers.urgency).toBe("high");
    expect(headers.authorization).toMatch(/^vapid t=.+, k=B/);
    const push = (await decrypt(init!.body as Uint8Array<ArrayBuffer>, keys)) as TimerPush;
    expect(push).toEqual({
      title: "Timer finished: Bake 25 minutes",
      body: "Banana bread",
      tag: id,
      path: "/recipes/abc/cook",
    });

    // Only once, even if the queue hands over the message again.
    expect(await deliverTimerAlert(env, message)).toBe("nothing_to_send");
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a timer stopped, or moved on by +1 min", async () => {
    const stopped = await ready();
    await call(stopped.p.v, "DELETE", `/api/push/timers/${stopped.id}`);
    const fetched = pushService();
    expect(await deliverTimerAlert(env, stopped.message)).toBe("nothing_to_send");

    const moved = await ready();
    queued();
    await startTimer(moved.p, moved.id, moved.endsAt + 60_000);
    expect(await deliverTimerAlert(env, moved.message)).toBe("nothing_to_send");
    expect(fetched).not.toHaveBeenCalled();
    // The later message, for the new end, does send.
    expect(
      await deliverTimerAlert(
        env,
        { ...moved.message, endsAt: moved.endsAt + 60_000 },
        moved.endsAt + 60_000,
      ),
    ).toBe("sent");
  });

  it("waits again when the timer is longer than a queue message can wait", async () => {
    const { message, endsAt } = await ready(30 * 60 * 60_000);
    const send = queued();
    const fetched = pushService();
    expect(await deliverTimerAlert(env, message, endsAt - 6 * 60 * 60_000)).toBe("not_due");
    expect(fetched).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(message, { delaySeconds: 6 * 60 * 60 });
  });

  it("forgets a browser whose subscription has ended", async () => {
    const { p, message } = await ready();
    pushService(410);
    expect(await deliverTimerAlert(env, message)).toBe("no_browser");
    const rows = await db()
      .select()
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, p.userId))
      .all();
    expect(rows).toEqual([]);
  });

  it("tries again when the push service is busy", async () => {
    const { message } = await ready();
    pushService(503);
    expect(await deliverTimerAlert(env, message)).toBe("failed");
    pushService(201);
    expect(await deliverTimerAlert(env, message)).toBe("sent");
  });

  it("removes alerts a day after they ended, and with the account", async () => {
    const { p, id } = await ready(-60_000);
    expect(await removeOldTimerAlerts(db(), Date.now() + 23 * 60 * 60_000)).toBe(0);
    expect(await removeOldTimerAlerts(db(), Date.now() + 25 * 60 * 60_000)).toBeGreaterThan(0);
    const left = await db()
      .select()
      .from(timerAlert)
      .where(and(eq(timerAlert.userId, p.userId), eq(timerAlert.id, id)))
      .get();
    expect(left).toBeUndefined();

    const other = await ready();
    await db().delete(user).where(eq(user.id, other.p.userId));
    const gone = await db()
      .select()
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, other.p.userId))
      .all();
    expect(gone).toEqual([]);
  });
});

describe("a test alert from Settings", () => {
  it("is sent to this browser at once, and says it's a test", async () => {
    const p = await person();
    const keys = await browserKeys();
    await subscribe(p, keys);
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 201 }));
    expect(await call(p.v, "POST", "/api/push/test", { deviceId: p.deviceId })).toEqual({
      status: 200,
      body: { ok: true },
    });
    const [url, init] = fetched.mock.calls[0]!;
    expect(url).toBe(endpoint(p));
    expect((init!.headers as Record<string, string>).ttl).toBe("60");
    expect(await decrypt(init!.body as Uint8Array<ArrayBuffer>, keys)).toEqual(TEST_PUSH);
  });

  it("needs this browser turned on, and forgets one whose subscription has ended", async () => {
    const p = await person();
    expect(await call(p.v, "POST", "/api/push/test", { deviceId: p.deviceId })).toMatchObject({
      status: 409,
      body: { error: "not_subscribed" },
    });
    await subscribe(p);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(null, { status: 410 }),
    );
    expect(await call(p.v, "POST", "/api/push/test", { deviceId: p.deviceId })).toMatchObject({
      status: 409,
    });
    const rows = await db()
      .select()
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, p.userId))
      .all();
    expect(rows).toEqual([]);
  });

  it("says when the push service can't take it, and is limited to a few a minute", async () => {
    const p = await person();
    await subscribe(p);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(null, { status: 503 }),
    );
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await call(p.v, "POST", "/api/push/test", { deviceId: p.deviceId })).status);
    }
    expect(statuses).toEqual([503, 503, 503, 503, 503, 429]);
  });
});

describe("scheduling", () => {
  it("waits no longer than a queue message can", async () => {
    const send = queued();
    const now = Date.now();
    const message = { userId: "u", timerId: "t", endsAt: now + 3 * 24 * 60 * 60_000, origin: "" };
    await scheduleTimerAlert(env, message, now);
    expect(send).toHaveBeenCalledWith(message, { delaySeconds: 24 * 60 * 60 });
  });
});
