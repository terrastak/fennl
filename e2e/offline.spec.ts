import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { makeCode, useOwnAccount } from "./support";

// Phase C4b: the app's own files are kept on the device, so Fennl opens with no connection.

async function premium(context: BrowserContext, baseURL: string) {
  const code = makeCode({ tier: "individual", days: 30, allowsSignUp: false });
  const used = await context.request.post("/api/codes/redeem", {
    headers: { origin: baseURL },
    data: { code },
  });
  expect(used.ok()).toBe(true);
}

const status = (page: Page) => page.locator("[data-sync-status]").filter({ visible: true });
const recipe = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

async function addRecipe(page: Page, title: string) {
  await page.getByLabel("New recipe").fill(title);
  await page.getByRole("button", { name: "Add recipe" }).click();
  await expect(recipe(page, title)).toBeVisible();
}

/** Waits until this build's files are kept on the device. */
async function filesKept(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

test("Premium: opens with no connection, and changes made then sync later", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Pozole verde");
  await expect(status(page)).toHaveText("Saved to cloud");
  await filesKept(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
  await expect(recipe(page, "Pozole verde")).toBeVisible();
  await expect(status(page)).toHaveText("Offline");

  // Another page, opened offline too.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.goto("/");

  await addRecipe(page, "Elote");
  await expect(status(page)).toHaveText("Offline · 1 change waiting");

  await context.setOffline(false);
  await expect(status(page)).toHaveText("Saved to cloud", { timeout: 15_000 });
  await page.reload();
  await expect(recipe(page, "Elote")).toBeVisible();
  await expect(recipe(page, "Elote")).not.toContainText("not synced yet");
});

test("Free: opens with no connection to read, with editing paused", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Capirotada");
  await expect(status(page)).toHaveText("Saved to cloud");
  await filesKept(page);

  await context.setOffline(true);
  await page.reload();
  await expect(recipe(page, "Capirotada")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Editing is paused");
  await expect(page.getByLabel("New recipe")).toBeDisabled();

  await context.setOffline(false);
  await expect(status(page)).toHaveText("Saved to cloud", { timeout: 15_000 });
  await expect(page.getByLabel("New recipe")).toBeEnabled();
});
