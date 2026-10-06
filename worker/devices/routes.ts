import { Hono } from "hono";
import { deviceLabel, isDeviceId, type DeviceList } from "../../shared/devices";
import { householdEntitlements } from "../entitlements/entitlements";
import { requireHousehold, type SignedIn } from "../household/requireHousehold";
import { withinRateLimit } from "../rateLimit";
import {
  activeDevices,
  registerDevice,
  signOutDevice,
  takeOver,
  type DeviceCaller,
} from "./devices";

// The device registry's routes (phase B6). The app registers its browser on every start and
// shows the takeover screen when the household is over its device limit.

/** Takeovers are instant, so only a light limit, against abuse (CLAUDE.md, "Tables"). */
const TAKEOVERS = { max: 10, windowMs: 10 * 60 * 1000 };

export const deviceRoutes = new Hono<{ Bindings: Env; Variables: { signedIn: SignedIn } }>();

deviceRoutes.use("/api/devices", requireHousehold);
deviceRoutes.use("/api/devices/*", requireHousehold);

function caller(signedIn: SignedIn): DeviceCaller {
  return {
    userId: signedIn.userId,
    householdId: signedIn.household.householdId,
    sessionId: signedIn.sessionId,
  };
}

async function maxDevices(signedIn: SignedIn): Promise<number | null> {
  const plan = await householdEntitlements(signedIn.db, signedIn.household.householdId);
  return plan.max_devices;
}

async function deviceIdFrom(request: Request): Promise<unknown> {
  const body = (await request.json().catch(() => null)) as { deviceId?: unknown } | null;
  return body?.deviceId;
}

deviceRoutes.post("/api/devices/register", async (c) => {
  const signedIn = c.var.signedIn;
  const deviceId = await deviceIdFrom(c.req.raw);
  if (!isDeviceId(deviceId)) return c.json({ error: "invalid_device" }, 400);
  // An admin using someone's account never counts as one of their devices (CLAUDE.md).
  if (signedIn.impersonating) return c.json({ status: "ok" });
  const result = await registerDevice(
    signedIn.db,
    caller(signedIn),
    deviceId,
    deviceLabel(c.req.header("user-agent")),
    await maxDevices(signedIn),
  );
  return c.json(result);
});

deviceRoutes.post("/api/devices/takeover", async (c) => {
  const signedIn = c.var.signedIn;
  const body = (await c.req.json().catch(() => null)) as {
    deviceId?: unknown;
    signOut?: unknown;
  } | null;
  const deviceId = body?.deviceId;
  if (!isDeviceId(deviceId)) return c.json({ error: "invalid_device" }, 400);
  const chosen = body?.signOut;
  if (chosen !== undefined && (!Array.isArray(chosen) || !chosen.every(isDeviceId))) {
    return c.json({ error: "invalid_device" }, 400);
  }
  if (signedIn.impersonating) return c.json({ status: "ok" });
  if (!(await withinRateLimit(signedIn.db, `takeover:${signedIn.userId}`, TAKEOVERS))) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const result = await takeOver(
    signedIn.db,
    caller(signedIn),
    deviceId,
    deviceLabel(c.req.header("user-agent")),
    await maxDevices(signedIn),
    (chosen as string[] | undefined) ?? null,
  );
  return c.json(result);
});

/** The device list in Settings. ?current= is the asking browser's own ID. */
deviceRoutes.get("/api/devices", async (c) => {
  const signedIn = c.var.signedIn;
  const current = c.req.query("current") ?? "";
  const list: DeviceList = {
    max: await maxDevices(signedIn),
    devices: await activeDevices(signedIn.db, caller(signedIn), current),
  };
  return c.json(list);
});

deviceRoutes.post("/api/devices/:id/sign-out", async (c) => {
  const signedIn = c.var.signedIn;
  const target = c.req.param("id");
  const current = await deviceIdFrom(c.req.raw);
  if (!isDeviceId(target) || !isDeviceId(current)) {
    return c.json({ error: "invalid_device" }, 400);
  }
  const done = await signOutDevice(signedIn.db, caller(signedIn), target, current);
  return done ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
