import { expect, test, type Page } from "@playwright/test";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// U10: timer alerts with the phone locked. A test browser has no push service and refuses
// notifications, so both are stood in for (a subscription shaped like a real browser's); the
// server keeps it and is asked for an alert for each timer. That the alert then arrives on a
// locked phone is the owner's to check.

const p256dh = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({
  format: "jwk",
}) as {
  x: string;
  y: string;
};
const browserKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(p256dh.x, "base64url"),
  Buffer.from(p256dh.y, "base64url"),
]).toString("base64url");
const auth = randomBytes(16).toString("base64url");

/** A browser whose push service hands out a subscription, as Chrome's would. */
async function standInPushService(page: Page) {
  await page.addInitScript(
    ({ key, secret }) => {
      // Kept for the tab, as a browser keeps its subscription across pages.
      const KEPT = "test:push-subscription";
      const make = (endpoint: string, serverKey: number[]) =>
        ({
          endpoint,
          options: {
            applicationServerKey: new Uint8Array(serverKey).buffer,
            userVisibleOnly: true,
          },
          toJSON: () => ({ endpoint, keys: { p256dh: key, auth: secret } }),
          unsubscribe: async () => {
            sessionStorage.removeItem(KEPT);
            return true;
          },
        }) as unknown as PushSubscription;
      PushManager.prototype.subscribe = async function (options) {
        const kept = {
          endpoint: `https://fcm.googleapis.com/fcm/send/test-${crypto.randomUUID()}`,
          serverKey: [...new Uint8Array(options?.applicationServerKey as ArrayBuffer)],
        };
        sessionStorage.setItem(KEPT, JSON.stringify(kept));
        return make(kept.endpoint, kept.serverKey);
      };
      PushManager.prototype.getSubscription = async () => {
        const text = sessionStorage.getItem(KEPT);
        if (!text) return null;
        const kept = JSON.parse(text) as { endpoint: string; serverKey: number[] };
        return make(kept.endpoint, kept.serverKey);
      };
      // The test browser refuses notifications whatever it's told, so it's told to allow them.
      Object.defineProperty(Notification, "permission", { get: () => "granted" });
      Notification.requestPermission = async () => "granted";
    },
    { key: browserKey, secret: auth },
  );
}

