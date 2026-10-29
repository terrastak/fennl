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

/** The Timers window, with a timer of one's own running. */
async function startTimer(page: Page, name: string) {
  await page.getByRole("button", { name: /^Timers/ }).click();
  const timers = page.getByRole("dialog", { name: "Timers" });
  await timers.getByLabel("Name (optional)").fill(name);
  await timers.getByRole("button", { name: "10 min timer" }).click();
  await expect(timers.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  return timers;
}

const timerRequest = (page: Page, method: "PUT" | "DELETE") =>
  page.waitForRequest((req) => req.method() === method && /\/api\/push\/timers\//.test(req.url()));

test("Turn on timer alerts from the Timers window, and off in Settings", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await standInPushService(page);
  await page.goto("/");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const timers = await startTimer(page, "Pasta");

  // Turning on asks the server for an alert for the timer already running.
  const offer = timers.getByRole("button", {
    name: "Notify me when a timer finishes, even when Fennl isn’t on screen",
  });
  const asked = timerRequest(page, "PUT");
  await offer.click();
  const request = await asked;
  expect(request.postDataJSON()).toMatchObject({ label: "Pasta", recipeTitle: "", path: "/" });
  expect((await request.response())?.status()).toBe(200);
  await expect(offer).toBeHidden();

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
  await pasta.getByRole("button", { name: "Stop Pasta" }).click();
  await stopped;

  // A new timer asks for its alert straight away.
  const next = timerRequest(page, "PUT");
  await timers.getByRole("button", { name: "5 min timer", exact: true }).click();
  expect((await (await next).response())?.status()).toBe(200);

  // On a computer, the window says the browser must keep running, and links to Settings.
  await expect(timers).toContainText(
    "Notifications arrive only while Chrome is running. More in Settings › Timer notifications.",
  );
  await timers.getByRole("link", { name: "Settings › Timer notifications" }).click();
  await expect(page).toHaveURL(/\/settings#timer-notifications$/);
  await expect(timers).toBeHidden();

  // Settings shows it's on for this browser, and turns it off.
  const section = page.getByRole("region", { name: "Timer notifications" });
  await expect(section).toContainText("On for this browser.");
  // What this browser needs: a computer's Chrome only while it runs.
  await expect(section).toContainText("Notifications arrive only while Chrome is running.");

  // A test notification. The test browser's push address is made up, so the push service's answer is
  // stood in for; the server's sending is covered by its own tests.
  await page.route("**/api/push/test", (route) => route.fulfill({ json: { ok: true } }));
  const tested = page.waitForRequest("**/api/push/test");
  await section.getByRole("button", { name: "Send a test notification" }).click();
  expect((await tested).postDataJSON()).toHaveProperty("deviceId");
  const sent = section.getByRole("status");
  await expect(sent).toContainText("“Fennl test notification” should appear within a few seconds.");
  // What to check on this computer (the test browser says it's Chrome on Windows).
  await expect(sent).toContainText("Settings › System › Notifications");
  await expect(sent).toContainText("Do Not Disturb or a Focus isn’t on.");

  await section.getByRole("button", { name: "Turn off" }).click();
  await expect(section).toContainText("Off for this browser.");
  await section.getByRole("button", { name: "Turn on" }).click();
  await expect(section).toContainText("On for this browser.");
});

test("On an iPhone in a Safari tab, the Timers window says how to get timer alerts", async ({
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
  const timers = await startTimer(page, "Rice");
  await expect(timers).toContainText("add Fennl to your Home Screen");
  await expect(timers.getByRole("button", { name: /Notify me/ })).toHaveCount(0);
  await timers.getByRole("button", { name: "Close" }).click();

  await page.goto("/settings");
  await expect(page.getByRole("region", { name: "Timer notifications" })).toContainText(
    "notifications need Fennl opened from the Home Screen",
  );
});
