import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  categorySheet,
  dragCategory,
  library,
  libraryRow,
  openFilters,
  panelCategories,
  recipeCard,
  syncStatus,
} from "./recipes";
import { useOwnAccount } from "./support";

// U17: the recipe box. On a computer the left panel holds search, the quick searches (U18: tick
// lines and saved searches, chosen and ordered by the person, kept with the account) and every
// category with its count, one click each, and categories are put in order by dragging. On a
// phone the Recipes tab has the search box, a row of category buttons and a sheet with every
// category (the quick searches are at the top of the Filters sheet). The four sample recipes are:
// Green Chile Stew (Mexican, Soups; 125 min), Buttermilk Pancakes (Breakfast; 30), Black Bean
// Tacos with Lime Crema (Mexican, Diet › Vegetarian; 30) and Lemon Olive Oil Cake (Desserts ›
// Cakes; 60).

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
/** The left panel's quick searches, top to bottom, by name (U18). */
const quickLines = (page: Page) =>
  library(page).locator("[data-quick-key] [data-quick-part=main] [class*=name]");

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
    // "All recipes" always counts every recipe, since it starts fresh (owner's choice 2026-11-05).
    await expect(libraryRow(page, "All recipes")).toHaveAccessibleName(counted("All recipes", 4));
    await expect(libraryRow(page, "All recipes")).not.toHaveAttribute("aria-current", "page");
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

    // "All recipes" starts fresh: the words, the filters and the category all go.
    await page.goto("/?q=lime&category=Mexican&time=30&rating=favorite");
    await expect(heading(page)).toHaveText("Mexican");
    await libraryRow(page, "All recipes").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(heading(page)).toHaveText("All recipes");
    await expect(searchBox(page)).toHaveValue("");
    await expect(titles(page)).toHaveCount(4);
    await expect(libraryRow(page, "All recipes")).toHaveAttribute("aria-current", "page");
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

  test("Quick searches: the starting two, a time chosen with ▾, + Add, ✕, put in order, and added from Filters, kept with the account", async ({
    page,
    context,
    baseURL,
  }) => {
    await useOwnAccount(context, baseURL!);
    await addSamples(page);

    // A new account starts with Favorites and 30 minutes or less, under the heading.
    await expect(library(page).getByRole("heading", { name: "Quick searches" })).toBeVisible();
    await expect(quickLines(page)).toHaveText(["Favorites", "30 minutes or less"]);

    // A tick line stays on with a category.
    await libraryRow(page, "30 minutes or less").click();
    await expect(titles(page)).toHaveCount(2);
    await libraryRow(page, "Mexican").click();
    await expect(heading(page)).toHaveText("Mexican");
    await expect(libraryRow(page, "30 minutes or less")).toHaveAttribute("aria-pressed", "true");
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);

    // ▾ changes the time, the line's and the list's; the choice is kept with the account.
    await library(page).getByRole("button", { name: "Change 30 minutes or less" }).click();
    const choices = page.getByRole("menu", { name: "Choices for 30 minutes or less" });
    await expect(
      choices.getByRole("menuitemradio", { name: "30 minutes or less" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(choices.getByRole("menuitemradio", { name: "30 minutes or less" })).toBeFocused();
    await choices.getByRole("menuitemradio", { name: "2 hours or less" }).click();
    await expect(choices).toBeHidden();
    await expect(quickLines(page)).toHaveText(["Favorites", "2 hours or less"]);
    await expect(libraryRow(page, "2 hours or less")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/time=120/);
    await page.getByRole("button", { name: "Show all categories" }).click();
    await expect(titles(page)).toHaveCount(3);
    await library(page).getByRole("button", { name: "Change 2 hours or less" }).click();
    await page
      .getByRole("menu", { name: "Choices for 2 hours or less" })
      .getByRole("menuitemradio", { name: "45 minutes or less" })
      .click();
    await expect(quickLines(page)).toHaveText(["Favorites", "45 minutes or less"]);
    await expect(titles(page)).toHaveCount(2);
    await expect(page).toHaveURL(/time=45/);
    await page.goto("/");
    await expect(quickLines(page)).toHaveText(["Favorites", "45 minutes or less"]);
    await expect(libraryRow(page, "45 minutes or less")).toHaveAttribute("aria-pressed", "false");
    await expect(libraryRow(page, "45 minutes or less")).toHaveAccessibleName(
      counted("45 minutes or less", 2),
    );

    // + Add: the common ones, ticked when there; ticking adds at the end, unticking removes.
    const add = library(page).getByRole("button", { name: "Add a quick search" });
    await add.click();
    const menu = page.getByRole("menu", { name: "Add a quick search" });
    // Any time line counts as "30 minutes or less" being there.
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "30 minutes or less" }),
    ).toHaveAttribute("aria-checked", "true");
    const madeLately = menu.getByRole("menuitemcheckbox", { name: "Made lately" });
    await expect(madeLately).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Anything in Filters can be added too")).toBeVisible();
    await noAccessibilityProblems(page);
    await madeLately.click();
    await expect(madeLately).toHaveAttribute("aria-checked", "true");
    await expect(quickLines(page)).toHaveText(["Favorites", "45 minutes or less", "Made lately"]);
    await madeLately.click();
    await expect(quickLines(page)).toHaveText(["Favorites", "45 minutes or less"]);
    await menu.getByRole("menuitemcheckbox", { name: "Has a photo" }).click();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(add).toBeFocused();
    await expect(quickLines(page)).toHaveText(["Favorites", "45 minutes or less", "Has a photo"]);

    // Alt and the arrows put a line in order, said aloud; kept with the account.
    await libraryRow(page, "Favorites").focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(quickLines(page)).toHaveText(["45 minutes or less", "Favorites", "Has a photo"]);
    await expect(libraryRow(page, "Favorites")).toBeFocused();
    await expect(library(page).getByText("Moved Favorites down.")).toBeAttached();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(quickLines(page)).toHaveText(["45 minutes or less", "Has a photo", "Favorites"]);
    await page.reload();
    await expect(quickLines(page)).toHaveText(["45 minutes or less", "Has a photo", "Favorites"]);

    // ✕, shown where the count was while the line is pointed at, removes it at once.
    await libraryRow(page, "Has a photo").hover();
    await library(page)
      .getByRole("button", { name: "Remove Has a photo from quick searches" })
      .click();
    await expect(quickLines(page)).toHaveText(["45 minutes or less", "Favorites"]);
    // The focus goes on to the next line.
    await expect(libraryRow(page, "Favorites")).toBeFocused();

    // Filters: a filter that is set has a button to add it, saying when it's there.
    const filters = await openFilters(page);
    const time = filters.getByRole("group", { name: "Total time, up to" });
    await expect(time.getByRole("button", { name: /quick searches/ })).toHaveCount(0);
    await time.getByRole("button", { name: "1 hr", exact: true }).click();
    const addTime = time.getByRole("button", { name: /quick searches: 1 hour or less$/ });
    await expect(addTime).toHaveText(/^\+?Add to quick searches$/);
    await expect(addTime).toHaveAttribute("aria-pressed", "false");
    await addTime.click();
    await expect(addTime).toHaveText(/^In quick searches$/);
    await expect(addTime).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(filters).toBeHidden();
    await expect(quickLines(page)).toHaveText([
      "45 minutes or less",
      "Favorites",
      "1 hour or less",
    ]);
    await expect(libraryRow(page, "1 hour or less")).toHaveAttribute("aria-pressed", "true");

    // Save as quick search adds a search line; its ✕ deletes the saved search.
    await page.getByRole("button", { name: "Save as quick search" }).click();
    const saved = page.getByRole("region", { name: "Saved searches" });
    await saved.getByLabel("Name this search").fill("Under an hour");
    await saved.getByRole("button", { name: "Save", exact: true }).click();
    await expect(quickLines(page)).toHaveText([
      "45 minutes or less",
      "Favorites",
      "1 hour or less",
      "Under an hour",
    ]);
    await libraryRow(page, "Under an hour").hover();
    await library(page)
      .getByRole("button", { name: "Delete the saved search Under an hour" })
      .click();
    await expect(quickLines(page)).toHaveText([
      "45 minutes or less",
      "Favorites",
      "1 hour or less",
    ]);
    await page.reload();
    await expect(quickLines(page)).toHaveText([
      "45 minutes or less",
      "Favorites",
      "1 hour or less",
    ]);
  });

  test("Categories put in order by dragging: between two, inside one, out again, never into itself", async ({
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

    // Between two moves it there (no hint, message or Undo since U18).
    await dragCategory(page, "Soups", "Breakfast", "top");
    await page.mouse.up();
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
    await expect(panelCategories(page)).toHaveText([
      "Mexican",
      "Soups",
      "Breakfast",
      "Desserts",
      "Diet",
      "Vegetarian",
    ]);

    // Never into itself or its own subcategories: the cursor says no, and nothing changes.
    await dragCategory(page, "Diet", "Vegetarian", "middle");
    await expect(page.locator("html")).toHaveAttribute("data-category-drag", "refused");
    await expect(page.getByText("Can’t go inside itself")).toHaveCount(0);
    await page.mouse.up();
    await expect(panelCategories(page)).toHaveText([
      "Mexican",
      "Soups",
      "Breakfast",
      "Desserts",
      "Diet",
      "Vegetarian",
    ]);

    // Escape puts a drag back: nothing moves, and letting go doesn't open the category.
    await dragCategory(page, "Soups", "Desserts", "middle");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-drag-lifted]")).toHaveCount(0);
    await page.mouse.move(640, 300, { steps: 3 });
    await expect(page.locator("[data-drag-lifted]")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-category-drag");
    await page.mouse.up();
    await expect(heading(page)).toHaveText("All recipes");

    // A move is taken back by dragging it back; there's no Undo after a drag.
    await expect(library(page).getByRole("button", { name: "Undo" })).toHaveCount(0);
    await dragCategory(page, "Mexican", "Diet", "bottom");
    await page.mouse.up();
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

    // A category moves with its subcategories, and stays open where it lands.
    await dragCategory(page, "Diet", "Soups", "top");
    await page.mouse.up();
    await expect(panelCategories(page)).toHaveText([
      "Diet",
      "Mexican",
      "Vegetarian",
      "Soups",
      "Breakfast",
      "Desserts",
    ]);

    // At the end of a list of subcategories, moved a step right it goes last inside; not
    // moved sideways, it stays at its own level.
    await dragCategory(page, "Desserts", "Vegetarian", "bottom", 20);
    await page.mouse.up();
    await expect(panelCategories(page)).toHaveText([
      "Diet",
      "Mexican",
      "Vegetarian",
      "Desserts",
      "Soups",
      "Breakfast",
    ]);
    await dragCategory(page, "Breakfast", "Desserts", "bottom");
    await page.mouse.up();
    await expect(panelCategories(page).nth(3)).toHaveText("Desserts");
    await expect(panelCategories(page).nth(4)).toHaveText("Breakfast");

    // Moving the category shown, or the one it's in, takes the list along to its new place, and
    // back again. An open category keeps its subcategories showing where it lands.
    const category = () => new URL(page.url()).searchParams.get("category");
    await libraryRow(page, "Vegetarian").click();
    await expect(heading(page)).toHaveText("Vegetarian");
    await dragCategory(page, "Diet", "Breakfast", "middle");
    await page.mouse.up();
    await expect(panelCategories(page)).toHaveText([
      "Breakfast",
      "Diet",
      "Mexican",
      "Vegetarian",
      "Desserts",
      "Soups",
    ]);
    await expect.poll(category).toBe("Breakfast › Diet › Vegetarian");
    await expect(heading(page)).toHaveText("Vegetarian");
    await expect(libraryRow(page, "Vegetarian")).toHaveAttribute("aria-current", "page");
    await dragCategory(page, "Diet", "Breakfast", "top");
    await page.mouse.up();
    await expect.poll(category).toBe("Diet › Vegetarian");
    await expect(heading(page)).toHaveText("Vegetarian");

    await libraryRow(page, "Soups").click();
    await expect(heading(page)).toHaveText("Soups");
    await dragCategory(page, "Soups", "Desserts", "middle");
    await page.mouse.up();
    await expect.poll(category).toBe("Diet › Desserts › Soups");
    await expect(heading(page)).toHaveText("Soups");
    await expect(titles(page)).toHaveText(["Green Chile Stew"]);
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
    await page.getByRole("button", { name: "Search all recipes" }).click();
    await expect(heading(page)).toHaveText("All recipes");
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
    // Neither picked now: the one with no match is fainter, its count too.
    const countIn = (link: Locator) => link.locator("span[aria-hidden]");
    expect(await colorOf(breakfast)).not.toBe(await colorOf(mexican));
    expect(await colorOf(countIn(breakfast))).toBe(await colorOf(breakfast));
    await noAccessibilityProblems(page);

    // In the sheet too, with every row the same width.
    await page.getByRole("button", { name: "All categories", exact: true }).click();
    const sheetBreakfast = sheet.getByRole("link", { name: /^Breakfast/ });
    const sheetMexican = sheet.getByRole("link", { name: /^Mexican/ });
    expect(await colorOf(sheetBreakfast)).not.toBe(await colorOf(sheetMexican));
    const widths = await sheet
      .getByRole("list")
      .first()
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().right)));
    expect(new Set(widths).size).toBe(1);
    await sheet.getByRole("button", { name: "Done" }).click();

    // The picked button's count is in the button's own colour, never grey on its blue.
    await mexican.click();
    await expect(mexican).toHaveAttribute("aria-current", "page");
    expect(await colorOf(countIn(mexican))).toBe(await colorOf(mexican));

    // "/" (a phone-sized window with a keyboard) opens the list's search box from another page.
    await page.goto("/settings");
    await expect(heading(page)).toHaveText("Settings");
    await page.keyboard.press("/");
    await expect(searchBox(page)).toBeFocused();
  });

  test("Quick searches at the top of the Filters sheet: on and off, ▾, + Add, and Edit with ✕", async ({
    page,
    context,
    baseURL,
  }) => {
    await useOwnAccount(context, baseURL!);
    await addSamples(page);

    const sheet = await openFilters(page);
    const quick = sheet.getByRole("group", { name: "Quick searches" });
    const chip = (name: string) => quick.getByRole("button", { name, exact: true });
    // First in the sheet, starting with Favorites and 30 minutes or less.
    expect(await top(quick)).toBeLessThan(
      await top(sheet.getByRole("group", { name: "Total time, up to" })),
    );
    await expect(chip("Favorites")).toHaveAttribute("aria-pressed", "false");
    await chip("30 minutes or less").click();
    await expect(chip("30 minutes or less")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/time=30/);

    // ▾ beside a chip changes its choice, and the list's while it's on.
    await quick.getByRole("button", { name: "Change 30 minutes or less" }).click();
    await quick
      .getByRole("menu", { name: "Choices for 30 minutes or less" })
      .getByRole("menuitemradio", { name: "1 hour or less" })
      .click();
    await expect(chip("1 hour or less")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/time=60/);

    // + Add opens the same menu in place; Escape closes it and leaves the sheet open.
    await quick.getByRole("button", { name: "Add a quick search" }).click();
    const menu = quick.getByRole("menu", { name: "Add a quick search" });
    await menu.getByRole("menuitemcheckbox", { name: "Made lately" }).click();
    await expect(chip("Made lately")).toBeVisible();
    // Opened from a chip near the edge, it stays inside the sheet, never scrolling it sideways.
    const scrolledSideways = () =>
      sheet.evaluate((el) => [el, ...el.querySelectorAll("*")].some((e) => e.scrollLeft > 0));
    expect(await scrolledSideways()).toBe(false);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(sheet).toBeVisible();
    await noAccessibilityProblems(page);

    // Edit shows a ✕ on each; one tap removes it at once. Done goes back.
    await quick.getByRole("button", { name: "Edit quick searches" }).click();
    await quick.getByRole("button", { name: "Remove Favorites from quick searches" }).click();
    await expect(quick.getByText("Favorites", { exact: true })).toHaveCount(0);
    await quick.getByRole("button", { name: "Done editing quick searches" }).click();
    await expect(quick.getByRole("button", { name: /^(1 hour or less|Made lately)$/ })).toHaveText([
      "1 hour or less",
      "Made lately",
    ]);

    // Kept with the account.
    await page.reload();
    const again = await openFilters(page);
    await expect(
      again
        .getByRole("group", { name: "Quick searches" })
        .getByRole("button", { name: /^(Favorites|1 hour or less|Made lately)$/ }),
    ).toHaveText(["1 hour or less", "Made lately"]);
  });
});
