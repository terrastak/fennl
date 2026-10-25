import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { adjust, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase F2: scaling a recipe for another pan, and Fennl's bake-time suggestion.

test("Scale a cake for a different pan, with a bake-time suggestion", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: /Lemon Olive Oil Cake/ }).click();

  // The recipe's pan, read from the method, under "Adjust".
  await expect(page.getByRole("note")).toHaveCount(0);
  await adjust(page, async (panel) => {
    const pans = panel.getByRole("group", { name: "Pan" });
    await expect(pans).toContainText("Recipe’s pan: 9″ round, from the method");
    await pans.getByLabel("Your pan").selectOption({ label: "9×13" });
  });
  await expect(
    page.getByText("Scaled for your 9×13 (about 1¾×): changed amounts are highlighted."),
  ).toBeVisible();
  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await expect(ingredients.locator("mark", { hasText: "1 3/4 cups" })).toBeVisible();
  // Prep, Cook, Serves and Pan, each said once (owner's choice 2026-10-25).
  await expect(page.getByRole("definition").filter({ hasText: "18" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "Your 9×13" })).toBeVisible();

  // The suggestion sits under the step that gives the bake time, marked as Fennl's.
  const bake = page.locator("ol li").filter({ hasText: "40 to 45 minutes" });
  await expect(bake.getByRole("note")).toHaveText(
    "Fennl’s suggestion: Same depth of batter in your 9×13, so about the same time. Start checking at 35 minutes.",
  );
  await expect(page.getByRole("note")).toHaveCount(1);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // The recipe's pan was wrong: correct it.
  await adjust(page, async (panel) => {
    const pans = panel.getByRole("group", { name: "Pan" });
    await pans.getByRole("button", { name: "Change" }).click();
    await pans.getByLabel("Recipe’s pan").selectOption({ label: "8″ round" });
  });
  await expect(page.getByText("Scaled for your 9×13 (about 2⅓×)")).toBeVisible();

  // A loaf as muffins: no minutes, only what to watch for.
  await adjust(page, (panel) =>
    panel
      .getByRole("group", { name: "Pan" })
      .getByLabel("Your pan")
      .selectOption({ label: "12 muffins" }),
  );
  await expect(bake.getByRole("note")).toContainText("Start checking early and use a toothpick.");
  await expect(bake.getByRole("note")).not.toContainText("minutes");

  // Kept with the recipe for the household.
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.reload();
  await expect(page.getByText(/Scaled for your 12 muffins/)).toBeVisible();

  await page.getByRole("button", { name: "Back to as written" }).click();
  await expect(page.locator("mark")).toHaveCount(0);
  await expect(page.getByRole("note")).toHaveCount(0);
});
