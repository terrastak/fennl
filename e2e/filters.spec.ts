import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  categorySheet,
  clearFilters,
  filtersButton,
  library,
  openFilters,
  recipeCard,
  showCategory,
  syncStatus,
  toggleQuick,
} from "./recipes";
import { useOwnAccount } from "./support";

// Phase C13a: more filters on the recipe list (a Filters panel since U13). The four sample recipes are:
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

const panel = (page: Page) => page.getByRole("dialog", { name: "Filters" });

/** Presses one of the panel's choices, such as "30 min" under "Total time, up to". */
async function choose(page: Page, group: string, choice: string) {
  const button = panel(page)
    .getByRole("group", { name: group })
    .getByRole("button", { name: choice, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

/** Closes the panel with its own button, which says how many recipes are left. */
async function showRecipes(page: Page, count: number) {
  await panel(page)
    .getByRole("button", { name: `Show ${count} ${count === 1 ? "recipe" : "recipes"}` })
    .click();
  await expect(panel(page)).toBeHidden();
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
  await noAccessibilityProblems(page);

  // Time: up to 30 minutes. The list behind follows at once; the button says how many.
  await choose(page, "Total time, up to", "30 min");
  await expect(panel(page).getByRole("button", { name: "Show 2 recipes" })).toBeVisible();
  await expect(page).toHaveURL(/time=30/);

  // Together with servings: 6 or more leaves nothing that is also quick.
  await choose(page, "Serves at least", "6");
  await expect(panel(page).getByRole("button", { name: "Show 0 recipes" })).toBeVisible();
  await choose(page, "Total time, up to", "Any");
  await showRecipes(page, 2);
  await expect(titles(page)).toHaveText(["Green Chile Stew", "Lemon Olive Oil Cake"]);
  await expect(filtersButton(page, 1)).toBeVisible();
  await expect(page.getByText("2 recipes · Serves 6 or more")).toBeVisible();
  await clearFilters(page);
  await expect(titles(page)).toHaveCount(4);

  // Two categories at once ("Mexican" and "Vegetarian"), then either of them.
  await showCategory(page, "Mexican");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema", "Green Chile Stew"]);
  await openFilters(page);
  await pickCategory(page, "Also in category", "vegetarian");
  await expect(panel(page).getByRole("button", { name: "Show 1 recipe" })).toBeVisible();
  await panel(page).getByLabel("any of these categories").check();
  await showRecipes(page, 2);
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema", "Green Chile Stew"]);

  // Leaving a category out. Showing all categories again leaves "or in" too.
  await page.getByRole("button", { name: "Show all categories" }).click();
  await expect(titles(page)).toHaveCount(4);
  await openFilters(page);
  await pickCategory(page, "Not in category", "mexican");
  await showRecipes(page, 2);
  await expect(titles(page)).toHaveText(["Buttermilk Pancakes", "Lemon Olive Oil Cake"]);
  await clearFilters(page);

  // Ingredients: with and without.
  await openFilters(page);
  await panel(page).getByLabel("With ingredient").fill("cumin");
  await panel(page).getByLabel("With ingredient").press("Enter");
  await expect(panel(page).getByRole("button", { name: "Show 1 recipe" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Remove cumin" }).click();
  await panel(page).getByLabel("Without ingredient").fill("cumin");
  await panel(page).getByRole("button", { name: "Add", exact: true }).last().click();
  await showRecipes(page, 3);
  await expect(titles(page)).toHaveText([
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
    "Lemon Olive Oil Cake",
  ]);
  await clearFilters(page);
  await expect(titles(page)).toHaveCount(4);

  // Nutrition, and the source.
  await openFilters(page);
  await panel(page).getByRole("checkbox", { name: "Has nutrition" }).check();
  await expect(panel(page).getByRole("button", { name: "Show 1 recipe" })).toBeVisible();
  await panel(page).getByRole("checkbox", { name: "Has nutrition" }).uncheck();
  await panel(page).getByLabel("Source").fill("nana");
  await expect(panel(page).getByRole("button", { name: "Show 1 recipe" })).toBeVisible();

  // Last made: nothing has been made yet.
  await panel(page).getByLabel("Source").fill("");
  await choose(page, "Last made", "Made in the last 30 days");
  await expect(panel(page).getByRole("button", { name: "Show 0 recipes" })).toBeVisible();
  await choose(page, "Last made", "Never made");
  await expect(panel(page).getByRole("button", { name: "Show 4 recipes" })).toBeVisible();

  // Clear filters, and Escape closes the panel.
  await panel(page).getByRole("button", { name: "Clear filters" }).click();
  await expect(
    panel(page).getByRole("group", { name: "Last made" }).getByRole("button", { name: "Any time" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(filtersButton(page)).toBeVisible();
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

  await choose(page, "Total time, up to", "1 hr");
  await panel(page).getByLabel("Without ingredient").fill("cumin");
  await panel(page).getByLabel("Without ingredient").press("Enter");
  await showRecipes(page, 3);
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("lemon");
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake", "Buttermilk Pancakes"]);
  await expect(page).toHaveURL(/q=lemon/);
  await expect(page).toHaveURL(/time=60/);
  await expect(page).toHaveURL(/without=cumin/);

  // A reload keeps them, Filters counting them and the header saying them.
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveValue("lemon");
  await expect(filtersButton(page, 2)).toBeVisible();
  await expect(
    page.getByText("2 recipes · matching “lemon” · 1 hour or less · Without cumin"),
  ).toBeVisible();
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake", "Buttermilk Pancakes"]);

  // The panel's Clear filters and the search box's ✕ put everything back.
  await clearFilters(page);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveValue("");
  await expect(filtersButton(page)).toBeVisible();
});

test("A recipe with no time written down is left out of a time filter, with no extra note", async ({
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

  // 30 minutes or less.
  await toggleQuick(page);
  await expect(titles(page)).toHaveText([
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
  ]);
  // The line is the count and the filters only (U21): no note of the recipes left out.
  await expect(page.getByText("2 recipes · 30 minutes or less", { exact: true })).toBeVisible();
  await expect(page.getByText(/Not shown/)).toHaveCount(0);
  await openFilters(page);
  await choose(page, "Serves at least", "4");
  await showRecipes(page, 2);
  await expect(page.getByText(/Not shown/)).toHaveCount(0);
});

test("The ⋯ menu opens and closes, and the list's top fits the screen", async ({
  page,
  context,
  baseURL,
  isMobile,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  // Nothing wider than the screen.
  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
  expect(await fits()).toBe(true);

  const more = page.getByRole("button", { name: "More actions" });
  const menu = page.getByRole("list", { name: "More actions" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  // What acts on the recipes shown, under how many, then Find duplicates (U21); Categories went,
  // and Trash is here only on a phone (a computer has it in the left panel).
  await expect(page.getByText("These 4 recipes", { exact: true })).toBeVisible();
  await expect(menu.getByRole("button")).toHaveCount(3);
  for (const name of ["Select recipes…", "Print these", "Surprise me"]) {
    await expect(menu.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  // Print these says how many it would print.
  await expect(menu.getByRole("button", { name: "Print these", exact: true })).toContainText("4");
  await expect(menu.getByRole("link")).toHaveText(
    isMobile ? ["Find duplicates", "Trash"] : ["Find duplicates"],
  );
  await expect(menu.getByRole("link", { name: "Categories" })).toHaveCount(0);
  await noAccessibilityProblems(page);
  // Escape closes it and goes back to the button; so does a tap elsewhere.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("heading", { level: 1, name: "All recipes" }).click();
  await expect(menu).toHaveCount(0);

  // With filters on, it still fits.
  await toggleQuick(page);
  await openFilters(page);
  await choose(page, "Serves at least", "4");
  await showRecipes(page, 2);
  await expect(page.getByText("2 recipes · 30 minutes or less · Serves 4 or more")).toBeVisible();
  expect(await fits()).toBe(true);
});

test("On a phone: search with Filters, a row of categories, their subcategories and the sheet of every category", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  // A computer has the left panel instead (U17).
  test.skip(await library(page).isVisible(), "Phone layout only");

  const search = page.getByRole("searchbox", { name: "Search recipes" });
  const row = page.getByRole("navigation", { name: "Categories" });
  const heading = page.getByRole("heading", { level: 1 });
  await expect(search).toHaveAttribute("placeholder", "Search 4 recipes");
  // The search icon left the top bar: the Recipes tab is where to search.
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(0);

  // One tap on a category; what's inside it shows in a second row.
  await row.getByRole("link", { name: /^Desserts\s*, 1 recipe$/ }).click();
  await expect(heading).toHaveText("Desserts");
  await expect(search).toHaveAttribute("placeholder", "Search in Desserts");
  await expect(row.getByRole("link", { name: /^Desserts/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await row
    .getByRole("list", { name: "In Desserts:" })
    .getByRole("link", { name: /^Cakes/ })
    .click();
  await expect(heading).toHaveText("Cakes");
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake"]);

  // Every category in a sheet: the one shown checked; one tap each.
  await page.getByRole("button", { name: "All categories", exact: true }).click();
  const sheet = categorySheet(page);
  await expect(sheet.getByRole("link", { name: /^Cakes/ })).toHaveAttribute("aria-current", "page");
  await sheet.getByRole("button", { name: "Show what's in Diet" }).click();
  await expect(sheet.getByRole("button", { name: "Hide what's in Diet" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await noAccessibilityProblems(page);
  await sheet.getByRole("link", { name: /^Vegetarian\s*, 1 recipe$/ }).click();
  await expect(sheet).toBeHidden();
  await expect(heading).toHaveText("Vegetarian");
  await page.getByRole("button", { name: "All categories", exact: true }).click();
  await sheet.getByRole("link", { name: /^All recipes/ }).click();
  await expect(heading).toHaveText("All recipes");
  await expect(page).toHaveURL(/\/$/);
  await expect(titles(page)).toHaveCount(4);

  // The quick searches are in Filters, and stay on with the category shown.
  await showCategory(page, "Mexican");
  await openFilters(page);
  const quick = panel(page).getByRole("group", { name: "Quick searches" });
  await quick.getByRole("button", { name: "30 minutes or less", exact: true }).click();
  await expect(
    quick.getByRole("button", { name: "30 minutes or less", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await showRecipes(page, 1);
  await expect(heading).toHaveText("Mexican");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
  await expect(filtersButton(page, 1)).toBeVisible();

  // Nothing wider than the screen.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await noAccessibilityProblems(page);
});
