import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { DeviceList, RegisterResult } from "../../shared/devices";
import { database } from "../db/client";
import { device, limitOverride, session } from "../db/schema";
import { PASSWORD, setUpDatabase, signUpConfirmed, visitor, type Visitor } from "../test/visitor";

const db = () => database(env.DB);
let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;
const newDeviceId = () => crypto.randomUUID();

beforeAll(async () => {
  await setUpDatabase();
});

/** The same person in another browser: a new visitor, signed in with the password. */
async function signIn(address: string): Promise<Visitor> {
  const v = visitor();
  const res = await v.request("/api/auth/sign-in/email", {
    body: { email: address, password: PASSWORD },
  });
  expect(res.status).toBe(200);
  return v;
}

async function register(v: Visitor, deviceId: string) {
  const res = await v.request("/api/devices/register", { body: { deviceId } });
  return { status: res.status, body: (await res.json()) as RegisterResult & { error?: string } };
}

async function takeOver(v: Visitor, deviceId: string, signOut?: string[]) {
  const res = await v.request("/api/devices/takeover", {
    body: { deviceId, ...(signOut ? { signOut } : {}) },
  });
  return { status: res.status, body: (await res.json()) as RegisterResult & { error?: string } };
}

async function signedIn(v: Visitor) {
  return (await v.session()) !== null;
}

async function householdOf(v: Visitor) {
  return (await v.session())!.session.activeOrganizationId!;
}

async function allowDevices(v: Visitor, max: number) {
  await db()
    .insert(limitOverride)
    .values({
      id: crypto.randomUUID(),
      householdId: await householdOf(v),
      key: "max_devices",
      value: max,
      createdAt: new Date(),
    });
}

async function deviceRow(v: Visitor, deviceId: string) {
  const userId = (await v.session())!.user.id;
  return db()
    .select()
    .from(device)
    .where(and(eq(device.userId, userId), eq(device.id, deviceId)))
    .get();
}

describe("registering a browser", () => {
  it("needs a signed-in person and a plausible device ID", async () => {
    expect((await register(visitor(), newDeviceId())).status).toBe(401);
    const v = await signUpConfirmed(email("bad"));
    expect(await register(v, "nope")).toEqual({ status: 400, body: { error: "invalid_device" } });
  });

  it("adds the first device, and just notes it after that", async () => {
    const v = await signUpConfirmed(email("first"));
    const id = newDeviceId();
    expect((await register(v, id)).body).toEqual({ status: "ok" });
    const first = await deviceRow(v, id);
    expect(first).toMatchObject({ label: "A browser", revokedAt: null });
    expect((await register(v, id)).body).toEqual({ status: "ok" });
    const again = await deviceRow(v, id);
    expect(again!.firstSeenAt).toEqual(first!.firstSeenAt);
    expect(again!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first!.lastSeenAt.getTime());
  });
});

describe("Free: one device at a time", () => {
  it("offers a takeover to a second browser, and taking over signs the first one out", async () => {
    const address = email("free");
    const laptop = await signUpConfirmed(address);
    const laptopId = newDeviceId();
    expect((await register(laptop, laptopId)).body).toEqual({ status: "ok" });

    const phone = await signIn(address);
    const phoneId = newDeviceId();
    const blocked = await register(phone, phoneId);
    expect(blocked.body).toMatchObject({ status: "over_limit", max: 1 });
    expect(blocked.body.status === "over_limit" && blocked.body.devices).toEqual([
      expect.objectContaining({ id: laptopId, label: "A browser", current: false }),
    ]);
    // Nothing changes until the person chooses.
    expect(await signedIn(laptop)).toBe(true);

    expect((await takeOver(phone, phoneId)).body).toEqual({ status: "ok" });
    expect(await signedIn(laptop)).toBe(false);
    expect(await signedIn(phone)).toBe(true);
    expect(await deviceRow(phone, laptopId)).toMatchObject({
      revokedReason: "taken_over",
    });

    // The laptop signs in again: now it's the one offered a takeover. No cooldown.
    const laptopAgain = await signIn(address);
    expect((await register(laptopAgain, laptopId)).body).toMatchObject({ status: "over_limit" });
    expect((await takeOver(laptopAgain, laptopId)).body).toEqual({ status: "ok" });
    expect(await signedIn(phone)).toBe(false);
  });

  it("recognises the same browser after its storage was cleared (eviction)", async () => {
    const v = await signUpConfirmed(email("evicted"));
    const oldId = newDeviceId();
    await register(v, oldId);
    // Same sign-in cookie, new device ID: no takeover screen, and still signed in.
    const newId = newDeviceId();
    expect((await register(v, newId)).body).toEqual({ status: "ok" });
    expect(await signedIn(v)).toBe(true);
    expect(await deviceRow(v, oldId)).toMatchObject({ revokedReason: "replaced" });
  });

  it("lets a browser that lost its sign-in but kept its ID back in", async () => {
    const address = email("cookie");
    const v = await signUpConfirmed(address);
    const id = newDeviceId();
    await register(v, id);
    await v.request("/api/auth/sign-out", { body: {} });
    const back = await signIn(address);
    expect((await register(back, id)).body).toEqual({ status: "ok" });
  });

  it("can't let two new browsers in at once", async () => {
    const address = email("race");
    const a = await signUpConfirmed(address);
    const b = await signIn(address);
    const results = await Promise.all([register(a, newDeviceId()), register(b, newDeviceId())]);
    expect(results.map((r) => r.body.status).sort()).toEqual(["ok", "over_limit"]);
  });

  it("limits takeovers lightly", async () => {
    const v = await signUpConfirmed(email("many"));
    const id = newDeviceId();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await takeOver(v, id)).status;
    expect(last).toBe(429);
  });
});

