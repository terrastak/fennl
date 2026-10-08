import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase C10: downloading the whole library.

test("Download all recipes: a page for each, and the data", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  await page.goto("/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download all recipes" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^fennl-recipes-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(readFileSync((await download.path())!)));

  const index = strFromU8(files["index.html"]!);
  for (const title of [
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
    "Green Chile Stew",
    "Lemon Olive Oil Cake",
  ]) {
    expect(index).toContain(title);
  }
  const data = JSON.parse(strFromU8(files["fennl-recipes.json"]!)) as {
    format: string;
    recipes: { title: string; categories: string[] }[];
  };
  expect(data.format).toBe("fennl-export");
  expect(data.recipes).toHaveLength(4);
  expect(data.recipes.find((r) => r.title === "Lemon Olive Oil Cake")?.categories).toEqual([
    "Desserts › Cakes",
  ]);

  // A recipe's page opens on its own, in a browser.
  const stewFile = Object.keys(files).find((name) => name.startsWith("recipes/green-chile-stew"))!;
  await page.setContent(strFromU8(files[stewFile]!));
  await expect(page.getByRole("heading", { level: 1, name: "Green Chile Stew" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ingredients" })).toBeVisible();
  await expect(page.getByText("1 teaspoon ground cumin")).toBeVisible();
});
