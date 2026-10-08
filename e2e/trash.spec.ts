import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { premium, recipeCard, signInElsewhere, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase C9: Trash and restore.

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

/** Moves a recipe to Trash from its page; returns the page's address. */
async function moveToTrash(page: Page, title: string): Promise<string> {
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByRole("button", { name: "Move to Trash" })).toBeVisible();
  const url = page.url();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("status").filter({ hasText: "to Trash." })).toHaveText(
    `Moved “${title}” to Trash.`,
  );
  return url;
}

const trashList = (page: Page) => page.getByRole("list", { name: "Recipes in Trash" });

test("Moved to Trash, then put back: from the list's Undo, and from Trash", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  await moveToTrash(page, "Buttermilk Pancakes");
  await expect(recipeCard(page, "Buttermilk Pancakes")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(recipeCard(page, "Buttermilk Pancakes")).toBeVisible();

  await moveToTrash(page, "Buttermilk Pancakes");
  await page.getByRole("link", { name: "Trash", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible();
  await expect(trashList(page).getByRole("listitem")).toHaveCount(1);
  await expect(trashList(page)).toContainText("Deleted for good in 30 days");
  await noAccessibilityProblems(page);

  // Its page says it's in Trash, and puts it back.
  await trashList(page).getByRole("link", { name: "Buttermilk Pancakes" }).click();
  await expect(page.getByText("This recipe is in Trash.")).toBeVisible();
  await page.getByRole("button", { name: "Put back" }).click();
  await expect(page.getByRole("button", { name: "Move to Trash" })).toBeVisible();
  await page.getByRole("link", { name: "All recipes" }).click();
  await expect(recipeCard(page, "Buttermilk Pancakes")).toBeVisible();

  // Put back from the Trash page too.
  await moveToTrash(page, "Lemon Olive Oil Cake");
  await page.goto("/trash");
  await trashList(page).getByRole("button", { name: "Put back Lemon Olive Oil Cake" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Put “Lemon Olive Oil Cake” back in your recipes.",
  );
  await expect(page.getByText("Trash is empty.")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
});

test("Deleted for good, one or all, after a question", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  const stewUrl = await moveToTrash(page, "Green Chile Stew");
  await moveToTrash(page, "Black Bean Tacos with Lime Crema");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.goto("/trash");
  await expect(trashList(page).getByRole("listitem")).toHaveCount(2);

  // One: asked first, then gone.
  await trashList(page).getByRole("button", { name: "Delete for good Green Chile Stew" }).click();
  await expect(
    page.getByText("Delete “Green Chile Stew” for good? This can’t be undone."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete for good", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Deleted 1 recipe for good.");
  await expect(trashList(page).getByRole("listitem")).toHaveCount(1);

  // All: Cancel changes nothing; then it empties.
  await page.getByRole("button", { name: "Empty Trash" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(trashList(page).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Empty Trash" }).click();
  await expect(page.getByText("Delete all 1 recipe in Trash for good?")).toBeVisible();
  await page.getByRole("button", { name: "Empty Trash" }).click();
  await expect(page.getByText("Trash is empty.")).toBeVisible();

  // Gone everywhere: after a reload, and at its old address.
  await page.reload();
  await expect(page.getByText("Trash is empty.")).toBeVisible();
  await page.goto(stewUrl);
  await expect(page.getByRole("heading", { name: "This recipe isn’t here" })).toBeVisible();
  await expect(page.getByText("It was deleted for good after its time in Trash.")).toBeVisible();
  await page.goto("/");
  await expect(recipeCard(page, "Green Chile Stew")).toHaveCount(0);
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
});

test("Premium: deleted on one device, in Trash on the other, and put back there", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await addSamples(page);
  await moveToTrash(page, "Lemon Olive Oil Cake");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  const phone = await signInElsewhere(browser, baseURL!, email);
  await expect(recipeCard(phone, "Buttermilk Pancakes")).toBeVisible();
  await expect(recipeCard(phone, "Lemon Olive Oil Cake")).toHaveCount(0);
  await phone.goto("/trash");
  await trashList(phone).getByRole("button", { name: "Put back Lemon Olive Oil Cake" }).click();
  await expect(phone.getByText("Trash is empty.")).toBeVisible();
  await expect(syncStatus(phone)).toHaveText("Saved to cloud");
  await phone.context().close();

  await page.reload();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
});
