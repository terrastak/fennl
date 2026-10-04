import { execFileSync } from "node:child_process";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PASSWORD, signUpConfirmed, useFreshAddress } from "./support";

// The admin console, locally at /admin (ACCESS_DEV_BYPASS stands in for Cloudflare Access).
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ context, isMobile }) => {
  test.skip(isMobile, "The admin console is checked on a computer");
  await useFreshAddress(context);
});

/** The admin role is granted only by a database command, exactly as the runbook does it. */
function grantAdmin(email: string) {
  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "wrangler.jsonc",
      "--command",
      `UPDATE user SET role = 'admin' WHERE email = '${email}'`,
    ],
    { stdio: "ignore" },
  );
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
  const activity = page.getByRole("table");
  await expect(activity.getByText("Added a passkey").first()).toBeVisible();
  await expect(activity.getByRole("cell", { name: "passkey", exact: true }).first()).toBeVisible();

  // Signing out and back in with a password isn't enough any more.
  await page.getByRole("button", { name: "Sign out" }).click();
  await signInWithPassword(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "Use your passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();
});

test("an ordinary account can't use the admin area", async ({ page, context, baseURL }) => {
  const email = await signUpConfirmed(context, baseURL!);
  await context.clearCookies();
  await signInWithPassword(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "Not an admin account" })).toBeVisible();
});
