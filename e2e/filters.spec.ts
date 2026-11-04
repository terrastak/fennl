import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openFilters, recipeCard, syncStatus } from "./recipes";
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
  await expect(page.getByRole("button", { name: "Filters 1 on" })).toBeVisible();
  await page.getByRole("button", { name: "Remove filter: Serves 6 or more" }).click();
  await expect(titles(page)).toHaveCount(4);

  // Two categories at once ("Mexican" and "Vegetarian"), then either of them.
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption({
    label: "Mexican (2)",
  });
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema", "Green Chile Stew"]);
  await openFilters(page);
  await pickCategory(page, "Also in category", "vegetarian");
  await expect(panel(page).getByRole("button", { name: "Show 1 recipe" })).toBeVisible();
  await panel(page).getByLabel("any of these categories").check();
  await showRecipes(page, 2);
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema", "Green Chile Stew"]);

  // Leaving a category out.
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption({ label: "Category" });
  await expect(page.getByRole("list", { name: "Filters on" })).toBeVisible();
  await page.getByRole("button", { name: /^Remove filter: Or in/ }).click();
  await openFilters(page);
  await pickCategory(page, "Not in category", "mexican");
  await showRecipes(page, 2);
  await expect(titles(page)).toHaveText(["Buttermilk Pancakes", "Lemon Olive Oil Cake"]);
  await page.getByRole("button", { name: /^Remove filter: Not in/ }).click();

  // Ingredients: with and without.
  await openFilters(page);
  await panel(page).getByLabel("With ingredient").fill("cumin");
  await panel(page).getByLabel("With ingredient").press("Enter");
  await expect(panel(page).getByRole("button", { name: "Show 1 recipe" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Remove cumin" }).click();
  await panel(page).getByLabel("Without ingredient").fill("cumin");
  await panel(page).getByRole("button", { name: "Add" }).last().click();
  await showRecipes(page, 3);
  await expect(titles(page)).toHaveText([
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
    "Lemon Olive Oil Cake",
  ]);
  await page.getByRole("button", { name: "Remove filter: Without cumin" }).click();
  await expect(titles(page)).toHaveCount(4);

  // Nutrition, and the source.
  await openFilters(page);
  await panel(page).getByLabel("Has nutrition").check();
  await expect(panel(page).getByRole("button", { name: "Show 1 recipe" })).toBeVisible();
  await panel(page).getByLabel("Has nutrition").uncheck();
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
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
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

  // A reload keeps them, the Filters button counting them and the chips showing.
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveValue("lemon");
  await expect(page.getByRole("button", { name: "Filters 2 on" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Time" })).toHaveValue("60");
  await expect(page.getByRole("button", { name: "Remove filter: Without cumin" })).toBeVisible();
  await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake", "Buttermilk Pancakes"]);

  // One button puts everything back.
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveValue("");
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

  // The quick Time filter.
  await page.getByRole("combobox", { name: "Time" }).selectOption({ label: "Up to 30 min" });
  await expect(titles(page)).toHaveText([
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
  ]);
  await expect(page.getByText("Not shown: 1 with no time written down.")).toBeVisible();
  await openFilters(page);
  await choose(page, "Serves at least", "4");
  await showRecipes(page, 2);
  await expect(
    page.getByText("Not shown: 1 with no time written down and 1 with no number served."),
  ).toBeVisible();
});

test("The ⋯ menu opens and closes, and the list's top fits the screen", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  // Nothing wider than the screen, however many quick filters there are.
  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
  expect(await fits()).toBe(true);

  const more = page.getByRole("button", { name: "More actions" });
  const menu = page.getByRole("list", { name: "More actions" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("link")).toHaveText(["Categories", "Find duplicates", "Trash"]);
  await noAccessibilityProblems(page);
  // Escape closes it and goes back to the button; so does a tap elsewhere.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("heading", { level: 1, name: "Your recipes" }).click();
  await expect(menu).toHaveCount(0);

  // With filters on, it still fits.
  await page.getByRole("combobox", { name: "Time", exact: true }).selectOption("30");
  await openFilters(page);
  await choose(page, "Serves at least", "4");
  await showRecipes(page, 2);
  await expect(page.getByRole("list", { name: "Filters on" })).toBeVisible();
  expect(await fits()).toBe(true);
});
