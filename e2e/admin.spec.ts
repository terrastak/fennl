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
  const sections = page.getByRole("navigation", { name: "Admin sections" });
  await sections.getByRole("button", { name: "Your admin account" }).click();
  await expect(page.getByText("Signed in as Owner")).toBeVisible();
  // The log lists every admin's actions, newest first (earlier test runs may have added some).
  await sections.getByRole("button", { name: "Activity" }).click();
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
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("button", { name: "Codes and sign-up" })
    .click();
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

  // A code with no end date (free Premium for good, for example for family).
  await codes.getByRole("button", { name: "New code" }).click();
  await codes.getByLabel("Name").fill("Family");
  await codes.getByLabel("No end date").check();
  await codes.getByRole("button", { name: "Create code" }).click();
  await expect(codes.getByRole("status")).toHaveText(/^Created /);
  const family = (await codes.getByRole("status").textContent())!.replace(/^Created |\.$/g, "");
  await expect(codes.getByRole("row").filter({ hasText: family })).toContainText(
    "Household, no end date",
  );

  // The invite-only switch.
  const signUp = page.getByRole("region", { name: "Sign-up" });
  await expect(signUp.getByRole("status")).toHaveText(/^Open|^Invite-only/);
});

test("an admin helps an account: limits, an exception, and a temporary password", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  // Someone who needs help, made first in a separate browser.
  const helped = await browser.newContext({
    baseURL: baseURL!,
    storageState: { cookies: [], origins: [] },
  });
  await useFreshAddress(helped);
  const helpedEmail = await signUpConfirmed(helped, baseURL!, "Petra Ng");

  const email = await signUpConfirmed(context, baseURL!, "Helper");
  grantAdmin(email);
  await context.clearCookies();
  await addVirtualAuthenticator(context, page);
  await signInWithPassword(page, email);
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();

  // Find the account and open its page.
  await page.getByLabel("Email or name").fill(helpedEmail);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Petra Ng" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Petra Ng" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Plan and household" })).toContainText("Free");
  await expectAccessible(page);

  // An exception: 500 recipes for this account.
  const limits = page.getByRole("region", { name: "Limits for this account" });
  await limits.getByLabel("Limit").selectOption("max_recipes");
  await limits.getByLabel("New value").fill("500");
  await limits.getByLabel("Note (optional)").fill("Big Paprika library");
  await limits.getByRole("button", { name: "Save exception" }).click();
  await expect(limits.getByRole("row").filter({ hasText: "Big Paprika library" })).toContainText(
    "500",
  );

  // A temporary password, shown once.
  const password = page.getByRole("region", { name: "Password help" });
  await password.getByRole("button", { name: "Set a temporary password" }).click();
  const shown = password.getByRole("status").filter({ hasText: "Temporary password" });
  await expect(shown).toBeVisible();
  const temporary = (await shown.locator("strong").textContent())!.trim();
  await expect(page.getByText("Temporary: must be changed at next sign-in")).toBeVisible();

  // They sign in with it and must choose their own before anything else.
  const helpedPage = await helped.newPage();
  await helpedPage.goto("/sign-in");
  await helpedPage.getByLabel("Email").fill(helpedEmail);
  await helpedPage.getByLabel("Password").fill(temporary);
  await helpedPage.getByRole("button", { name: "Sign in" }).click();
  await expect(
    helpedPage.getByRole("heading", { level: 1, name: "Choose a new password" }),
  ).toBeVisible();
  await helpedPage.getByLabel("Temporary password").fill(temporary);
  await helpedPage.getByLabel("New password", { exact: true }).fill("petra's own password");
  await helpedPage.getByLabel("New password again").fill("petra's own password");
  await helpedPage.getByRole("button", { name: "Save new password" }).click();
  await expect(helpedPage.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  await helped.close();

  // Everything shows in the account's activity.
  const log = page.getByRole("region", { name: "Admin activity for this account" });
  await expect(log.getByText("Set a temporary password").first()).toBeVisible();
  await expect(log.getByText("Set an account's limit").first()).toBeVisible();

  // Plan limits: change one (one no other test reads, as tests share a database), then put it
  // back.
  await page.getByRole("button", { name: "Back to search" }).click();
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("button", { name: "Plan limits" })
    .click();
  const table = page.getByRole("region", { name: "Plan limits" });
  await table.getByRole("button", { name: "Change Text per recipe for Individual" }).click();
  await table.getByLabel("Text per recipe for Individual").fill("0.5");
  await table.getByRole("button", { name: "Save" }).click();
  await expect(table.getByRole("status")).toHaveText("Text per recipe for Individual: 0.50 MB.");
  await expectAccessible(page);
  await table.getByRole("button", { name: "Change Text per recipe for Individual" }).click();
  await table.getByLabel("Text per recipe for Individual").fill("0.25");
  await table.getByRole("button", { name: "Save" }).click();
  await expect(table.getByRole("status")).toHaveText("Text per recipe for Individual: 0.25 MB.");
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
