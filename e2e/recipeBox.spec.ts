import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  categorySheet,
  dragCategory,
  library,
  libraryRow,
  panelCategories,
  recipeCard,
  syncStatus,
} from "./recipes";
import { useOwnAccount } from "./support";

// U17: the recipe box. On a computer the left panel holds search, the quick lists, saved
// searches and every category with its count, one click each, and categories are put in order
// by dragging. On a phone the Recipes tab has the search box, a row of category buttons and a
// sheet with every category. The four sample recipes are: Green Chile Stew (Mexican, Soups;
// 125 min), Buttermilk Pancakes (Breakfast; 30), Black Bean Tacos with Lime Crema (Mexican,
// Diet › Vegetarian; 30) and Lemon Olive Oil Cake (Desserts › Cakes; 60).

async function addSamples(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  // Adding the samples can be slow when the whole suite is running at once.
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible({ timeout: 15_000 });
  await expect(syncStatus(page)).toHaveText("Saved to cloud", { timeout: 15_000 });
}

/** Marks a recipe as a favorite from its page and comes back to the list. */
async function favorite(page: Page, title: string) {
  await recipeCard(page, title).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await page.getByLabel("A favorite of mine").check({ force: true });
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.goto("/");
}

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const titles = (page: Page) =>
  page.getByRole("region", { name: /^\d+ recipes?$/ }).locator("[id^=card-title-]");
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search recipes" });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** A row's name with its count, as a screen reader says it ("Mexican, 2 recipes"). */
const counted = (name: string, n: number) =>
  new RegExp(`^${name}\\s*,\\s*${n} ${n === 1 ? "recipe" : "recipes"}$`);
const colorOf = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).color);
const top = async (locator: Locator) => (await locator.boundingBox())!.y;

