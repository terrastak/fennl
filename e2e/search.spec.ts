import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  expectListSearch,
  openFilters,
  premium,
  recipeCard,
  searchList,
  syncStatus,
} from "./recipes";
import { useOwnAccount } from "./support";

// Phase C8: search.

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

/** The titles of the cards shown, in order. */
const titles = (page: Page) =>
  page.getByRole("region", { name: /^\d+ recipes?$/ }).locator("[id^=card-title-]");

test("Search by an ingredient, a word in the notes, and part of a title", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  // An ingredient: the card says where it was found, with the word marked.
  await searchList(page, "cumin");
  await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  await expect(recipeCard(page, "Green Chile Stew")).toContainText(
    "Ingredients: 1 teaspoon ground cumin",
  );
  await expect(recipeCard(page, "Green Chile Stew").locator("mark")).toHaveText("cumin");
  await expect(page.getByText("Showing 1 of 4.")).toBeVisible();

  // A word in the notes.
  await searchList(page, "freezes");
  await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  await expect(recipeCard(page, "Green Chile Stew")).toContainText("Notes: Freezes well");

  // Part of a title.
  await searchList(page, "panc");
  await expect(titles(page)).toHaveText(["Buttermilk Pancakes"]);

  // Titles with the word come first, then the others (here, a note mentioning lemon).
  await searchList(page, "lemon");
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake", "Buttermilk Pancakes"]);
  await expect(page.getByText("titles with every word come first")).toBeVisible();

  // Every word must match, anywhere: a category and an ingredient.
  await searchList(page, "mexican lime");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
  await searchList(page, "nothing like this");
  await expect(page.getByText("No recipes found.")).toBeVisible();
  await noAccessibilityProblems(page);

  // Kept in the address, so a reload keeps it.
  await searchList(page, "nana");
  await expect(page).toHaveURL(/\?q=nana$/);
  await page.reload();
  await expectListSearch(page, "nana");
  await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  await page.getByRole("button", { name: "Show all recipes" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expectListSearch(page, "");
});

test("Search finds changes straight away, and works with the filters", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  // A note written just now is found.
  await page.getByRole("link", { name: /Lemon Olive Oil Cake/ }).click();
  const yours = page.getByRole("region", { name: "Yours" });
  await yours.getByRole("radio", { name: "5 stars" }).check({ force: true });
  await yours.getByLabel("Your note").fill("Grandma used Meyer lemons");
  await expect(yours.locator("[data-note-status]")).toHaveText("Saved.");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: "All recipes" }).click();
  await searchList(page, "meyer");
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake"]);

  // With the rating filter: only recipes you rated.
  await searchList(page, "lemon");
  await expect(titles(page)).toHaveCount(2);
  await openFilters(page);
  await page.getByLabel("Rating").selectOption({ label: "4 stars and up" });
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake"]);
  await expect(page).toHaveURL(/rating=4/);

  // With a category.
  await page.getByLabel("Rating").selectOption({ label: "Any rating" });
  await page.getByLabel("Category", { exact: true }).selectOption({ label: "Breakfast (1)" });
  await expect(titles(page)).toHaveText(["Buttermilk Pancakes"]);
});

test("Premium: search works with no connection", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await addSamples(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.reload();
  await expect(syncStatus(page)).toHaveText("Offline");
  await searchList(page, "crema");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
  await context.setOffline(false);
});
