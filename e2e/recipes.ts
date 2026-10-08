import { expect, type BrowserContext, type Page } from "@playwright/test";
import { makeCode } from "./support";

// Helpers for browser tests that work with recipes (phases C4 and C5).

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

/** Adds a recipe by its title from the recipe list. */
export async function addRecipe(page: Page, title: string) {
  const field = page.getByLabel("New recipe");
  if (!(await field.isVisible())) await page.getByRole("button", { name: "Add recipe" }).click();
  await field.fill(title);
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(recipeCard(page, title)).toBeVisible();
}
