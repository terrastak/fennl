import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addRecipe, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase U19: the Import page's Waiting for review list. Each draft says where it stands, the ready
// ones sit in their own box, Save all ready saves them at once, Save selected offers to save the
// others anyway, and Discard goes at once with Undo. On a computer and a phone (where the buttons
// sit in a bar at the bottom of the screen).

/** A recipe file Fennl reads for free (clearly laid out), as the Import page's "From a file". */
function recipeFile(title: string) {
  const text = `${title}

Serves 4

Ingredients
1 cup flour
2 eggs

Directions
Mix the flour and eggs.
Bake at 350°F for 20 minutes.`;
  return { name: `${title}.md`, mimeType: "text/markdown", buffer: Buffer.from(text) };
}

const waitingList = (page: Page) => page.getByRole("region", { name: "Waiting for review" });

test("drafts say where they stand; ready ones are saved at once, others anyway, discards undone", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await useOwnAccount(context, baseURL!);
  // A recipe already in the box, so its import may be a duplicate.
  await page.goto("/");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await addRecipe(page, "Lemon Bars");

  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page
    .getByRole("region", { name: "From a file" })
    .locator('input[type="file"]')
    .setInputFiles([
      recipeFile("Banana Bread"),
      recipeFile("Lemon Bars"),
      recipeFile("Oat Cookies"),
    ]);

  const waiting = waitingList(page);
  const ready = waiting.getByRole("group", { name: /^Ready to save/ });
  await expect(ready.getByRole("link")).toHaveCount(2, { timeout: 30_000 });
  await expect(ready.getByRole("link", { name: "Banana Bread" })).toBeVisible();
  await expect(ready.getByRole("link", { name: "Oat Cookies" })).toBeVisible();
  await expect(ready).toContainText("Each will be saved as Fennl read it.");
  const lemon = waiting.getByRole("listitem").filter({ hasText: "Lemon Bars" });
  await expect(lemon).toContainText("May already be in your recipes");
  await expect(waiting.getByRole("button", { name: "Save selected" })).toBeDisabled();
  await expect(waiting.getByRole("button", { name: "Discard selected" })).toBeDisabled();

  const results = await new AxeBuilder({ page })
    .include("section[aria-labelledby='import-waiting-title']")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Save selected on a possible duplicate asks first; saving anyway keeps it as a new recipe.
  await lemon.getByRole("checkbox", { name: "Select Lemon Bars" }).check();
  await expect(waiting).toContainText("1 of 3 selected");
  await waiting.getByRole("button", { name: "Save selected" }).click();
  const ask = waiting.getByRole("group", { name: "Save 1 recipe?" });
  await expect(ask).toContainText("Fennl would leave this one for you to look at first");
  await expect(ask).toContainText("Lemon Bars may already be in your recipes.");
  await ask.getByRole("button", { name: "Save it anyway" }).click();
  await expect(waiting.getByRole("status").filter({ hasText: "Saved 1 recipe." })).toBeVisible({
    timeout: 30_000,
  });
  await expect(waiting.getByRole("link", { name: "Lemon Bars" })).toHaveCount(0);

  // Discard goes at once, and Undo puts it back.
  await waiting.getByRole("checkbox", { name: "Select Banana Bread" }).check();
  await waiting.getByRole("button", { name: "Discard selected" }).click();
  await expect(waiting.getByRole("status")).toContainText("Discarded 1 draft.");
  await expect(waiting.getByRole("link", { name: "Banana Bread" })).toHaveCount(0);
  await waiting.getByRole("button", { name: "Undo" }).click();
  await expect(waiting.getByRole("status")).toContainText("Put back 1 draft.");
  await expect(waiting.getByRole("link", { name: "Banana Bread" })).toBeVisible();
  await expect(waiting.getByRole("checkbox", { name: "Select Banana Bread" })).toBeChecked();

  // Discarded again and the page left: it's gone for good.
  await waiting.getByRole("button", { name: "Discard selected" }).click();
  await expect(waiting.getByRole("status")).toContainText("Discarded 1 draft.");
  await page.reload();
  await expect(waitingList(page).getByRole("link", { name: "Oat Cookies" })).toBeVisible();
  await expect(waitingList(page).getByRole("link", { name: "Banana Bread" })).toHaveCount(0);

  // The ready one, saved without a question.
  await waitingList(page).getByRole("button", { name: "Save the ready one" }).click();
  await expect(
    waitingList(page).getByRole("status").filter({ hasText: "Saved 1 recipe." }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(waitingList(page).getByRole("link")).toHaveCount(0);
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  await page.goto("/");
  await expect(recipeCard(page, "Lemon Bars")).toHaveCount(2);
  await expect(recipeCard(page, "Oat Cookies")).toHaveCount(1);
  await expect(recipeCard(page, "Banana Bread")).toHaveCount(0);
});