describe("Premium: several devices", () => {
  it("allows up to the plan's limit, then lets the person choose one to sign out", async () => {
    const address = email("premium");
    const one = await signUpConfirmed(address);
    await allowDevices(one, 2);
    const [oneId, twoId, threeId] = [newDeviceId(), newDeviceId(), newDeviceId()];
    expect((await register(one, oneId)).body).toEqual({ status: "ok" });
    const two = await signIn(address);
    expect((await register(two, twoId)).body).toEqual({ status: "ok" });

    const three = await signIn(address);
    const blocked = await register(three, threeId);
    expect(blocked.body).toMatchObject({ status: "over_limit", max: 2 });
    expect(blocked.body.status === "over_limit" && blocked.body.devices).toHaveLength(2);

    expect((await takeOver(three, threeId, [oneId])).body).toEqual({ status: "ok" });
    expect(await signedIn(one)).toBe(false);
    expect(await signedIn(two)).toBe(true);
  });

  it("lists devices in Settings and signs one out from there", async () => {
    const address = email("list");
    const here = await signUpConfirmed(address);
    await allowDevices(here, 5);
    const hereId = newDeviceId();
    const thereId = newDeviceId();
    await register(here, hereId);
    const there = await signIn(address);
    await register(there, thereId);

    const res = await here.request(`/api/devices?current=${hereId}`);
    const list = (await res.json()) as DeviceList;
    expect(list.max).toBe(5);
    expect(list.devices.map((d) => [d.id, d.current]).sort()).toEqual(
      [
        [hereId, true],
        [thereId, false],
      ].sort(),
    );

    // Not the device asking (that's ordinary sign-out), and not someone else's.
    expect(
      (await here.request(`/api/devices/${hereId}/sign-out`, { body: { deviceId: hereId } }))
        .status,
    ).toBe(404);
    const stranger = await signUpConfirmed(email("stranger"));
    expect(
      (
        await stranger.request(`/api/devices/${thereId}/sign-out`, {
          body: { deviceId: newDeviceId() },
        })
      ).status,
    ).toBe(404);
    expect(await signedIn(there)).toBe(true);

    const out = await here.request(`/api/devices/${thereId}/sign-out`, {
      body: { deviceId: hereId },
    });
    expect(out.status).toBe(200);
    expect(await signedIn(there)).toBe(false);
    expect(await deviceRow(here, thereId)).toMatchObject({ revokedReason: "signed_out" });
  });
});

describe("admins using someone's account", () => {
  it("never register as one of their devices", async () => {
    const v = await signUpConfirmed(email("impersonated"));
    const sessionId = (await v.session())!.session.id;
    await db()
      .update(session)
      .set({ impersonatedBy: "some-admin" })
      .where(eq(session.id, sessionId));
    const id = newDeviceId();
    expect((await register(v, id)).body).toEqual({ status: "ok" });
    expect(await deviceRow(v, id)).toBeUndefined();
  });
});
