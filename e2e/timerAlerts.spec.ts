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

  // A test notification. The test browser's push address is made up, so the push service's
  // answer is stood in for; the server's sending is covered by its own tests.
  await page.route("**/api/push/test", (route) => route.fulfill({ json: { ok: true } }));
  const tested = page.waitForRequest("**/api/push/test");
  await line.getByRole("button", { name: "Send test notification" }).click();
  expect((await tested).postDataJSON()).toHaveProperty("deviceId");
  const sent = line.getByRole("status");
  await expect(sent).toContainText("“Fennl test notification” should appear within a few seconds.");
  // What to check on this computer (the test browser says it's Chrome on Windows).
  await expect(sent).toContainText("Settings › System › Notifications");
  await expect(sent).toContainText("Do Not Disturb or a Focus isn’t on.");

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
