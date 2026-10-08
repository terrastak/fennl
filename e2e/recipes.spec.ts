import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addRecipe, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase C5: the recipe list and the recipe page.

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function addSamples(page: Page) {
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
}

/** The recipe cards' links, in the order shown. */
const cardTitles = (page: Page) =>
  page.getByRole("region", { name: /^\d+ recipes?$/ }).getByRole("link");

test("An empty recipe box invites you in, and sample recipes fill it", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your recipe box is empty, for now" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add recipe" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import" }).first()).toBeVisible();
  await noAccessibilityProblems(page);

  await addSamples(page);
  await expect(cardTitles(page)).toHaveCount(4);
  // Alphabetical at first, with categories and time on each card.
  await expect(cardTitles(page).first()).toContainText("Black Bean Tacos with Lime Crema");
  await expect(recipeCard(page, "Green Chile Stew")).toContainText("Mexican, Soups · 2 hr 5 min");
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toContainText("Desserts › Cakes");
  await noAccessibilityProblems(page);

  // A newer recipe comes first when sorted by newest.
  await addRecipe(page, "Zucchini Bread");
  await page.getByLabel("Sort by").selectOption({ label: "Newest first" });
  await expect(cardTitles(page).first()).toContainText("Zucchini Bread");
  await page.reload();
  await expect(page.getByLabel("Sort by")).toHaveValue("newest");
});

test("A recipe page shows the whole recipe, and Made it is remembered", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addSamples(page);

  await page.getByRole("link", { name: /Green Chile Stew/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Green Chile Stew" })).toBeVisible();
  await expect(page).toHaveTitle("Green Chile Stew · Fennl");
  await expect(page.getByText("Nana", { exact: true })).toBeVisible();
  await expect(page.getByText("Prep", { exact: true })).toBeVisible();
  await expect(page.getByText("2 hr 5 min")).toBeVisible();
  await expect(page.getByText("Serves 6")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "For the stew:" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "2 lb pork shoulder" })).toBeVisible();
  // Five steps, numbered 1 to 5.
  const steps = page.locator("ol li");
  await expect(steps).toHaveCount(5);
  await expect(page.getByRole("list", { name: "Categories" })).toContainText("Mexican");
  await expect(page.getByText("Freezes well for up to three months.")).toBeVisible();
  await expect(page.getByText("Not made yet")).toBeVisible();
  await noAccessibilityProblems(page);

  await page.getByRole("button", { name: "Made it today" }).click();
  await expect(page.getByText("Last made today")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.reload();
  await expect(page.getByText("Last made today")).toBeVisible();
  await page.getByRole("button", { name: "Undo “made it”" }).click();
  await expect(page.getByText("Not made yet")).toBeVisible();

  // Nutrition shows when a recipe has it.
  await page.getByRole("link", { name: "← All recipes" }).click();
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  await expect(page.getByRole("heading", { name: "Nutrition per serving" })).toBeVisible();
  await expect(page.getByText("420 kcal")).toBeVisible();
});

test("A rating, favorite and note made on another device show on the recipe", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addSamples(page);
  await page.getByRole("link", { name: /Lemon Olive Oil Cake/ }).click();
  await expect(page.getByText("A favorite", { exact: true })).toHaveCount(0);

  // Sent the way another of this person's devices would. (A partner's show above, signed, once
  // households can share: phase G1.)
  const recipeId = page.url().split("/").pop()!;
  const deviceId = await page.evaluate(() => localStorage.getItem("fennl:device-id"));
  const res = await context.request.post("/api/sync/push", {
    headers: { origin: baseURL! },
    data: {
      deviceId,
      schemaVersion: 1,
      sentAt: Date.now(),
      changes: [
        {
          kind: "opinion",
          recipeId,
          fields: { rating: 4, favorite: true, note: "Add a little more zest." },
          changedAt: Date.now(),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);

  await page.reload();
  const yours = page.getByRole("region", { name: "Yours" });
  await expect(yours.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await expect(yours.getByLabel("A favorite of mine")).toBeChecked();
  await expect(yours.getByLabel("Your note")).toHaveValue("Add a little more zest.");
  await expect(yours).toContainText("Signed June");
  // Not shown twice: your own aren't in the household's ratings and signed notes.
  await expect(page.getByText(/out of 5 stars from/)).toHaveCount(0);
  await expect(page.locator("figcaption")).toHaveCount(0);
  await noAccessibilityProblems(page);
});

test("Recipes open and close from the keyboard", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addSamples(page);

  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).focus();
  await page.keyboard.press("Enter");
  const title = page.getByRole("heading", { level: 1, name: "Buttermilk Pancakes" });
  await expect(title).toBeFocused();

  await page.getByRole("button", { name: "Made it today" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Last made today")).toBeVisible();

  await page.getByRole("link", { name: "← All recipes" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Your recipes" })).toBeFocused();
});

test("A recipe that isn't here says so", async ({ page }) => {
  await page.goto(`/recipes/${crypto.randomUUID()}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "This recipe isn’t here" }),
  ).toBeVisible();
});
