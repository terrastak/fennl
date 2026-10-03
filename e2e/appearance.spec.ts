import { expect, test, type Page } from "@playwright/test";

const html = (page: Page) => page.locator("html");
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("color scheme, mode and text size apply instantly and survive a reload", async ({ page }) => {
  await page.goto("/settings");

  await page.getByRole("radio", { name: /Heirloom/ }).check();
  await expect(html(page)).toHaveAttribute("data-scheme", "heirloom");
  expect(await background(page)).toBe("rgb(245, 239, 228)"); // Heirloom linen

  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(html(page)).toHaveAttribute("data-mode", "dark");
  expect(await background(page)).toBe("rgb(26, 22, 19)"); // Heirloom dark

  await page.getByRole("radio", { name: /Larger/ }).check();
  await expect(html(page)).toHaveAttribute("data-text-size", "larger");

  await page.reload();
  await expect(html(page)).toHaveAttribute("data-scheme", "heirloom");
  await expect(html(page)).toHaveAttribute("data-mode", "dark");
  await expect(html(page)).toHaveAttribute("data-text-size", "larger");
  await expect(page.getByRole("radio", { name: /Heirloom/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
});

test("choosing the defaults removes the attributes again", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: /Heirloom/ }).check();
  await page.getByRole("radio", { name: /Harbor/ }).check();
  await expect(html(page)).not.toHaveAttribute("data-scheme", /.*/);
});

test("'Match my device' follows the device's dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Match my device" })).toBeChecked();
  expect(await background(page)).toBe("rgb(17, 20, 18)"); // Harbor dark

  await page.getByRole("radio", { name: "Light" }).check();
  expect(await background(page)).toBe("rgb(246, 245, 240)"); // Harbor light, despite the device
});
