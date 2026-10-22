import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { premium, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase E13: a Paprika 3 library, read on the device and imported after a preview. Importing
// again updates what changed in Paprika, keeping the version from before, which the recipe page
// offers to compare and put back (owner's choices 2026-10-21).

const SAMPLE = "import-quality/test_paprika/owner-library-sample.paprikarecipes";
const LATKES = "Crispy Potato Latkes.paprikarecipe";

/** The sample with the latkes changed in Paprika: an ingredient, and so its hash. */
function changedSample(): Buffer {
  const entries = unzipSync(new Uint8Array(readFileSync(SAMPLE)));
  const recipe = JSON.parse(strFromU8(gunzipSync(entries[LATKES]!))) as Record<string, unknown>;
  recipe.ingredients = String(recipe.ingredients).replace(
    "1/2 cup grated onion",
    "1 cup grated onion",
  );
  recipe.hash = "CHANGED-IN-PAPRIKA";
  entries[LATKES] = gzipSync(strToU8(JSON.stringify(recipe)));
  return Buffer.from(zipSync(entries, { level: 0 }));
}

test("Premium: a library is previewed, imported with photos, and updated with the earlier version kept", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const section = page.getByRole("region", { name: "From Paprika" });
  await section.locator('input[type="file"]').setInputFiles(SAMPLE);

  await expect(section.getByRole("heading", { name: /: 8 recipes$/ })).toBeVisible();
  await expect(section).toContainText("8 new recipes to import.");
  await expect(section).toContainText("8 photos (about");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await section.getByRole("button", { name: "Import 8 recipes" }).click();
  await expect(section.getByRole("status").last()).toContainText("Imported 8 new recipes.", {
    timeout: 120_000,
  });
  await expect(section).toContainText("Added 8 photos.");

  // The same file again: nothing new.
  await section.locator('input[type="file"]').setInputFiles(SAMPLE);
  await expect(section).toContainText("8 recipes already in Fennl, unchanged.");
  await expect(section).toContainText("Everything in this file is already in Fennl.");
  await section.getByRole("button", { name: "Cancel" }).click();

  // Changed in Paprika: updated, the version from before kept.
  await section.locator('input[type="file"]').setInputFiles({
    name: "My Recipes.paprikarecipes",
    mimeType: "application/zip",
    buffer: changedSample(),
  });
  const changed = section.getByRole("group", {
    name: "1 recipe changed in Paprika since you imported it",
  });
  await expect(changed.getByLabel(/^Update it/)).toBeChecked();
  await section.getByRole("button", { name: "Import" }).click();
  await expect(section.getByRole("status").last()).toContainText("Updated 1 recipe from Paprika", {
    timeout: 60_000,
  });

  await page.goto("/");
  await recipeCard(page, "Crispy Potato Latkes").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Crispy Potato Latkes" })).toBeVisible();
  await expect(page.getByText("1 cup grated onion")).toBeVisible();
  const notice = page.getByRole("region", { name: "Updated from Paprika" });
  await notice.getByRole("button", { name: "Compare" }).click();
  await expect(notice.getByRole("definition").filter({ hasText: "Before" })).toContainText(
    "1/2 cup grated onion",
  );
  await notice.getByRole("button", { name: "Put the earlier version back" }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByText("1/2 cup grated onion")).toBeVisible();
});

test("Free: the text comes in, photos stay in Paprika, and a file that isn't one is explained", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await useOwnAccount(context, baseURL!);
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const section = page.getByRole("region", { name: "From Paprika" });
  await section.locator('input[type="file"]').setInputFiles({
    name: "Recipes.paprikarecipes",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("Just some text, renamed."),
  });
  await expect(section.getByRole("alert")).toContainText("This isn't a Paprika export.");

  await section.locator('input[type="file"]').setInputFiles(SAMPLE);
  await expect(section).toContainText("Photos stay in Paprika");
  await section.getByRole("button", { name: "Import 8 recipes" }).click();
  await expect(section.getByRole("status").last()).toContainText("Imported 8 new recipes.", {
    timeout: 60_000,
  });
  await page.goto("/");
  await expect(recipeCard(page, "Cornmeal-Fried Onion Rings")).toBeVisible();
});
