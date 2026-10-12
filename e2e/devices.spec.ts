import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PASSWORD, makeCode, useFreshAddress, useOwnAccount } from "./support";

// Phase B6: the one-device rule on Free, several devices on Premium. Each "device" is a separate
// browser context: its own storage (device ID) and its own sign-in.

async function signInElsewhere(browser: Browser, baseURL: string, email: string): Promise<Page> {
  // Nothing saved: not the shared test account's sign-in, and no device ID.
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  await useFreshAddress(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

test("Free: a second browser takes over, and the first is signed out", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();

  const other = await signInElsewhere(browser, baseURL!, email);
  await expect(
    other.getByRole("heading", { level: 1, name: "Use Fennl on this device?" }),
  ).toBeVisible();
  await expect(other.getByText("Your plan includes one device at a time")).toBeVisible();
  const results = await new AxeBuilder({ page: other })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await other.getByRole("button", { name: "Use Fennl on this device" }).click();
  await expect(other.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();

  // The first browser was signed out.
  await page.reload();
  await expect(page).toHaveURL(/\/sign-in$/);
  await other.context().close();
});

test("Free: choosing to sign out instead leaves the first browser alone", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();

  const other = await signInElsewhere(browser, baseURL!, email);
  await other.getByRole("button", { name: "Sign out here instead" }).click();
  await expect(other).toHaveURL(/\/sign-in$/);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  await other.context().close();
});

test("Premium: several browsers at once, signed out one by one or all at once from Account", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  const code = await makeCode(context.request, {
    tier: "individual",
    days: 30,
    allowsSignUp: false,
  });
  const used = await context.request.post("/api/codes/redeem", {
    headers: { origin: baseURL! },
    data: { code },
  });
  expect(used.ok()).toBe(true);

  const others: Page[] = [];
  for (let i = 0; i < 3; i++) {
    const other = await signInElsewhere(browser, baseURL!, email);
    await expect(other.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
    others.push(other);
  }

  await page.goto("/account");
  const card = page.getByRole("region", { name: "Where you’re signed in" });
  const devices = card.getByRole("list", { name: "Devices" });
  await expect(card.getByText("Your plan includes up to 5 devices at once.")).toBeVisible();
  await expect(devices.getByText("This device")).toBeVisible();
  await expect(devices.getByRole("listitem")).toHaveCount(4);
  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // One at a time.
  await devices
    .getByRole("button", { name: /^Sign out/ })
    .first()
    .click();
  await expect(card.getByRole("status")).toHaveText(/^Signed out /);
  await expect(devices.getByRole("listitem")).toHaveCount(3);

  // Then every other one.
  await card.getByRole("button", { name: "Sign out all other devices" }).click();
  await expect(card.getByRole("status")).toHaveText("Signed out all your other devices.");
  await expect(devices.getByRole("listitem")).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Sign out all other devices" })).toHaveCount(0);

  for (const other of others) {
    await other.reload();
    await expect(other).toHaveURL(/\/sign-in$/);
    await other.context().close();
  }
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
});
