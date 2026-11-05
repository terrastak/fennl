import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  editorStatus,
  fromListMenu,
  library,
  recipeCard,
  syncStatus,
  toggleQuick,
} from "./recipes";
import { useOwnAccount } from "./support";

// Phase C13c: search from any screen, "Surprise me", and category suggestions in the editor.
// The four sample recipes are: Green Chile Stew (Mexican, Soups; 125 min), Buttermilk Pancakes
// (Breakfast; 30), Black Bean Tacos with Lime Crema (Mexican, Diet › Vegetarian; 30) and
// Lemon Olive Oil Cake (Desserts › Cakes; 60).

async function addSamples(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  // Adding the samples can be slow when the whole suite is running at once.
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible({ timeout: 15_000 });
  await expect(syncStatus(page)).toHaveText("Saved to cloud", { timeout: 15_000 });
}

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const titles = (page: Page) =>
  page.getByRole("region", { name: /^\d+ recipes?$/ }).locator("[id^=card-title-]");
const listSearch = (page: Page) => page.getByRole("searchbox", { name: "Search recipes" });
const suggestion = (page: Page) => page.getByRole("region", { name: "A suggestion" });

test("Search from a recipe page, from the keyboard, and while already on the list", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  // From a recipe page.
  await recipeCard(page, "Green Chile Stew").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Green Chile Stew" })).toBeVisible();
  if (await library(page).isVisible()) {
    // On a computer the left panel's box searches as you type, from any page (U17).
    await listSearch(page).fill("lime");
    await expect(page).toHaveURL(/\?q=lime$/);
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
    await expect(listSearch(page)).toBeFocused();
    await listSearch(page).fill("pancakes");
    await expect(titles(page)).toHaveText(["Buttermilk Pancakes"]);

    // "/" from a page that isn't a place to type; and never while typing.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await page.keyboard.press("/");
    await expect(listSearch(page)).toBeFocused();
    await page.keyboard.type("cumin");
    await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  } else {
    // On a phone the Recipes tab is where to search (U17): its box is at the top of the list.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Recipes" })
      .click();
    await listSearch(page).fill("lime");
    await expect(page).toHaveURL(/\?q=lime$/);
    await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
    await listSearch(page).fill("pancakes");
    await expect(titles(page)).toHaveText(["Buttermilk Pancakes"]);

    // "/" from another page (a phone-sized window with a keyboard) opens the list's box.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await page.keyboard.press("/");
    await expect(listSearch(page)).toBeFocused();
    await page.keyboard.type("cumin");
    await expect(titles(page)).toHaveText(["Green Chile Stew"]);
  }
  await listSearch(page).fill("a");
  await page.keyboard.type("/b");
  await expect(listSearch(page)).toHaveValue("a/b");

  await noAccessibilityProblems(page);
});

test("Surprise me suggests a recipe from what the list shows", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  // In the list's ⋯ menu (U13).
  await fromListMenu(page, "Surprise me");
  await expect(suggestion(page)).toBeVisible();
  const first = (await suggestion(page).locator("p").nth(1).textContent()) ?? "";
  expect([
    "Green Chile Stew",
    "Buttermilk Pancakes",
    "Black Bean Tacos with Lime Crema",
    "Lemon Olive Oil Cake",
  ]).toContain(first);

  // Another one is never the same recipe again.
  for (let i = 0; i < 6; i++) {
    const before = (await suggestion(page).locator("p").nth(1).textContent()) ?? "";
    await suggestion(page).getByRole("button", { name: "Another one" }).click();
    await expect(suggestion(page).locator("p").nth(1)).not.toHaveText(before);
  }

  // It can be opened, or dismissed.
  await suggestion(page).getByRole("button", { name: "Not now" }).click();
  await expect(suggestion(page)).toHaveCount(0);
  await fromListMenu(page, "Surprise me");
  const chosen = (await suggestion(page).locator("p").nth(1).textContent()) ?? "";
  await suggestion(page).getByRole("link", { name: "Open" }).click();
  await expect(page.getByRole("heading", { level: 1, name: chosen })).toBeVisible();
});

test("Surprise me follows the filters and search", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  // Only the two 30-minute recipes can come up.
  await toggleQuick(page);
  await expect(titles(page)).toHaveCount(2);
  await fromListMenu(page, "Surprise me");
  for (let i = 0; i < 6; i++) {
    await expect(suggestion(page).locator("p").nth(1)).toHaveText(
      /^(Black Bean Tacos with Lime Crema|Buttermilk Pancakes)$/,
    );
    await suggestion(page).getByRole("button", { name: "Another one" }).click();
  }

  // A suggestion goes when the list moves on from it.
  await listSearch(page).fill("cake");
  await expect(suggestion(page)).toHaveCount(0);

  // With nothing to pick from the button is off.
  await listSearch(page).fill("nothing like this");
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("button", { name: "Surprise me" })).toBeDisabled();
  await noAccessibilityProblems(page);
});

test("The editor suggests categories from recipes with similar ingredients, and only on a tap", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Weeknight chili");
  await page
    .getByRole("textbox", { name: "Ingredients" })
    .fill("1 onion, chopped\n2 cloves garlic\n1 teaspoon ground cumin\n2 eggs\n1 cup flour");
  await expect(editorStatus(page)).toHaveText("All changes saved");

  // The two Mexican recipes (stew and tacos) share onion, garlic and cumin with it.
  const suggested = page.getByRole("list", { name: /^Suggested, from recipes/ });
  await expect(suggested).toBeVisible();
  await expect(suggested.getByRole("button")).toHaveText(["+ Mexican: add this category"]);
  // Nothing was filed by suggesting it.
  await expect(page.getByRole("list", { name: "This recipe's categories" })).toHaveCount(0);

  await suggested.getByRole("button", { name: /Mexican/ }).click();
  await expect(page.getByText("Added to Mexican.")).toBeVisible();
  await expect(page.getByRole("list", { name: "This recipe's categories" })).toContainText(
    "Mexican",
  );
  // Once filed, it isn't suggested again.
  await expect(suggested).toHaveCount(0);
  await noAccessibilityProblems(page);
});

test("With too few recipes to learn from, nothing is suggested", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Lonely recipe");
  await page.getByRole("textbox", { name: "Ingredients" }).fill("1 onion\n2 cloves garlic");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await expect(page.getByText("Suggested, from recipes")).toHaveCount(0);
});
