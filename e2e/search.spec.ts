import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openFilters, premium, recipeCard, showCategory, syncStatus } from "./recipes";
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

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search recipes" });

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
  await searchBox(page).fill("cumin");
  await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  await expect(recipeCard(page, "Green Chile Stew")).toContainText(
    "Ingredients: 1 teaspoon ground cumin",
  );
  await expect(recipeCard(page, "Green Chile Stew").locator("mark")).toHaveText("cumin");
  await expect(page.getByText("1 recipe · matching “cumin”")).toBeVisible();

  // A word in the notes.
  await searchBox(page).fill("freezes");
  await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  await expect(recipeCard(page, "Green Chile Stew")).toContainText("Notes: Freezes well");

  // Part of a title.
  await searchBox(page).fill("panc");
  await expect(titles(page)).toHaveText(["Buttermilk Pancakes"]);

  // Titles with the word come first, then the others (here, a note mentioning lemon).
  await searchBox(page).fill("lemon");
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake", "Buttermilk Pancakes"]);

  // Every word must match, anywhere: a category and an ingredient.
  await searchBox(page).fill("mexican lime");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
  await searchBox(page).fill("nothing like this");
  await expect(page.getByText("No recipes found.")).toBeVisible();
  await noAccessibilityProblems(page);

  // Kept in the address, so a reload keeps it.
  await searchBox(page).fill("nana");
  await expect(page).toHaveURL(/\?q=nana$/);
  await page.reload();
  await expect(searchBox(page)).toHaveValue("nana");
  await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(searchBox(page)).toHaveValue("");
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
  await page.getByRole("radio", { name: "5 stars" }).check({ force: true });
  await page.getByRole("button", { name: "Add a note" }).click();
  await page.getByLabel("Your note").fill("Grandma used Meyer lemons");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Grandma used Meyer lemons", { exact: true })).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: "← All recipes" }).click();
  await searchBox(page).fill("meyer");
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake"]);

  // With the rating filter: only recipes you rated.
  await searchBox(page).fill("lemon");
  await expect(titles(page)).toHaveCount(2);
  const panel = await openFilters(page);
  await panel.getByRole("button", { name: "4 stars and up" }).click();
  await page.keyboard.press("Escape");
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake"]);
  await expect(page).toHaveURL(/rating=4/);

  // With a category: the one match outside it is offered.
  await openFilters(page);
  await panel.getByRole("button", { name: "Any" }).nth(1).click();
  await page.keyboard.press("Escape");
  await showCategory(page, "Breakfast");
  await expect(titles(page)).toHaveText(["Buttermilk Pancakes"]);
  await expect(page.getByText("1 more matches outside Breakfast.")).toBeVisible();
  await page.getByRole("button", { name: "Search all recipes" }).click();
  await expect(titles(page)).toHaveCount(2);
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
  await searchBox(page).fill("crema");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
  await context.setOffline(false);
});
