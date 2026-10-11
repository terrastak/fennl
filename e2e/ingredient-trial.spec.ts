import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Phase E2: the ingredient check page shows how each typed line is read.
test.use({ storageState: { cookies: [], origins: [] } });

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("reads typed ingredient lines", async ({ page }) => {
  await page.goto("/ingredient-trial");
  await expect(page.getByRole("heading", { level: 1, name: "Ingredient check" })).toBeVisible();
  const results = page.getByRole("list", { name: "Lines read" });
  await expect(results.getByRole("listitem")).toHaveCount(10);
  await expectAccessible(page);

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("Nothing to read yet.")).toBeVisible();
  await page
    .getByLabel("Ingredient lines, one per line")
    .fill("1 ½ cups (190 g) flour, sifted\n1 (14-ounce) can black beans");
  const lines = results.getByRole("listitem");
  await expect(lines).toHaveCount(2);
  const flour = lines.first();
  await expect(flour.getByRole("definition").first()).toHaveText("1 ½ cup");
  await expect(flour).toContainText("Ingredient");
  await expect(flour).toContainText("flour");
  await expect(flour).toContainText("Also written as");
  await expect(flour).toContainText("190 gram");
  await expect(flour.locator("mark")).toHaveText(["1 ½ cups", "190 g"]);
  await expect(lines.nth(1)).toContainText("Size of each");
  await expect(lines.nth(1)).toContainText("14 ounce");
  await expectAccessible(page);
});
