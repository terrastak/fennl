import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectListSearch, recipeCard, searchList, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase C13a: more filters on the recipe list. The four sample recipes are:
//   Green Chile Stew (Mexican, Soups; 125 min; serves 6; from Nana; has cumin)
//   Buttermilk Pancakes (Breakfast; 30 min; serves 4; has nutrition)
//   Black Bean Tacos with Lime Crema (Mexican, Diet › Vegetarian; 30 min; serves 4)
//   Lemon Olive Oil Cake (Desserts › Cakes; 60 min; serves 10)

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

const panel = (page: Page) => page.getByRole("region", { name: "More filters" });

async function openFilters(page: Page) {
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(panel(page)).toBeVisible();
}

/** Picks a category in one of the panel's boxes by typing part of its name. */
async function pickCategory(page: Page, box: string, typed: string) {
  const input = panel(page).getByRole("combobox", { name: box });
  await input.fill(typed);
  await input.press("Enter");
}

test("Narrow the list by time, servings, categories, ingredients and more", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await openFilters(page);

  // Time: up to 30 minutes.
  await panel(page).getByRole("combobox", { name: /^Time/ }).selectOption("30");
  await expect(titles(page)).toHaveText([
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
  ]);
  await expect(page.getByText("Showing 2 of 4.")).toBeVisible();
  await expect(page).toHaveURL(/time=30/);

  // Together with servings: 6 or more leaves nothing that is also quick.
  await panel(page).getByLabel("Serves").selectOption("6");
  await expect(page.getByText("No recipes found.")).toBeVisible();
  await panel(page).getByRole("combobox", { name: /^Time/ }).selectOption("");
  await expect(titles(page)).toHaveText(["Green Chile Stew", "Lemon Olive Oil Cake"]);
  await panel(page).getByLabel("Serves").selectOption("");

  // Two categories at once ("Mexican" and "Vegetarian"), then either of them.
  await page.getByRole("combobox", { name: /^Category/ }).selectOption({ label: "Mexican (2)" });
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema", "Green Chile Stew"]);
  await pickCategory(page, "Also in category", "vegetarian");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
  await panel(page).getByLabel("any of these categories").check();
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema", "Green Chile Stew"]);
  await panel(page).getByLabel("all of these categories").check();

  // Leaving a category out.
  await page.getByRole("combobox", { name: /^Category/ }).selectOption({ label: "All recipes" });
  await expect(page.getByRole("list", { name: "Filters on" })).toBeVisible();
  await page.getByRole("button", { name: /^Remove filter: Also in/ }).click();
  await pickCategory(page, "Not in category", "mexican");
  await expect(titles(page)).toHaveText(["Buttermilk Pancakes", "Lemon Olive Oil Cake"]);
  await page.getByRole("button", { name: /^Remove filter: Not in/ }).click();

  // Ingredients: with and without.
  await panel(page).getByLabel("With ingredient").fill("cumin");
  await panel(page).getByLabel("With ingredient").press("Enter");
  await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  await page.getByRole("button", { name: "Remove filter: With cumin" }).click();
  await panel(page).getByLabel("Without ingredient").fill("cumin");
  await panel(page).getByRole("button", { name: "Add" }).last().click();
  await expect(titles(page)).toHaveText([
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
    "Lemon Olive Oil Cake",
  ]);
  await page.getByRole("button", { name: "Remove filter: Without cumin" }).click();
  await expect(titles(page)).toHaveCount(4);

  // Nutrition, and the source.
  await panel(page).getByLabel("Has nutrition").check();
  await expect(titles(page)).toHaveText(["Buttermilk Pancakes"]);
  await panel(page).getByLabel("Has nutrition").uncheck();
  await panel(page).getByLabel("Source").fill("nana");
  await expect(titles(page)).toHaveText(["Green Chile Stew"]);

  // Last made: nothing has been made yet.
  await panel(page).getByLabel("Source").fill("");
  await panel(page).getByLabel("Last made").selectOption("recent");
  await expect(page.getByText("No recipes found.")).toBeVisible();
  await panel(page).getByLabel("Last made").selectOption("never");
  await expect(titles(page)).toHaveCount(4);
  await panel(page).getByLabel("Last made").selectOption("");

  await noAccessibilityProblems(page);
});

test("Filters are kept in the address, work with search, and can all be cleared", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await openFilters(page);

  await panel(page).getByRole("combobox", { name: /^Time/ }).selectOption("60");
  await panel(page).getByLabel("Without ingredient").fill("cumin");
  await panel(page).getByLabel("Without ingredient").press("Enter");
  await searchList(page, "lemon");
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake", "Buttermilk Pancakes"]);
  await expect(page).toHaveURL(/q=lemon/);
  await expect(page).toHaveURL(/time=60/);
  await expect(page).toHaveURL(/without=cumin/);

  // A reload keeps them, with the panel already open and the chips showing.
  await page.reload();
  await expectListSearch(page, "lemon");
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Filters (2)" })).toBeVisible();
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake", "Buttermilk Pancakes"]);

  // One button puts everything back.
  await page.getByRole("button", { name: "Show all recipes" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
});

test("A recipe with no time written down is left out of a time filter, and the list says so", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  // A new recipe with only a title has no time and no number served.
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Mystery Soup");
  await expect(page.locator("[data-editor-status]")).toHaveText("All changes saved");
  await page.goto("/");
  await expect(recipeCard(page, "Mystery Soup")).toBeVisible();

  await openFilters(page);
  await panel(page).getByRole("combobox", { name: /^Time/ }).selectOption("30");
  await expect(titles(page)).toHaveText([
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
  ]);
  await expect(page.getByText("Not shown: 1 with no time written down.")).toBeVisible();
  await panel(page).getByLabel("Serves").selectOption("4");
  await expect(
    page.getByText("Not shown: 1 with no time written down and 1 with no number served."),
  ).toBeVisible();
});
