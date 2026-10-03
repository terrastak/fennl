import { expect, test } from "@playwright/test";

// Keyboard-only use on a computer (the sidebar layout).
test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "Keyboard navigation is checked on the desktop layout");
});

test("the first Tab reaches a skip link that jumps to the content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("the sidebar can be used with the keyboard alone", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Tab"); // logo
  await page.keyboard.press("Tab"); // Recipes
  await page.keyboard.press("Tab"); // Import
  await expect(page.getByRole("link", { name: "Import" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/import");
  await expect(page.getByRole("heading", { level: 1, name: "Import recipes" })).toBeFocused();
});

test("appearance choices work with arrow keys", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: /Harbor/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /Heirloom/ })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "heirloom");
});

test("focus is always visible", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineStyle,
  );
  expect(outline).toBe("solid");
});
