import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { addRecipe, premium, recipeCard, syncStatus } from "./recipes";
import { PASSWORD, useFreshAddress, useOwnAccount } from "./support";

// Phase C4: the browser's copy of the recipe box, kept in step with the account. Each "device"
// is a separate browser context: its own storage and its own sign-in.

async function signInElsewhere(browser: Browser, baseURL: string, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  await useFreshAddress(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  return page;
}

const status = syncStatus;
const recipe = recipeCard;

test("Premium: a recipe added on one device appears on another, and edits come back", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/");
  await expect(status(page)).toHaveText("Saved to cloud");
  await addRecipe(page, "Green chile stew");
  await expect(status(page)).toHaveText("Saved to cloud");

  const phone = await signInElsewhere(browser, baseURL!, email);
  await expect(recipe(phone, "Green chile stew")).toBeVisible();
  await phone.getByRole("link", { name: /Green chile stew/ }).click();
  await phone.getByRole("button", { name: "Made it today" }).click();
  await expect(phone.getByText("Last made today")).toBeVisible();
  await expect(status(phone)).toHaveText("Saved to cloud");

  // The laptop fetches when it opens (and on focus, and every minute).
  await page.reload();
  await page.getByRole("link", { name: /Green chile stew/ }).click();
  await expect(page.getByText("Last made today")).toBeVisible();

  // Moved to Trash on the phone: gone from the laptop's list.
  await phone.getByRole("button", { name: "Move to Trash" }).click();
  await expect(phone.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  await expect(status(phone)).toHaveText("Saved to cloud");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your recipe box is empty, for now" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await phone.context().close();
});

test("Premium: changes made offline wait, then sync when the connection is back", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/");
  await expect(status(page)).toHaveText("Saved to cloud");

  await context.setOffline(true);
  await addRecipe(page, "Offline posole");
  await expect(recipe(page, "Offline posole")).toContainText(/not synced yet/i);
  await expect(status(page)).toHaveText("Offline · 1 change waiting");
  await addRecipe(page, "Offline tamales");
  await expect(status(page)).toHaveText("Offline · 2 changes waiting");

  await context.setOffline(false);
  await expect(status(page)).toHaveText("Saved to cloud", { timeout: 15_000 });
  await expect(recipe(page, "Offline posole")).not.toContainText(/not synced yet/i);

  const other = await signInElsewhere(browser, baseURL!, email);
  await expect(recipe(other, "Offline posole")).toBeVisible();
  await expect(recipe(other, "Offline tamales")).toBeVisible();
  await other.context().close();
});

test("Free: editing pauses while offline, with a notice", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Salsa macha");
  await expect(status(page)).toHaveText("Saved to cloud");

  await context.setOffline(true);
  await expect(page.getByRole("alert")).toContainText("Editing is paused");
  await expect(page.getByLabel("New recipe")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save recipe" })).toBeDisabled();

  await context.setOffline(false);
  await expect(status(page)).toHaveText("Saved to cloud", { timeout: 15_000 });
  await expect(page.getByLabel("New recipe")).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("A browser whose storage was wiped gets everything back", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Flan");
  await addRecipe(page, "Churros");
  await expect(status(page)).toHaveText("Saved to cloud");

  // Leave the app (so it lets go of its files), then clear this site's storage the way a
  // browser might: the local database and the device ID. The sign-in cookie stays.
  await page.goto("/api/health");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      await root.removeEntry(name, { recursive: true });
    }
    localStorage.clear();
  });

  await page.goto("/");
  await expect(recipe(page, "Flan")).toBeVisible();
  await expect(recipe(page, "Churros")).toBeVisible();
  await expect(status(page)).toHaveText("Saved to cloud");
});

test("Two tabs share one copy, and the second carries on when the first closes", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await expect(status(page)).toHaveText("Saved to cloud");

  const second = await context.newPage();
  await second.goto("/");
  await expect(status(second)).toHaveText("Saved to cloud");
  await addRecipe(second, "Arroz rojo");
  // The first tab hears about it without reloading.
  await expect(recipe(page, "Arroz rojo")).toBeVisible();

  await page.close();
  await addRecipe(second, "Frijoles");
  await expect(status(second)).toHaveText("Saved to cloud");
  await second.reload();
  await expect(recipe(second, "Frijoles")).toBeVisible();
  await expect(recipe(second, "Arroz rojo")).toBeVisible();
});
