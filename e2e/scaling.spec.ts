import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { adjust, recipeCard, syncStatus, quickScale } from "./recipes";
import { useOwnAccount } from "./support";

// Phase F1: scaling a recipe and showing it in other units. Owner's choices 2026-10-25: the
// ingredients say how many it serves or makes, with half, as written, double and triple beside
// it; any number of servings, another pan and units are under "Adjust".

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

  // Doubled from the quick amounts beside "Serves" (owner's choice 2026-10-25).
  await quickScale(page, "2×");
  await expect(
    ingredients.getByRole("group", { name: "Amount" }).getByRole("button", { name: "2×" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Doubled: changed amounts are highlighted.")).toBeVisible();
  await expect(ingredients.locator("mark", { hasText: "4 cups" })).toHaveCount(2);
  await expect(ingredients.locator("mark", { hasText: "1/4 cup" })).toBeVisible();
  await expect(ingredients).toContainText("Serves 8 · Makes about 24 pancakes");

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

  await adjust(page, (panel) =>
    panel.getByLabel("Units", { exact: true }).selectOption({ label: "Metric" }),
  );
  await expect(page.getByText("Doubled and shown in metric:")).toBeVisible();
  await expect(ingredients.locator("mark", { hasText: "950 ml" })).toBeVisible();
  // Spoons stay spoons.
  await expect(ingredients.getByRole("button", { name: "4 tablespoons sugar" })).toBeVisible();
  // Steps convert too, but one pancake's batter stays one pancake's size.
  await expect(page.locator("ol mark", { hasText: "59 ml" })).toBeVisible();

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Kept with the recipe and the account: still doubled, in metric, after a reload.
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.reload();
  await expect(page.getByText("Doubled and shown in metric:")).toBeVisible();
  await expect(ingredients.getByText("kept as written")).toBeVisible();

  // Any number of servings, typed or a step at a time, under "Adjust": 9 is about 2¼×.
  await adjust(page, async (panel) => {
    const serves = panel.getByLabel("Serves", { exact: true });
    await expect(serves).toHaveValue("8");
    await panel.getByRole("button", { name: "One more" }).click();
    await expect(serves).toHaveValue("9");
    await serves.fill("12");
    await serves.press("Enter");
    await expect(serves).toHaveValue("12");
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
  await expect(ingredients).toContainText("Serves 12");
  await expect(page.getByText("Tripled and shown in metric:")).toBeVisible();

  // Back to the recipe's own amounts, then its own units.
  await page.getByRole("button", { name: "Back to as written" }).click();
  await expect(ingredients).toContainText("Serves 4");
  await adjust(page, async (panel) => {
    await expect(panel.getByLabel("Units", { exact: true })).toHaveValue("metric");
    await panel.getByLabel("Units", { exact: true }).selectOption({ label: "As written" });
  });
  await expect(page.locator("mark")).toHaveCount(0);
  await expect(ingredients.getByText("2 cups all-purpose flour")).toBeVisible();
});

test("A recipe that makes things says Makes, once, with the quick amounts", async ({
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
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await page.getByLabel("Serves").fill("14");
  await page.getByLabel("Makes").fill("14 pancakes");
  await expect(page.getByLabel("Makes")).toHaveValue("14 pancakes");
  await page.getByRole("button", { name: "Done" }).first().click();

  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await expect(ingredients).toContainText("Makes 14 pancakes");
  await expect(ingredients).not.toContainText("Serves");
  // Said once: not in the details under the title.
  await expect(page.getByRole("term").filter({ hasText: /^(Serves|Makes)$/ })).toHaveCount(0);
  await quickScale(page, "2×");
  await expect(ingredients).toContainText("Makes 28 pancakes");
  await adjust(page, (panel) =>
    expect(panel.getByLabel("Makes", { exact: true })).toHaveValue("28"),
  );
  await quickScale(page, "As written");
  await expect(ingredients).toContainText("Makes 14 pancakes");
});

test("No pan in the recipe: no pan choices under Adjust", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Buttermilk Pancakes")).toBeVisible();
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  await adjust(page, async (panel) => {
    await expect(panel.getByLabel("Serves", { exact: true })).toBeVisible();
    await expect(panel.getByRole("group", { name: "Pan" })).toHaveCount(0);
    await expect(panel.getByText(/pan/i)).toHaveCount(0);
  });
});
