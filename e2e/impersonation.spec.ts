import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { editorStatus, recipeCard, syncStatus } from "./recipes";
import { PASSWORD, runLocalSql, signUpConfirmed, useFreshAddress } from "./support";

// Phase C12: an admin acting as a user, locally at /admin and / on one address
// (ACCESS_DEV_BYPASS stands in for Cloudflare Access; production uses the admin address).
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ context, isMobile }) => {
  test.skip(isMobile, "The admin console is checked on a computer");
  await useFreshAddress(context);
});

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

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

/** A new admin, signed in to the console with a passkey just now. */
async function signedInAdmin(page: Page, context: BrowserContext, baseURL: string) {
  const email = await signUpConfirmed(context, baseURL, "Ada Admin");
  runLocalSql(`UPDATE user SET role = 'admin' WHERE email = '${email}'`);
  await context.clearCookies();
  await addVirtualAuthenticator(context, page);
  await page.goto("/admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();
}

test("Act as an account, edit a recipe; they see the edit and no trace; the log has it all", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  // Petra, on her own computer, with a few recipes.
  const petra = await browser.newContext({
    baseURL: baseURL!,
    storageState: { cookies: [], origins: [] },
  });
  await useFreshAddress(petra);
  const petraEmail = await signUpConfirmed(petra, baseURL!, "Petra Ng");
  const petraPage = await petra.newPage();
  await petraPage.goto("/");
  await petraPage.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(petraPage, "Green Chile Stew")).toBeVisible();
  await expect(syncStatus(petraPage)).toHaveText("Saved to cloud");

  // The admin finds her account and acts as her, with a reason.
  await signedInAdmin(page, context, baseURL!);
  await page.getByLabel("Email or name").fill(petraEmail);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Petra Ng" }).click();
  const actAs = page.getByRole("region", { name: "View as this user" });
  await expect(actAs.getByRole("button", { name: "View as this user" })).toBeDisabled();
  await actAs.getByLabel("Reason (kept in the admin log)").fill("Petra says her stew is missing");
  await expectAccessible(page);
  await actAs.getByRole("button", { name: "View as this user" }).click();

  // The app, as Petra, with the bar on every page.
  const banner = page.getByRole("region", { name: "Acting as this person" });
  await expect(banner).toContainText(`Acting as Petra Ng (${petraEmail})`);
  await expect(banner).toContainText("Ends at");
  await expect(recipeCard(page, "Green Chile Stew")).toBeVisible();
  await expectAccessible(page);

  // An edit, saved straight to her account.
  await page.getByRole("link", { name: /Green Chile Stew/ }).click();
  await expect(banner).toBeVisible();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await page.getByLabel("Notes").fill("Checked by support: it's all here.");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByText("Checked by support: it's all here.")).toBeVisible();

  // Petra sees the edit, and nothing else: one device (hers), no banner.
  await petraPage.reload();
  await petraPage.getByRole("link", { name: /Green Chile Stew/ }).click();
  await expect(petraPage.getByText("Checked by support: it's all here.")).toBeVisible();
  await expect(petraPage.getByRole("region", { name: "Acting as this person" })).toHaveCount(0);
  await petraPage.goto("/settings");
  const devices = petraPage.getByRole("region", { name: "Devices" });
  await expect(devices.getByRole("listitem")).toHaveCount(1);
  await expect(devices).toContainText("This device");

  // Stopping goes back to her account in the console, where the log shows the reason and edit.
  await banner.getByRole("button", { name: "Stop acting as Petra Ng" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Petra Ng" })).toBeVisible();
  const log = page.getByRole("region", { name: "Admin activity for this account" });
  await expect(log.getByRole("row").filter({ hasText: "Started acting as them" })).toContainText(
    "Reason: Petra says her stew is missing",
  );
  await expect(
    log.getByRole("row").filter({ hasText: "Changed something while acting as them" }).first(),
  ).toContainText("edited: notes");
  await expect(log.getByText("Stopped acting as them")).toBeVisible();
  await expectAccessible(page);

  // This browser's copy of her recipes is gone: the app here is the admin's own account again.
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 2, name: /Your recipe box is empty/ }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Acting as this person" })).toHaveCount(0);
  await petra.close();
});
