import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { RECIPE_SCHEMA_VERSION } from "../shared/recipe";
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
  // "Serves 6", said once, with the ingredients (owner's choice 2026-10-25).
  await expect(page.getByRole("region", { name: "Ingredients" })).toContainText("Serves 6");
  await expect(page.getByRole("heading", { level: 3, name: "For the stew:" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "2 lb pork shoulder" })).toBeVisible();
  // Five steps, numbered 1 to 5.
  const steps = page.locator("ol li");
  await expect(steps).toHaveCount(5);
  await expect(page.getByRole("list", { name: "Categories" })).toContainText("Mexican");
  await expect(page.getByText("Freezes well for up to three months.")).toBeVisible();
  await expect(page.getByText(/Last made/)).toHaveCount(0);
  await noAccessibilityProblems(page);

  await page.getByRole("button", { name: "Made it today" }).click();
  await expect(page.getByText("Last made today")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.reload();
  await expect(page.getByText("Last made today")).toBeVisible();
  await page.getByRole("button", { name: "Undo “made it”" }).click();
  await expect(page.getByText(/Last made/)).toHaveCount(0);

  // Nutrition shows when a recipe has it.
  await page.getByRole("link", { name: "← All recipes" }).click();
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  await expect(page.getByRole("heading", { name: "Nutrition per serving" })).toBeVisible();
  await expect(page.getByText("420 kcal")).toBeVisible();
});

test("Notes: the recipe's own first, then each one added, signed and dated", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addSamples(page);
  await page.getByRole("link", { name: /Lemon Olive Oil Cake/ }).click();
  await expect(page.getByText("A favorite", { exact: true })).toHaveCount(0);

  // A rating, favorite and note sent the way another of this person's devices would. (A
  // partner's notes show the same way, signed with their name, once households can share: G1.)
  const recipeId = page.url().split("/").pop()!;
  const deviceId = await page.evaluate(() => localStorage.getItem("fennl:device-id"));
  const res = await context.request.post("/api/sync/push", {
    headers: { origin: baseURL! },
    data: {
      deviceId,
      schemaVersion: RECIPE_SCHEMA_VERSION,
      sentAt: Date.now(),
      changes: [
        { kind: "opinion", recipeId, fields: { rating: 4, favorite: true }, changedAt: Date.now() },
        {
          kind: "note",
          id: crypto.randomUUID(),
          recipeId,
          text: "Add a little more zest.",
          writtenAt: "2026-10-20T12:00:00.000Z",
          changedAt: Date.now(),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);

  await page.reload();
  await expect(page.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await expect(page.getByLabel("A favorite of mine")).toBeChecked();
  const notes = page.getByRole("region", { name: "Notes" }).getByRole("listitem");
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(0)).toContainText("Wrapped well, it keeps at room temperature");
  await expect(notes.nth(0)).toContainText("From The Fennl kitchen");
  await expect(notes.nth(1)).toContainText("Add a little more zest.");
  await expect(notes.nth(1)).toContainText(/June\s*Oct 20, 2026/);
  await noAccessibilityProblems(page);

  // Editing: Escape leaves it as it was; Done changes it.
  await notes
    .nth(1)
    .getByRole("button", { name: /Edit your note/ })
    .click();
  const box = page.getByLabel("Your note");
  await expect(box).toHaveValue("Add a little more zest.");
  await box.fill("Something else");
  await page.keyboard.press("Escape");
  await expect(notes.nth(1)).toContainText("Add a little more zest.");
  await notes
    .nth(1)
    .getByRole("button", { name: /Edit your note/ })
    .click();
  await box.fill("Add a lot more zest.");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(notes.nth(1)).toContainText("Add a lot more zest.");
  await expect(notes.nth(1)).toContainText(/Oct 20, 2026 · edited/);

  // Adding one: written in a card signed with your name and today's date; Ctrl+Enter adds it,
  // under the others.
  await page.getByRole("button", { name: "Add a note" }).click();
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute("placeholder", "Write a note…");
  const card = page.locator("form").filter({ has: box });
  await expect(card).toContainText("June");
  await expect(card.getByRole("button", { name: "Add note" })).toBeDisabled();
  await box.fill("Doubled it for a party.");
  await noAccessibilityProblems(page);
  await page.keyboard.press("Control+Enter");
  await expect(notes).toHaveCount(3);
  await expect(notes.nth(2)).toContainText("Doubled it for a party.");
  await expect(page.getByRole("button", { name: "Add a note" })).toBeVisible();

  // Leaving with words not saved asks first (owner's choice 2026-10-27).
  await page.getByRole("button", { name: "Add a note" }).click();
  await box.fill("Lovely warm.");
  await page.getByRole("link", { name: "← All recipes" }).click();
  const leaving = page.getByRole("dialog", { name: "Save the note before leaving?" });
  await expect(leaving).toBeVisible();
  await leaving.getByRole("button", { name: "Keep writing" }).click();
  await expect(box).toHaveValue("Lovely warm.");
  // Not when the words are back as they were.
  await box.fill(" ");
  await page.getByRole("link", { name: "← All recipes" }).click();
  await expect(leaving).toBeHidden();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await page.getByRole("link", { name: /Lemon Olive Oil Cake/ }).click();
  await page.getByRole("button", { name: "Add a note" }).click();
  await box.fill("Lovely warm.");
  await page.getByRole("link", { name: "← All recipes" }).click();
  await leaving.getByRole("button", { name: "Save note" }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await page.getByRole("link", { name: /Lemon Olive Oil Cake/ }).click();
  await expect(notes.nth(3)).toContainText("Lovely warm.");

  // Deleting one, with Undo.
  await notes
    .nth(3)
    .getByRole("button", { name: /Edit your note/ })
    .click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(notes).toHaveCount(3);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(notes).toHaveCount(4);

  // Anyone can change the recipe's own note.
  await notes.nth(0).getByRole("button", { name: "Edit the recipe’s note" }).click();
  await expect(page.getByLabel("The recipe's note")).toHaveValue(/^Wrapped well/);
  await page.getByLabel("The recipe's note").fill("Keeps 3 days, wrapped.");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(notes.nth(0)).toContainText("Keeps 3 days, wrapped.");

  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.reload();
  await expect(notes).toHaveCount(4);
  await expect(notes.nth(0)).toContainText("Keeps 3 days, wrapped.");
  await expect(notes.nth(3)).toContainText("Lovely warm.");
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
