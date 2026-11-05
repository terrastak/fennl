import { expect, test, type Page } from "@playwright/test";
import { recipeCard } from "./recipes";
import { useOwnAccount } from "./support";

// Keyboard-only use on a computer (the sidebar layout).
test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "Keyboard navigation is checked on the desktop layout");
});

/** Opens a page and waits for it to finish loading (it first checks who's signed in). */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("the first Tab reaches a skip link that jumps to the content", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("the sidebar can be used with the keyboard alone", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Tab"); // logo
  await page.keyboard.press("Tab"); // the search box (U17: the left panel's)
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toBeFocused();
  // Then the recipe box (its lists and categories), then Import.
  const importLink = page.getByRole("navigation", { name: "Main" }).getByRole("link", {
    name: "Import",
  });
  for (
    let i = 0;
    i < 60 && !(await importLink.evaluate((el) => el === document.activeElement));
    i++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(importLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/import");
  await expect(page.getByRole("heading", { level: 1, name: "Import recipes" })).toBeFocused();
});

test("appearance choices work with arrow keys", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!); // changes the account's color scheme
  await open(page, "/settings");
  await page.getByRole("radio", { name: /Harbor/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /Heirloom/ })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "heirloom");
});

test("focus is always visible", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  // An outline, or for the search box (U17) a ring round the whole box.
  const shown = await page.evaluate(() => {
    const active = document.activeElement as Element;
    const box = active.closest("[role=search]");
    return (
      getComputedStyle(active).outlineStyle === "solid" ||
      (box !== null && getComputedStyle(box).boxShadow !== "none")
    );
  });
  expect(shown).toBe(true);
});

test("on the recipe list, typing searches, and a link skips past the recipe box", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search recipes" });

  // Typing anywhere on the list that isn't a place to type goes into the search box (U17).
  await page.getByRole("heading", { level: 1, name: "All recipes" }).click();
  await page.keyboard.type("pan");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("pan");
  await expect(page.getByText(/match(es)? “pan”/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");

  // Right after the search box, a link jumps to the recipes.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to recipes" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#recipe-results")).toBeFocused();
});
