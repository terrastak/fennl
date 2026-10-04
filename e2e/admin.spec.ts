import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PASSWORD, runLocalSql, signUpConfirmed, useFreshAddress } from "./support";

// The admin console, locally at /admin (ACCESS_DEV_BYPASS stands in for Cloudflare Access).
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ context, isMobile }) => {
  test.skip(isMobile, "The admin console is checked on a computer");
  await useFreshAddress(context);
});

/** The admin role is granted only by a database command, exactly as the runbook does it. */
function grantAdmin(email: string) {
  runLocalSql(`UPDATE user SET role = 'admin' WHERE email = '${email}'`);
}

/** A software passkey device, so the test can create and use passkeys without a person. */
async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function signInWithPassword(page: Page, email: string) {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in with password" }).click();
}

test("an admin sets up a passkey, then signs in with it", async ({ page, context, baseURL }) => {
  const email = await signUpConfirmed(context, baseURL!, "Owner");
  grantAdmin(email);
  await context.clearCookies();
  await addVirtualAuthenticator(context, page);

  await signInWithPassword(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "Set up your passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Add a passkey" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();
  await expect(page.getByText("Signed in as Owner")).toBeVisible();
  // The log lists every admin's actions, newest first (earlier test runs may have added some).
  const activity = page.getByRole("region", { name: "Recent admin activity" });
  await expect(activity.getByText("Added a passkey").first()).toBeVisible();
  await expect(activity.getByRole("cell", { name: "passkey", exact: true }).first()).toBeVisible();

  // Signing out and back in with a password isn't enough any more.
  await page.getByRole("button", { name: "Sign out" }).click();
  await signInWithPassword(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "Use your passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();

  // Make an invite code, then find it in the list and see who used it.
  const codes = page.getByRole("region", { name: "Invite and promo codes" });
  await codes.getByRole("button", { name: "New code" }).click();
  await expectAccessible(page);
  await codes.getByLabel("Name").fill("Beta testers");
  await codes.getByLabel("Premium lasts until").fill("2030-06-30");
  await codes.getByLabel("How many people can use it (optional)").fill("5");
  await codes.getByRole("button", { name: "Create code" }).click();
  const created = codes.getByRole("status");
  await expect(created).toHaveText(/^Created [2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}\.$/);
  const code = (await created.textContent())!.replace(/^Created |\.$/g, "");
  const row = codes.getByRole("row").filter({ hasText: code });
  await expect(row).toContainText("Household, until");
  await expect(row).toContainText("0 of 5");
  await row.getByRole("button", { name: code }).click();
  await expect(codes.getByRole("heading", { name: code })).toBeVisible();
  await expect(codes.getByText("Nobody yet.")).toBeVisible();
  await expectAccessible(page);
  await codes.getByRole("button", { name: "Back to codes" }).click();
  await expectAccessible(page);

  // The invite-only switch.
  const signUp = page.getByRole("region", { name: "Sign-up" });
  await expect(signUp.getByRole("status")).toHaveText(/^Open|^Invite-only/);
});

test("an ordinary account can't use the admin area", async ({ page, context, baseURL }) => {
  const email = await signUpConfirmed(context, baseURL!);
  await context.clearCookies();
  await signInWithPassword(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "Not an admin account" })).toBeVisible();
});

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}
