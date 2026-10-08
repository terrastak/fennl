import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { premium, recipeCard, signInElsewhere, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase C7: categories.

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function addSamples(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
}

/** The category tree on the Categories page, as "path" lines in order. */
const treeRows = (page: Page) =>
  page.getByRole("list", { name: "Your categories" }).locator("li > div");
const undoStatus = (page: Page) => page.getByRole("status").filter({ hasText: /\.$/ }).first();

/** The recipe cards' titles, in the order shown. */
const cardTitles = (page: Page) =>
  page.getByRole("region", { name: /^\d+ recipes?$/ }).getByRole("listitem");

test("A category tree built, changed and undone with the keyboard", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/categories");
  await expect(page.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();
  await expect(page.getByText("No categories yet.")).toBeVisible();
  const key = page.keyboard;

  const box = page.getByLabel("New category");
  await box.focus();
  await key.type("Desserts > Cakes");
  await key.press("Enter");
  await expect(undoStatus(page)).toHaveText("Added Desserts › Cakes.");
  await key.type("Soups");
  await key.press("Enter");
  await expect(treeRows(page)).toHaveText([
    /^Desserts1? ?0 recipes/,
    /^Cakes0 recipes/,
    /^Soups0 recipes/,
  ]);

  // Rename Cakes.
  await page.getByRole("button", { name: "Rename Desserts › Cakes" }).focus();
  await key.press("Enter");
  await expect(page.getByLabel("New name for Cakes")).toBeFocused();
  await key.press("Control+a");
  await key.type("Layer cakes");
  await key.press("Enter");
  await expect(undoStatus(page)).toHaveText("Renamed Cakes to Layer cakes.");
  await expect(page.getByRole("button", { name: "Rename Desserts › Layer cakes" })).toBeFocused();

  // Move it to the top level, then undo.
  await page.getByRole("button", { name: "Move Desserts › Layer cakes" }).click();
  await expect(page.getByLabel("Move Layer cakes into")).toBeFocused();
  await page.getByLabel("Move Layer cakes into").selectOption({ label: "The top level" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(undoStatus(page)).toHaveText("Moved Layer cakes into the top level.");
  await expect(page.getByRole("button", { name: "Rename Layer cakes" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Rename Desserts › Layer cakes" })).toBeVisible();

  // Delete Desserts (and what's inside it), then bring it back.
  await page.getByRole("button", { name: "Delete Desserts", exact: true }).click();
  await expect(page.getByText("Delete Desserts and the 1 category inside it?")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(undoStatus(page)).toHaveText("Deleted Desserts.");
  await expect(page.getByRole("button", { name: /Rename Desserts/ })).toHaveCount(0);
  await noAccessibilityProblems(page);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Rename Desserts › Layer cakes" })).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  // Kept in the account.
  await page.reload();
  await expect(page.getByRole("button", { name: "Rename Desserts › Layer cakes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename Soups" })).toBeVisible();
});

test("Many recipes filed at once, with a preview, a count and undo; the list filters", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  await page.getByRole("button", { name: "Select" }).click();
  const bulk = page.getByRole("region", { name: "Selected recipes" });
  await expect(bulk).toContainText("0 of 4 selected");
  await page.getByRole("checkbox", { name: "Green Chile Stew" }).check();
  await page.getByRole("checkbox", { name: "Black Bean Tacos with Lime Crema" }).check();
  await expect(bulk).toContainText("2 of 4 selected");

  await bulk.getByRole("button", { name: "Add to a category" }).click();
  const add = bulk.getByRole("combobox", { name: "Add 2 recipes to" });
  await add.fill("Weeknight");
  await expect(bulk.getByRole("option", { name: "New category: Weeknight" })).toBeVisible();
  await add.press("Enter");
  await expect(bulk).toContainText("Add 2 recipes to Weeknight (a new category)?");
  await noAccessibilityProblems(page);
  await bulk.getByRole("button", { name: "Add 2 recipes" }).click();
  await expect(undoStatus(page)).toHaveText("Added 2 recipes to Weeknight.");

  // Adding again to one already there: only the new one counts.
  await page.getByRole("checkbox", { name: "Buttermilk Pancakes" }).check();
  await bulk.getByRole("button", { name: "Add to a category" }).click();
  await bulk.getByRole("combobox").fill("week");
  await bulk.getByRole("combobox").press("Enter");
  await expect(bulk).toContainText(
    "Add 1 recipe to Weeknight? 2 already there will stay as they are.",
  );
  await bulk.getByRole("button", { name: "Add 1 recipe" }).click();
  await expect(undoStatus(page)).toHaveText("Added 1 recipe to Weeknight.");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(undoStatus(page)).toHaveText("Undone.");

  // The filter, kept in the address.
  await page.getByRole("button", { name: "Done selecting" }).click();
  await page.getByLabel("Category").selectOption({ label: "Weeknight (2)" });
  await expect(cardTitles(page)).toHaveText([/Black Bean Tacos/, /Green Chile Stew/]);
  await expect(page).toHaveURL(/\?category=Weeknight$/);
  await page.reload();
  await expect(cardTitles(page)).toHaveCount(2);
  await page.getByLabel("Category").selectOption({ label: "Desserts (1)" });
  await expect(cardTitles(page)).toHaveText([/Lemon Olive Oil Cake/]);
  await page.getByLabel("Category").selectOption({ label: "Not in a category" });
  await expect(page.getByText("Every recipe is in a category.")).toBeVisible();
  await page.getByRole("button", { name: "Show all recipes" }).click();
  await expect(cardTitles(page)).toHaveCount(4);

  // Taken out again, many at once.
  await page.getByRole("button", { name: "Select" }).click();
  await bulk.getByRole("button", { name: "Select all shown" }).click();
  await bulk.getByRole("button", { name: "Take out of a category" }).click();
  await bulk.getByLabel("Take the selected recipes out of").selectOption({
    label: "Weeknight (2)",
  });
  await expect(bulk).toContainText("This takes 2 of the 4 selected out of Weeknight.");
  await bulk.getByRole("button", { name: "Take 2 recipes out" }).click();
  await expect(undoStatus(page)).toHaveText("Took 2 recipes out of Weeknight.");
  await expect(recipeCard(page, "Green Chile Stew")).not.toContainText("Weeknight");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
});

test("A recipe's categories, chosen in the editor by typing", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();

  const chips = page.getByRole("list", { name: "This recipe's categories" });
  await expect(chips.getByRole("listitem")).toHaveText(["Breakfast×Take out of Breakfast"]);
  const box = page.getByRole("combobox", { name: "Add a category" });
  await box.fill("cak");
  const options = page.getByRole("listbox", { name: "Add a category" }).getByRole("option");
  await expect(options).toHaveText(["Desserts › Cakes", "New category: cak"]);
  await box.press("ArrowDown");
  await box.press("ArrowUp");
  await box.press("Enter");
  await expect(chips.getByRole("listitem")).toHaveCount(2);
  await expect(chips).toContainText("Desserts › Cakes");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("");
  await noAccessibilityProblems(page);

  await page.getByRole("button", { name: "Take out of Breakfast" }).click();
  await expect(chips.getByRole("listitem")).toHaveText([
    "Desserts › Cakes×Take out of Desserts › Cakes",
  ]);
  await page.getByRole("button", { name: "Done" }).first().click();

  // The recipe page's categories lead to the list, filtered.
  await page.getByRole("link", { name: "Desserts › Cakes" }).click();
  await expect(page.getByLabel("Category")).toHaveValue("desserts › cakes");
  await expect(cardTitles(page)).toHaveText([/Buttermilk Pancakes/, /Lemon Olive Oil Cake/]);
});

test("Premium: category changes sync between devices", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/categories");
  await page.getByLabel("New category").fill("Holidays > Thanksgiving");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  const phone = await signInElsewhere(browser, baseURL!, email);
  await phone.goto("/categories");
  await phone.getByRole("button", { name: "Rename Holidays › Thanksgiving" }).click();
  await phone.getByLabel("New name for Thanksgiving").fill("Friendsgiving");
  await phone.getByRole("button", { name: "Save" }).click();
  await expect(syncStatus(phone)).toHaveText("Saved to cloud");
  await phone.context().close();

  // The laptop fetches when it opens.
  await page.reload();
  await expect(page.getByRole("button", { name: "Rename Holidays › Friendsgiving" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename Holidays › Thanksgiving" })).toHaveCount(0);
});
