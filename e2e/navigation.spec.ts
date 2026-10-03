import { expect, test } from "@playwright/test";

// Runs on both desktop (sidebar) and phone (bottom tabs). Only one "Main" navigation is
// visible at a time, so these tests use whichever the screen size shows.

test("exactly one main navigation is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
});

test("moves between pages without reloading", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");

  // Mark the page so we can tell if a full reload happens.
  await page.evaluate(() => ((window as unknown as { marker: boolean }).marker = true));

  const pages = [
    { link: "Import", url: "/import", heading: "Import recipes" },
    { link: "Settings", url: "/settings", heading: "Settings" },
    { link: "Account", url: "/account", heading: "Account" },
    { link: "Recipes", url: "/", heading: "Your recipes" },
  ];
  for (const target of pages) {
    await nav.getByRole("link", { name: target.link }).click();
    await expect(page).toHaveURL(target.url);
    await expect(page.getByRole("heading", { level: 1, name: target.heading })).toBeVisible();
    await expect(nav.getByRole("link", { name: target.link })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }

  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker)).toBe(true);
});

test("the browser back button works", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Import" })
    .click();
  await expect(page).toHaveURL("/import");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeVisible();
});

test("after switching pages, focus moves to the new page's heading", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
});