/** The Timers panel, with a timer of one's own running. */
async function startTimer(page: Page, name: string, minutes = "10 min") {
  const timers = page.getByRole("dialog", { name: "Timers" });
  if (!(await timers.isVisible())) await page.getByRole("button", { name: /^Timers/ }).click();
  await timers.getByRole("button", { name: "Add timer" }).click();
  const add = page.getByRole("dialog", { name: "Add timer" });
  await add.getByLabel("Timer name").fill(name);
  await add.getByRole("button", { name: minutes, exact: true }).click();
  await add.getByRole("button", { name: "Start timer" }).click();
  await expect(timers.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  return timers;
}

const timerRequest = (page: Page, method: "PUT" | "DELETE") =>
  page.waitForRequest((req) => req.method() === method && /\/api\/push\/timers\//.test(req.url()));

test("Timer notifications are turned on and off at the foot of the Timers panel", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await standInPushService(page);
  await page.goto("/");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const timers = await startTimer(page, "Pasta");

  // One line says whether timers use this device's notifications (owner's choice 2026-10-29).
  const line = timers.getByRole("region", { name: "Timer notifications" });
  await expect(line).toContainText("Timers won’t use this device’s notifications.");
  // Turning on asks the server for an alert for the timer already running.
  const asked = timerRequest(page, "PUT");
  await line.getByRole("button", { name: "Turn on" }).click();
  const request = await asked;
  expect(request.postDataJSON()).toMatchObject({ label: "Pasta", recipeTitle: "", path: "/" });
  expect((await request.response())?.status()).toBe(200);
  await expect(line).toContainText("Timers will use this device’s notifications.");

  // Paused, it won't alert; resumed, it will again.
  const pasta = timers.getByRole("listitem").filter({ hasText: "Pasta" });
  const cancelled = timerRequest(page, "DELETE");
  await pasta.getByRole("button", { name: "Pause Pasta" }).click();
  await cancelled;
  const again = timerRequest(page, "PUT");
  await pasta.getByRole("button", { name: "Resume Pasta" }).click();
  expect((await (await again).response())?.status()).toBe(200);

  // Stopping it takes the alert back.
  const stopped = timerRequest(page, "DELETE");
  await pasta.getByRole("button", { name: "Cancel Pasta" }).click();
  await stopped;

  // A new timer asks for its alert straight away.
  const next = timerRequest(page, "PUT");
  await startTimer(page, "Rice", "5 min");
  expect((await (await next).response())?.status()).toBe(200);

  // How they work: what this browser needs (a computer's Chrome only while it runs).
  await line.getByText("How they work").click();
  await expect(line).toContainText("Notifications arrive only while Chrome is running.");

  // A test notification checks itself (owner's choice 2026-10-29). The test browser's push address
  // is made up, so the push service's answer, and the service worker noting its arrival, are
  // stood in for; the server's sending is covered by its own tests.
  await page.route("**/api/push/test", async (route) => {
    await page.evaluate(() =>
      caches
        .open("fennl-timer-arrivals")
        .then((c) => c.put("/__arrived/fennl-test", new Response("1"))),
    );
    await route.fulfill({ json: { ok: true } });
  });
  const tested = page.waitForRequest("**/api/push/test");
  await line.getByRole("button", { name: "Send test notification" }).click();
  expect((await tested).postDataJSON()).toHaveProperty("deviceId");
  const checks = line.getByRole("status");
  await expect(checks).toContainText("It arrived on this device: done");
  await expect(checks).toContainText("Fennl’s server sent it: done");
  // Where to find it, and what a web page can't see (the test browser is Chrome on Windows).
  await expect(checks).toContainText("It’s in the notification panel");
  await expect(checks).toContainText("Settings › System › Notifications");
  await expect(line.getByRole("button", { name: "Send another" })).toBeVisible();

  await line.getByRole("button", { name: "Turn off" }).click();
  await expect(line).toContainText("Timers won’t use this device’s notifications.");
  await line.getByRole("button", { name: "Turn on" }).click();
  await expect(line).toContainText("Timers will use this device’s notifications.");

  // Settings no longer has a section for them.
  await timers.getByRole("button", { name: "Close timers" }).click();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Timer notifications" })).toHaveCount(0);
});

test("On an iPhone in a Safari tab, the Timers panel says how to get timer notifications", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  // What Safari on an iPhone shows a page in a tab: no push, and not opened from the Home Screen.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: false });
    delete (window as { PushManager?: unknown }).PushManager;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Timers/ }).click();
  const line = page
    .getByRole("dialog", { name: "Timers" })
    .getByRole("region", { name: "Timer notifications" });
  await expect(line).toContainText("timer notifications need Fennl opened from the Home Screen");
  await expect(line.getByRole("button", { name: "Turn on" })).toHaveCount(0);
  await line.getByText("How", { exact: true }).click();
  await expect(line).toContainText("Add to Home Screen");
});

test("A timer whose notification can't be set up says so, with the way to fix it", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await standInPushService(page);
  await page.goto("/");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const timers = await startTimer(page, "Pasta");
  const line = timers.getByRole("region", { name: "Timer notifications" });
  await line.getByRole("button", { name: "Turn on" }).click();
  await expect(line).toContainText("Timers will use this device’s notifications.");

  // The browser lost its subscription (as when a browser's data is cleared): the next timer's
  // quiet check finds it, and says so under that timer.
  await page.evaluate(() => sessionStorage.removeItem("test:push-subscription"));
  await startTimer(page, "Rice", "5 min");
  const rice = timers.getByRole("listitem").filter({ hasText: "Rice" });
  await expect(rice).toContainText(
    "This timer won’t notify: this browser stopped receiving Fennl’s notifications.",
  );
  const asked = page.waitForRequest(
    (req) => req.method() === "PUT" && /\/api\/push\/timers\//.test(req.url()),
  );
  await rice.getByRole("button", { name: "Turn on again" }).click();
  await asked;
  await expect(rice).not.toContainText("won’t notify");
  await expect(line).toContainText("Timers will use this device’s notifications.");
});

test("A timer's notification that never arrived is said once, in the Timers panel", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  // A timer that ended 20 minutes ago, whose notification this device never noted.
  await page.evaluate(() =>
    localStorage.setItem(
      "fennl:timer-pending",
      JSON.stringify([{ id: "t-1", label: "Bake", endsAt: Date.now() - 20 * 60_000 }]),
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: /^Timers/ }).click();
  const timers = page.getByRole("dialog", { name: "Timers" });
  const notice = timers.getByRole("alert");
  await expect(notice).toContainText("The notification for Bake didn’t arrive on this device.");
  await notice.getByText("What to check").click();
  await expect(notice).toContainText("awake (not asleep) when the timer ended");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(timers.getByRole("alert")).toHaveCount(0);
});
