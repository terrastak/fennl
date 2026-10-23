import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase F1: scaling a recipe and showing it in other units.

test("Double a recipe and show it in metric; it stays that way", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Buttermilk Pancakes")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();

  const ingredients = page.getByRole("region", { name: "Ingredients" });
  // As written: nothing highlighted, nothing said.
  await expect(ingredients.getByText("2 cups all-purpose flour")).toBeVisible();
  await expect(page.locator("mark")).toHaveCount(0);

  await page.getByRole("button", { name: "2×" }).click();
  await expect(page.getByRole("button", { name: "2×" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Doubled: changed amounts are highlighted.")).toBeVisible();
  await expect(ingredients.locator("mark", { hasText: "4 cups" })).toHaveCount(2);
  await expect(ingredients.locator("mark", { hasText: "1/4 cup" })).toBeVisible();
  await expect(page.getByText("Serves 8 · about 24 pancakes")).toBeVisible();
  await expect(page.getByRole("group", { name: "Makes" }).locator("output")).toHaveText("8");

  // Tapping a line shows the original and the working.
  const flour = ingredients.getByRole("button", { name: /4 cups all-purpose flour/ });
  await flour.click();
  await expect(flour).toHaveAttribute("aria-expanded", "true");
  await expect(ingredients.getByText("Original: 2 cups all-purpose flour")).toBeVisible();
  await expect(ingredients.getByText("Doubled: 4 cups all-purpose flour")).toBeVisible();

  // One line kept at its written amount.
  await ingredients.getByRole("button", { name: "Keep this amount as written" }).click();
  await expect(ingredients.getByText("kept as written")).toBeVisible();
  await expect(ingredients.locator("mark", { hasText: "4 cups" })).toHaveCount(1); // buttermilk

  await page.getByLabel("Units", { exact: true }).selectOption({ label: "Metric" });
  await expect(page.getByText("Doubled and shown in metric:")).toBeVisible();
  await expect(ingredients.locator("mark", { hasText: "950 ml" })).toBeVisible();
  // Spoons stay spoons.
  await expect(ingredients.getByRole("button", { name: "4 tablespoons sugar" })).toBeVisible();
  // Steps scale their measured amounts too.
  await expect(page.locator("ol mark", { hasText: "120 ml" })).toBeVisible();

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Kept with the recipe and the account: still doubled, in metric, after a reload.
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.reload();
  await expect(page.getByText("Doubled and shown in metric:")).toBeVisible();
  await expect(page.getByLabel("Units", { exact: true })).toHaveValue("metric");
  await expect(ingredients.getByText("kept as written")).toBeVisible();

  // Back to the recipe as written.
  await page.getByRole("button", { name: "As written", exact: true }).click();
  await page.getByLabel("Units", { exact: true }).selectOption({ label: "As written" });
  await expect(page.locator("mark")).toHaveCount(0);
  await expect(ingredients.getByText("2 cups all-purpose flour")).toBeVisible();
});
