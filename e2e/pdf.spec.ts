import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { premium, syncStatus } from "./recipes";
import { showFolded, useOwnAccount } from "./support";

// Phase E12: recipes imported from a PDF. The PDF is opened on the device; the recipes are found
// (the local test server's stand-in AI starts a recipe at each text page's first line), checked
// and corrected by the person, then each is read into a draft waiting for review.

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .exclude("iframe")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("Premium: a PDF's recipes are found, checked, and each read into a draft", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(150_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const section = page.getByRole("region", { name: "From a PDF" });
  await section.locator('input[type="file"]').setInputFiles("test_images/family-cookbook.pdf");

  // Four "recipes" by the stand-in's rule: the contents page, three recipes, and page 4, which
  // is the end of the soup.
  const list = section.getByRole("list", { name: "Recipes to import" });
  await expect(
    section.getByRole("heading", { name: /4 recipes found in family-cookbook\.pdf/ }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list.getByRole("img", { name: "Page 2" })).toBeVisible();
  await expectAccessible(page);

  // Not the contents page; the soup runs on to page 4, so page 4 isn't a recipe of its own.
  await section.getByRole("checkbox", { name: "Import recipe 1" }).uncheck();
  await section.getByRole("checkbox", { name: "Import recipe 4" }).uncheck();
  const titles = section.getByRole("textbox", { name: "Title" });
  await expect(titles.nth(1)).toHaveValue("Lemon Bars");
  await expect(titles.nth(2)).toHaveValue("Brown Butter Shortbread");
  await section.getByRole("spinbutton", { name: "Last page" }).nth(2).fill("4");
  await titles.nth(2).fill("Brown Butter Shortbread and Tomato Soup");

  await section.getByRole("button", { name: "Read 2 recipes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Found 2 recipes in that PDF" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  const waiting = page.getByRole("region", { name: "Waiting for review" });
  await expect(waiting.getByRole("link", { name: "Lemon Bars" })).toBeVisible();
  await waiting.getByRole("link", { name: "Brown Butter Shortbread and Tomato Soup" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review the import" })).toBeVisible();
  // Its pages, kept with it.
  const source = page.getByRole("region", { name: "The pages" });
  await showFolded(
    source.getByRole("button", { name: "Show the pages" }),
    source.getByRole("img", { name: "Page 2" }),
  );
  await expect(source.getByRole("img", { name: "Page 2" })).toBeVisible();

  // Both drafts read cleanly, so they can be saved together from the list.
  await page.goto("/import");
  const chooseAll = waiting.getByRole("checkbox", { name: "Select all" });
  await chooseAll.check();
  await expect(waiting.getByRole("checkbox", { name: "Select Lemon Bars" })).toBeChecked();
  await waiting.getByRole("button", { name: "Save 2 selected" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved 2 recipes." })).toBeVisible({
    timeout: 30_000,
  });
  await expect(waiting).toHaveCount(0);
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.goto("/");
  await page.getByRole("link", { name: "Lemon Bars" }).first().click();
  // The page it was read from (page 2), kept with it.
  const original = page.getByRole("region", { name: "The original" });
  await expect(
    original.getByRole("button", { name: "Open the original full screen" }),
  ).toBeVisible();
});

test("Free: reading recipes from PDFs is part of Premium", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const section = page.getByRole("region", { name: "From a PDF" });
  await expect(section).toContainText("Reading recipes from PDFs is part of Premium.");
  await expect(section.locator('input[type="file"]')).toHaveCount(0);
});
