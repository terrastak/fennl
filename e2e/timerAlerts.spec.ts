import { expect, test, type Page } from "@playwright/test";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// U8: timer alerts with the phone locked. A test browser has no push service and refuses
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

/** Cook mode on the sample pancakes, at the step with timers. */
async function cookPancakes(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Buttermilk Pancakes")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  await page.getByRole("link", { name: "Start cooking" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { level: 1, name: "Step 5 of 5" })).toBeVisible();
}

test("Turn on timer alerts from cook mode, and off in Settings", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await standInPushService(page);
  await cookPancakes(page);

  await page.getByRole("button", { name: "Start a 2 minutes timer" }).click();
  const timers = page.getByRole("region", { name: "Timers" });
  const offer = timers.getByRole("button", {
    name: "Alert me when a timer finishes, even with the phone locked",
  });
  // Turning on asks the server for an alert for the timer already running.
  const asked = page.waitForRequest(
    (req) => req.method() === "PUT" && /\/api\/push\/timers\//.test(req.url()),
  );
  await offer.click();
  const request = await asked;
  expect(request.postDataJSON()).toMatchObject({
    label: "2 minutes",
    recipeTitle: "Buttermilk Pancakes",
    path: expect.stringMatching(/^\/recipes\/[0-9a-f-]{36}\/cook$/),
  });
  expect((await request.response())?.status()).toBe(200);
  await expect(offer).toBeHidden();

  // Stopping it takes the alert back.
  const cancelled = page.waitForRequest(
    (req) => req.method() === "DELETE" && /\/api\/push\/timers\//.test(req.url()),
  );
  await timers.getByRole("button", { name: "Stop" }).click();
  await cancelled;

  // A new timer asks for its alert straight away.
  const next = page.waitForRequest(
    (req) => req.method() === "PUT" && /\/api\/push\/timers\//.test(req.url()),
  );
  await page.getByRole("button", { name: "Start a 1 minute timer" }).click();
  expect((await (await next).response())?.status()).toBe(200);

  // Settings shows it's on for this browser, and turns it off.
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Timer alerts" });
  await expect(section).toContainText("On for this browser.");
  await section.getByRole("button", { name: "Turn off" }).click();
  await expect(section).toContainText("Off for this browser.");
  await section.getByRole("button", { name: "Turn on" }).click();
  await expect(section).toContainText("On for this browser.");
});

test("On an iPhone in a Safari tab, cook mode says how to get timer alerts", async ({
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
  await cookPancakes(page);
  await page.getByRole("button", { name: "Start a 2 minutes timer" }).click();
  const timers = page.getByRole("region", { name: "Timers" });
  await expect(timers).toContainText("add Fennl to your Home Screen");
  await expect(timers.getByRole("button", { name: /Alert me/ })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("region", { name: "Timer alerts" })).toContainText(
    "alerts need Fennl opened from the Home Screen",
  );
});
