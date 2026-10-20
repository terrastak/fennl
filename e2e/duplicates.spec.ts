import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editorStatus, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase C14: the duplicate finder.

const BUTTER = "225g butter\n225g caster sugar\n4 eggs\n225g self-raising flour";

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** Adds a recipe with a title, ingredients and optionally notes, and comes back to the list. */
async function addRecipe(page: Page, title: string, ingredients: string, notes = "") {
  await page.goto("/");
  await page.getByRole("button", { name: "Add recipe" }).first().click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Ingredients" }).fill(ingredients);
  if (notes) await page.getByLabel("Notes").fill(notes);
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/**
 * Two copies of the same recipe: the first made on a day, the second fuller (it has notes), so
 * the second is the one kept and the first's day has to be carried across.
 */
async function addTwoCopies(page: Page) {
  await addRecipe(page, "Victoria Sponge Cake", BUTTER);
  await page.getByRole("button", { name: "Made it today" }).click();
  await expect(page.getByText("Last made today")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await addRecipe(page, "Victoria sponge cake", BUTTER, "Sandwich with jam and cream.");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
}

const pairCount = (page: Page) => page.getByRole("heading", { name: /possible duplicates?$/ });

async function findDuplicates(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Find duplicates" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Find duplicates" })).toBeVisible();
  await page.getByRole("button", { name: "Find duplicates" }).click();
}

test("Nothing runs until asked, and a library with no duplicates says so", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  await page.getByRole("link", { name: "Find duplicates" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Find duplicates" })).toBeVisible();
  // Not looked yet.
  await expect(page.getByText(/No duplicates found/)).toHaveCount(0);
  await expect(pairCount(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Find duplicates" }).click();
  await expect(page.getByText("No duplicates found among your 4 recipes.")).toBeVisible();
  await noAccessibilityProblems(page);
});

test("Find two copies, merge them, see what moved, and undo it", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addTwoCopies(page);
  await findDuplicates(page);

  await expect(pairCount(page)).toHaveText("1 possible duplicate");
  await expect(page.getByText("The same title and mostly the same ingredients")).toBeVisible();

  await page.getByRole("button", { name: "Compare and merge" }).click();
  const panel = page.getByRole("region", { name: "Compare and merge" });
  await expect(panel).toBeVisible();
  // The fuller copy (it has notes) is the one kept, and it needs nothing chosen.
  const keep = panel.getByRole("group", { name: "Keep this recipe" });
  await expect(keep.getByRole("radio", { name: /^Victoria sponge cake/ })).toBeChecked();
  await expect(panel.getByText("What will happen")).toBeVisible();
  await expect(panel.getByText("Add 1 “made it” day.")).toBeVisible();
  await expect(
    panel.getByText("Move “Victoria Sponge Cake” to Trash, where you can put it back for 30 days."),
  ).toBeVisible();
  await noAccessibilityProblems(page);

  // Choosing the other copy to keep changes what will happen.
  await keep.getByRole("radio", { name: /^Victoria Sponge Cake/ }).check();
  await expect(panel.getByText("Move “Victoria sponge cake” to Trash")).toBeVisible();
  await keep.getByRole("radio", { name: /^Victoria sponge cake/ }).check();

  await panel.getByRole("button", { name: "Merge" }).click();
  await expect(
    page.getByText("Merged “Victoria Sponge Cake” into “Victoria sponge cake”."),
  ).toBeVisible();
  await expect(page.getByText("No more duplicates to look at.")).toBeVisible();

  // The extra copy is in Trash; the list has just the kept one, which now has the day the other
  // was made.
  await page.goto("/trash");
  await expect(page.getByRole("link", { name: "Victoria Sponge Cake" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "1 recipe" })).toBeVisible();
  await recipeCard(page, "Victoria sponge cake").getByRole("link").click();
  await expect(page.getByText("Last made today")).toBeVisible();
  await expect(page.getByText("Sandwich with jam and cream.")).toBeVisible();
});

test("Undo puts both recipes back exactly as they were", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await addTwoCopies(page);
  await findDuplicates(page);
  await page.getByRole("button", { name: "Compare and merge" }).click();
  await page.getByRole("button", { name: "Merge" }).click();
  await expect(page.getByText(/^Merged “/)).toBeVisible();
  await expect(page.getByText("No more duplicates to look at.")).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Undone.")).toBeVisible();
  // Both are back in the list, so looking again finds the pair.
  await page.getByRole("button", { name: "Look again" }).click();
  await expect(pairCount(page)).toHaveText("1 possible duplicate");
  await page.goto("/");
  await expect(page.getByRole("region", { name: /^2 recipes$/ })).toBeVisible();
});

test("Not a duplicate is remembered with the account, and can be taken back", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addTwoCopies(page);
  await findDuplicates(page);

  await page.getByRole("button", { name: "Not a duplicate" }).click();
  await expect(
    page.getByText("Marked as not duplicates. They won't be offered again."),
  ).toBeVisible();
  await expect(page.getByText("No more duplicates to look at.")).toBeVisible();

  // Taking it straight back.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(pairCount(page)).toHaveText("1 possible duplicate");
  await page.getByRole("button", { name: "Not a duplicate" }).click();
  await expect(page.getByText("No more duplicates to look at.")).toBeVisible();

  // Remembered: looking again, even after a reload, doesn't offer it.
  await page.reload();
  await page.getByRole("button", { name: "Find duplicates" }).click();
  await expect(page.getByText("No more duplicates to look at.")).toBeVisible();

  // And it can be brought back.
  await page.getByRole("button", { name: "Show the dismissed pair again" }).click();
  await expect(pairCount(page)).toHaveText("1 possible duplicate");
});

test("Merging says what can't be carried across, and won't merge a copy into itself", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addRecipe(page, "Pancakes", "1 cup flour\n2 eggs\n1 cup milk");
  await addRecipe(page, "Pancakes", "1 cup flour\n2 eggs\n1 cup milk");
  await findDuplicates(page);
  await expect(pairCount(page)).toHaveText("1 possible duplicate");
  await page.getByRole("button", { name: "Compare and merge" }).click();
  const panel = page.getByRole("region", { name: "Compare and merge" });
  // Identical copies: nothing to choose, merging just removes the extra.
  await expect(panel.getByText(/say the same thing in every part/)).toBeVisible();
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel).toHaveCount(0);
});