test.describe("On a computer", () => {
  test.skip(({ isMobile }) => isMobile, "The left panel is a computer's");

  test("The left panel: one click to a category, counts that follow the search, switches together, typing to search", async ({
    page,
    context,
    baseURL,
  }) => {
    await useOwnAccount(context, baseURL!);
    await addSamples(page);
    await favorite(page, "Black Bean Tacos with Lime Crema");
    await favorite(page, "Lemon Olive Oil Cake");

    // Search at the top, then the recipe box; Import and Timers just above Account.
    const main = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    const importLink = main.getByRole("link", { name: "Import" });
    const timers = main.getByRole("button", { name: "Timers" });
    const account = main.getByRole("link", { name: "Account" });
    const panel = (await library(page).boundingBox())!;
    expect(await top(searchBox(page))).toBeLessThan(panel.y);
    expect(await top(importLink)).toBeGreaterThanOrEqual(panel.y + panel.height - 1);
    expect(await top(timers)).toBeGreaterThan(await top(importLink));
    expect(await top(account)).toBeGreaterThan(await top(timers));

    // Every category with its count, A to Z to start with; one click shows one.
    await expect(panelCategories(page)).toHaveText([
      "Breakfast",
      "Desserts",
      "Diet",
      "Mexican",
      "Soups",
    ]);
    await expect(libraryRow(page, "Mexican")).toHaveAccessibleName(counted("Mexican", 2));
    await libraryRow(page, "Mexican").click();
    await expect(heading(page)).toHaveText("Mexican");
    await expect(page).toHaveURL(/\?category=Mexican$/);
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema", "Green Chile Stew"]);
    await expect(libraryRow(page, "Mexican")).toHaveAttribute("aria-current", "page");
    // The header's ✕ goes back to every recipe.
    await page.getByRole("button", { name: "Show all categories" }).click();
    await expect(heading(page)).toHaveText("All recipes");
    await expect(titles(page)).toHaveCount(4);

    // Typing on the list goes straight into the search box; the counts follow it, and a
    // category with nothing that matches goes faint but stays.
    await heading(page).click();
    await page.keyboard.type("lime");
    await expect(searchBox(page)).toHaveValue("lime");
    await expect(searchBox(page)).toBeFocused();
    await expect(page).toHaveURL(/\?q=lime$/);
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
    await expect(libraryRow(page, "All recipes")).toHaveAccessibleName(counted("All recipes", 1));
    await expect(libraryRow(page, "Mexican")).toHaveAccessibleName(counted("Mexican", 1));
    await expect(libraryRow(page, "Breakfast")).toHaveAccessibleName(counted("Breakfast", 0));
    await expect(libraryRow(page, "Breakfast")).toBeVisible();
    expect(await colorOf(libraryRow(page, "Breakfast"))).not.toBe(
      await colorOf(libraryRow(page, "Mexican")),
    );

    // Searching in a category says how many more match outside it.
    await libraryRow(page, "Breakfast").click();
    await expect(heading(page)).toHaveText("Breakfast");
    await expect(page.getByText("1 more matches outside Breakfast.")).toBeVisible();
    await page.getByRole("button", { name: "Search all recipes" }).click();
    await expect(heading(page)).toHaveText("All recipes");
    await expect(page).toHaveURL(/\?q=lime$/);
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
    // The search box's ✕ takes the words away (there's no chip for them).
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(searchBox(page)).toHaveValue("");
    await expect(page).toHaveURL(/\/$/);
    await expect(titles(page)).toHaveCount(4);

    // Favorites and 30 minutes or less stay on together, and with a category.
    const favorites = libraryRow(page, "Favorites");
    const quick = libraryRow(page, "30 minutes or less");
    await expect(favorites).toHaveAccessibleName(counted("Favorites", 2));
    await favorites.click();
    await expect(favorites).toHaveAttribute("aria-pressed", "true");
    await expect(titles(page)).toHaveText([
      "Black Bean Tacos with Lime Crema",
      "Lemon Olive Oil Cake",
    ]);
    await quick.click();
    await expect(favorites).toHaveAttribute("aria-pressed", "true");
    await expect(quick).toHaveAttribute("aria-pressed", "true");
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
    await libraryRow(page, "Mexican").click();
    await expect(heading(page)).toHaveText("Mexican");
    await expect(favorites).toHaveAttribute("aria-pressed", "true");
    await expect(quick).toHaveAttribute("aria-pressed", "true");
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
    await expect(page).toHaveURL(/rating=favorite/);
    await expect(page).toHaveURL(/time=30/);
    await noAccessibilityProblems(page);
    await favorites.click();
    await quick.click();
    await expect(titles(page)).toHaveCount(2);

    // Never while typing in a box: letters typed in More filters stay there.
    await page.getByRole("button", { name: "More filters" }).click();
    const filters = page.getByRole("dialog", { name: "Filters" });
    await filters.getByLabel("Without ingredient").fill("");
    await page.keyboard.type("mush");
    await expect(filters.getByLabel("Without ingredient")).toHaveValue("mush");
    await filters.getByRole("button", { name: "Close filters" }).click();
    await expect(filters).toBeHidden();
    await expect(searchBox(page)).toHaveValue("");

    // Only on the recipe list: letters typed on a recipe's page stay there.
    await recipeCard(page, "Green Chile Stew").getByRole("link").click();
    await expect(heading(page)).toHaveText("Green Chile Stew");
    await heading(page).click();
    await page.keyboard.type("x");
    await expect(searchBox(page)).toHaveValue("");
    await expect(page).toHaveURL(/\/recipes\//);

    // "/" moves to the search box from any page.
    await page.goto("/settings");
    await expect(heading(page)).toHaveText("Settings");
    await page.keyboard.press("/");
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.type("cumin");
    await expect(page).toHaveURL(/\?q=cumin$/);
    await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  });

  test("Categories put in order by dragging: between two, inside one, out again, never into itself, with Undo", async ({
    page,
    context,
    baseURL,
  }) => {
    await useOwnAccount(context, baseURL!);
    // Tall enough that no row is at the panel's bottom edge, where holding scrolls the list.
    await page.setViewportSize({ width: 1280, height: 900 });
    await addSamples(page);
    await expect(panelCategories(page)).toHaveText([
      "Breakfast",
      "Desserts",
      "Diet",
      "Mexican",
      "Soups",
    ]);
    const moved = library(page).getByRole("status");

    // Between two moves it there; the hint says how the first times.
    await dragCategory(page, "Soups", "Breakfast", "top");
    await expect(library(page).getByText("puts it inside.")).toBeVisible();
    await page.mouse.up();
    await expect(moved).toHaveText("Moved Soups before Breakfast.");
    await expect(panelCategories(page)).toHaveText([
      "Soups",
      "Breakfast",
      "Desserts",
      "Diet",
      "Mexican",
    ]);
    await expect(heading(page)).toHaveText("All recipes");

    // Onto one puts it inside, with its recipes, and opens it to show where it went.
    await dragCategory(page, "Mexican", "Diet", "middle");
    await page.mouse.up();
    await expect(moved).toHaveText("Moved Mexican into Diet.");
    await expect(panelCategories(page)).toHaveText([
      "Soups",
      "Breakfast",
      "Desserts",
      "Diet",
      "Mexican",
      "Vegetarian",
    ]);
    await expect(libraryRow(page, "Diet")).toHaveAccessibleName(counted("Diet", 2));

    // And out again, to the top level.
    await dragCategory(page, "Mexican", "Soups", "top");
    await page.mouse.up();
    await expect(moved).toHaveText("Moved Mexican to the top level.");
    await expect(panelCategories(page)).toHaveText([
      "Mexican",
      "Soups",
      "Breakfast",
      "Desserts",
      "Diet",
      "Vegetarian",
    ]);

    // Never into itself or its own subcategories: refused, and nothing changes.
    await dragCategory(page, "Diet", "Vegetarian", "middle");
    await expect(page.getByText("Can’t go inside itself")).toBeVisible();
    await page.mouse.up();
    await expect(moved).toHaveText("Moved Mexican to the top level.");
    await expect(panelCategories(page)).toHaveText([
      "Mexican",
      "Soups",
      "Breakfast",
      "Desserts",
      "Diet",
      "Vegetarian",
    ]);

    // Undo puts the last move back.
    await library(page).getByRole("button", { name: "Undo" }).click();
    await expect(panelCategories(page)).toHaveText([
      "Soups",
      "Breakfast",
      "Desserts",
      "Diet",
      "Mexican",
      "Vegetarian",
    ]);
    await noAccessibilityProblems(page);

    // Kept with the account.
    await expect(syncStatus(page)).toHaveText("Saved to cloud");
    await page.reload();
    await expect(panelCategories(page)).toHaveText([
      "Soups",
      "Breakfast",
      "Desserts",
      "Diet",
      "Mexican",
      "Vegetarian",
    ]);
  });
});

test.describe("On a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "The row and sheet are a phone's");

  test("Search at the top of the list, a row of categories, All categories and a row of subcategories", async ({
    page,
    context,
    baseURL,
  }) => {
    await useOwnAccount(context, baseURL!);
    await addSamples(page);

    // No left panel; the search box is on the list, not in the top bar; Timers stays up there
    // and Import is a tab.
    await expect(library(page)).toBeHidden();
    const topBar = page.getByRole("banner");
    await expect(topBar.getByRole("button", { name: "Timers" })).toBeVisible();
    await expect(topBar.getByRole("link", { name: /search/i })).toHaveCount(0);
    await expect(topBar.getByRole("button", { name: /search/i })).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "Main" })
        .filter({ visible: true })
        .getByRole("link", { name: "Import" }),
    ).toBeVisible();
    await expect(searchBox(page)).toHaveAttribute("placeholder", "Search 4 recipes");

    // The row of categories, in the person's order (A to Z to start), then All categories.
    const row = page.getByRole("navigation", { name: "Categories" });
    await expect(row.getByRole("list").first().getByRole("link")).toHaveText([
      /^Breakfast/,
      /^Desserts/,
      /^Diet/,
      /^Mexican/,
      /^Soups/,
    ]);
    await row.getByRole("link", { name: /^Mexican/ }).click();
    await expect(heading(page)).toHaveText("Mexican");
    await expect(titles(page)).toHaveCount(2);
    await expect(searchBox(page)).toHaveAttribute("placeholder", "Search in Mexican");

    // A category with subcategories shows them in a second row.
    await row.getByRole("link", { name: /^Desserts/ }).click();
    await expect(heading(page)).toHaveText("Desserts");
    const subs = page.getByRole("list", { name: "In Desserts:" });
    await subs.getByRole("link", { name: /^Cakes/ }).click();
    await expect(heading(page)).toHaveText("Cakes");
    await expect(titles(page)).toHaveText(["Lemon Olive Oil Cake"]);
    await expect(subs.getByRole("link", { name: /^Cakes/ })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // All categories: every one in a sheet, inside ones shown on request.
    await page.getByRole("button", { name: "All categories", exact: true }).click();
    const sheet = categorySheet(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: /^Cakes/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await sheet.getByRole("button", { name: "Show what's in Diet" }).click();
    await noAccessibilityProblems(page);
    await sheet.getByRole("link", { name: /^Vegetarian/ }).click();
    await expect(sheet).toBeHidden();
    await expect(heading(page)).toHaveText("Vegetarian");
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);

    // The counts follow the search; a category with no match goes faint, still there.
    await row.getByRole("link", { name: /^Breakfast/ }).click();
    await searchBox(page).fill("lime");
    await expect(page.getByText("1 more matches outside Breakfast.")).toBeVisible();
    const breakfast = row.getByRole("link", { name: /^Breakfast/ });
    const mexican = row.getByRole("link", { name: /^Mexican/ });
    await expect(breakfast).toHaveAccessibleName(counted("Breakfast", 0));
    await expect(mexican).toHaveAccessibleName(counted("Mexican", 1));
    expect(await colorOf(breakfast)).not.toBe(await colorOf(mexican));
    await page.getByRole("button", { name: "Search all recipes" }).click();
    await expect(heading(page)).toHaveText("All recipes");
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
    await noAccessibilityProblems(page);

    // "/" (a phone-sized window with a keyboard) opens the list's search box from another page.
    await page.goto("/settings");
    await expect(heading(page)).toHaveText("Settings");
    await page.keyboard.press("/");
    await expect(searchBox(page)).toBeFocused();
  });
});
