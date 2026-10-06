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

test("Premium: several browsers at once, and one can be signed out from Settings", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  const code = makeCode({ tier: "individual", days: 30, allowsSignUp: false });
  const used = await context.request.post("/api/codes/redeem", {
    headers: { origin: baseURL! },
    data: { code },
  });
  expect(used.ok()).toBe(true);

  const other = await signInElsewhere(browser, baseURL!, email);
  await expect(other.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();

  await page.goto("/settings");
  const devices = page.getByRole("region", { name: "Devices" });
  await expect(devices.getByText("Your plan includes up to 5 devices at once.")).toBeVisible();
  await expect(devices.getByText("This device")).toBeVisible();
  await expect(devices.getByRole("listitem")).toHaveCount(2);

  await devices.getByRole("button", { name: /^Sign out/ }).click();
  await expect(devices.getByRole("status")).toHaveText(/^Signed out /);
  await expect(devices.getByRole("listitem")).toHaveCount(1);

  await other.reload();
  await expect(other).toHaveURL(/\/sign-in$/);
  await other.context().close();
});
