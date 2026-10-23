import { expect, test } from "@playwright/test";
import { editorStatus, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase F4: nutrition entered by hand, and hidden everywhere without deleting it.

test("Correct a recipe's nutrition, then hide it in Settings and bring it back", async ({
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

  const nutrition = page.getByRole("region", { name: "Nutrition per serving" });
  await expect(nutrition).toContainText("420 kcal");

  // In the editor it's open, since the recipe has some.
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("420");
  await page.getByLabel("Calories (kcal)").fill("400");
  await page.getByLabel("Fiber (g)").fill("2.5");
  await page.getByLabel("Sugar (g)").fill("");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(nutrition).toContainText("400 kcal");
  await expect(nutrition).toContainText("2.5 g");
  await expect(nutrition).not.toContainText("Sugar");
  await expect(nutrition).toContainText("Entered by hand.");

  // Hidden everywhere, kept.
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByLabel("Show nutrition").uncheck();
  await expect(page.getByLabel("Show nutrition")).not.toBeChecked();
  await page.getByRole("link", { name: "Recipes" }).first().click();
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Buttermilk Pancakes" })).toBeVisible();
  await expect(nutrition).toHaveCount(0);
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(page.getByText("Nutrition is hidden.")).toBeVisible();
  await expect(page.getByLabel("Calories (kcal)")).toHaveCount(0);
  await page.getByRole("button", { name: "Done" }).first().click();

  // The account remembers it after a reload; turned back on, it's all still there.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Buttermilk Pancakes" })).toBeVisible();
  await expect(nutrition).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByLabel("Show nutrition")).not.toBeChecked();
  await page.getByLabel("Show nutrition").check();
  await page.getByRole("link", { name: "Recipes" }).first().click();
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  await expect(nutrition).toContainText("400 kcal");
});
