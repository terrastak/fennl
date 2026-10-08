import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { addRecipe, editorStatus, recipeCard, syncStatus } from "./recipes";
import { runLocalSql, useOwnAccount } from "./support";

// Phase C11: plan limits, the usage bar, and what happens over a limit.

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** A limit for this account's household, as the admin console sets one (limit_override). */
async function setLimit(
  context: BrowserContext,
  baseURL: string,
  key: "max_recipes" | "max_text_bytes" | "max_recipe_bytes",
  value: number | null,
) {
  const res = await context.request.get("/api/household", { headers: { origin: baseURL } });
  const { id } = (await res.json()) as { id: string };
  runLocalSql(
    "INSERT INTO limit_override (id, household_id, key, value, note, created_at) VALUES " +
      `('${crypto.randomUUID()}', '${id}', '${key}', ${value ?? "NULL"}, 'Browser test', ${Date.now()}) ` +
      "ON CONFLICT(household_id, key) DO UPDATE SET value = excluded.value",
  );
}

async function addSamples(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
}

const storage = (page: Page) => page.getByRole("group", { name: "Recipe storage" });

async function moveToTrash(page: Page, title: string) {
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByText(`Moved “${title}” to Trash.`)).toBeVisible();
}

test("The bar warns, then blocks Add recipe; editing and download still work; Trash makes room", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await setLimit(context, baseURL!, "max_recipes", 5);
  await addSamples(page);

  // 4 of 5: the bar shows beside "Add recipe".
  await expect(storage(page)).toContainText("4 of 5 recipes");
  await expect(storage(page).getByRole("meter", { name: "Recipes" })).toHaveAttribute(
    "aria-valuenow",
    "4",
  );
  await addRecipe(page, "Fifth Soup");

  // 5 of 5: "Add recipe" says why instead of opening the editor.
  await expect(storage(page)).toContainText("5 of 5 recipes");
  const why = page.locator("#add-blocked");
  await expect(why).toHaveText(
    "You have 5 recipes, as many as your plan includes. To add another, move one you don’t need to Trash. Everything you have stays yours to read, change and download.",
  );
  const add = page.getByRole("button", { name: "Add recipe" });
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await add.click({ force: true });
  await expect(why).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  await noAccessibilityProblems(page);

  // Opening a new recipe's address directly says the same.
  await page.goto(`/recipes/${crypto.randomUUID()}/edit?new`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No room for a new recipe");

  // Editing still works.
  await page.goto("/");
  await page.getByRole("link", { name: /Green Chile Stew/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await page.getByLabel("Notes").fill("Even better the next day.");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByText("Even better the next day.")).toBeVisible();

  // Settings shows the same, and the download is there.
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Recipe storage" });
  await expect(section.getByRole("meter", { name: "Recipes" })).toBeVisible();
  await expect(section).toContainText("5 of 5 recipes");
  await expect(section).toContainText("of 3 MB of recipe text");
  await expect(section.getByRole("status")).toContainText("as many as your plan includes");
  const download = await context.request.get("/api/export", { headers: { origin: baseURL! } });
  expect(download.status()).toBe(200);
  await noAccessibilityProblems(page);

  // Moving one to Trash makes room, and a recipe in Trash can come back only with room.
  await page.goto("/");
  await moveToTrash(page, "Fifth Soup");
  await expect(storage(page)).toContainText("4 of 5 recipes");
  await expect(page.locator("#add-blocked")).toHaveCount(0);
  await addRecipe(page, "Sixth Soup");
  await page.goto("/trash");
  await page.getByRole("button", { name: "Put back Fifth Soup" }).click();
  await expect(page.getByRole("status").filter({ hasText: "recipes" })).toHaveText(
    "You have 5 recipes, as many as your plan includes. To put this one back, move another recipe to Trash first. Everything you have stays yours to read, change and download.",
  );
  await expect(page.getByRole("list", { name: "Recipes in Trash" })).toContainText("Fifth Soup");
});

test("Over the limit (say, Premium ended): everything stays, adding waits", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await setLimit(context, baseURL!, "max_recipes", 2);
  await page.reload();

  await expect(storage(page)).toContainText("4 of 2 recipes");
  await expect(page.locator("#add-blocked")).toContainText(
    "You have 4 recipes, and your plan includes 2.",
  );
  await expect(page.getByRole("region", { name: /4 recipes/ })).toBeVisible();

  // Still editable: a rating, and a recipe moved to Trash.
  await page.getByRole("link", { name: /Lemon Olive Oil Cake/ }).click();
  const yours = page.getByRole("region", { name: "Yours" });
  await yours.getByRole("radio", { name: "4 stars" }).check({ force: true });
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: "All recipes" }).click();
  await moveToTrash(page, "Buttermilk Pancakes");
  await expect(storage(page)).toContainText("3 of 2 recipes");
});

test("A new recipe the server turns away stays on this device until there's room", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  // The editor opens with room; the limit drops before the recipe is saved (an admin, or the
  // other person in a household adding one meanwhile).
  await page.getByRole("button", { name: "Add recipe" }).click();
  await setLimit(context, baseURL!, "max_recipes", 4);
  await page.getByLabel("Title", { exact: true }).fill("Pozole");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  const held = page.getByRole("alert").filter({ hasText: "isn’t in your account yet" });
  await expect(held).toBeVisible();
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.getByRole("link", { name: "All recipes" }).click();
  await expect(recipeCard(page, "Pozole")).toContainText("Not synced yet");

  // Making room sends it.
  await moveToTrash(page, "Buttermilk Pancakes");
  await expect(held).toHaveCount(0);
  await expect(recipeCard(page, "Pozole")).not.toContainText("Not synced yet");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.reload();
  await expect(recipeCard(page, "Pozole")).toBeVisible();
  await expect(storage(page)).toContainText("4 of 4 recipes");
});

test("An unusually large recipe isn't saved until it's shorter", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await setLimit(context, baseURL!, "max_recipe_bytes", 3000);
  await page.reload();
  await page.getByRole("link", { name: /Green Chile Stew/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();

  const notes = page.getByLabel("Notes");
  await notes.fill("Long ".repeat(800));
  await expect(editorStatus(page)).toHaveText("Too large to save");
  const notice = page.getByRole("alert").filter({ hasText: "unusually large" });
  await expect(notice).toHaveText(
    "This recipe is unusually large, so changes can’t be saved. Shorten it, or split it into two recipes.",
  );
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(notice).toBeFocused();

  await notes.fill("Short again.");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await expect(notice).toHaveCount(0);
});
