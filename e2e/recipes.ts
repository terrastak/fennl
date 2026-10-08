import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PASSWORD, makeCode, useFreshAddress } from "./support";

// Helpers for browser tests that work with recipes (phases C4 to C6).

/** Premium from a code, as beta testers have it. */
export async function premium(context: BrowserContext, baseURL: string) {
  const code = makeCode({ tier: "individual", days: 30, allowsSignUp: false });
  const used = await context.request.post("/api/codes/redeem", {
    headers: { origin: baseURL },
    data: { code },
  });
  expect(used.ok()).toBe(true);
}

/** The sync status in the app's frame (the sidebar's or the top bar's, whichever shows). */
export const syncStatus = (page: Page) =>
  page.locator("[data-sync-status]").filter({ visible: true });

/** A recipe's card in the list. */
export const recipeCard = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ hasText: title });

/** The editor's saving status ("All changes saved"). */
export const editorStatus = (page: Page) => page.locator("[data-editor-status]");

/** Adds a recipe with just a title, from the recipe list, and comes back to the list. */
export async function addRecipe(page: Page, title: string) {
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await page.getByRole("link", { name: "All recipes" }).click();
  await expect(recipeCard(page, title)).toBeVisible();
}

/** The same account signed in on another device (its own browser storage). */
export async function signInElsewhere(
  browser: Browser,
  baseURL: string,
  email: string,
  device: Record<string, unknown> = {},
): Promise<Page> {
  const context = await browser.newContext({
    ...device,
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  await useFreshAddress(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  return page;
}
