import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editorStatus, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase F3: linked sub-recipes.

const ingredientsBox = (page: Page) => page.getByRole("textbox", { name: "Ingredients" });
const preview = (page: Page) =>
  page.getByRole("group", { name: "Ingredients, as Fennl reads them" });

test("Link a sauce to a main dish, expand it, and never in a circle", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Black Bean Tacos with Lime Crema")).toBeVisible();

  // The sauce, as its own recipe.
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Lime Crema");
  await ingredientsBox(page).fill("½ cup sour cream\nZest and juice of 1 lime");
  await page.getByRole("textbox", { name: "Method" }).fill("Stir together.");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.getByRole("link", { name: "All recipes" }).click();

  // The main dish uses it.
  await page.getByRole("link", { name: /Black Bean Tacos/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  const text = await ingredientsBox(page).inputValue();
  await ingredientsBox(page).fill(`${text}\n½ cup lime crema`);
  // The cursor is on the new line: link it.
  await page.getByRole("button", { name: "Link a recipe" }).click();
  // Suggested from the line's own words.
  await page
    .getByRole("list", { name: "Recipes to link" })
    .getByRole("button", { name: "Lime Crema" })
    .click();
  await expect(preview(page).getByRole("link", { name: "Lime Crema" })).toBeVisible();
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();

  // On the recipe page it opens in place.
  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await ingredients.getByRole("button", { name: "Show Lime Crema" }).click();
  const sauce = ingredients.getByRole("region", { name: "Lime Crema" });
  await expect(sauce).toContainText("½ cup sour cream");
  await expect(sauce).toContainText("Stir together.");
  await expect(ingredients.getByRole("link", { name: "Open it" })).toHaveAttribute(
    "href",
    /\/recipes\//,
  );

  // Scaling the tacos doesn't silently scale the sauce.
  await page.getByRole("button", { name: "2×" }).click();
  await expect(sauce).toContainText("Shown as written: scaling this recipe doesn't change it.");
  await expect(sauce).toContainText("½ cup sour cream");
  await expect(sauce.locator("mark")).toHaveCount(0);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.getByRole("button", { name: "As written", exact: true }).click();

  // Cook mode offers to cook the sauce first, and comes back (phase F5).
  await page.getByRole("link", { name: "Start cooking" }).click();
  await page.getByRole("link", { name: "Cook Lime Crema first" }).click();
  await expect(page.getByLabel("½ cup sour cream")).toBeVisible();
  await page
    .getByRole("link", { name: "Back to Black Bean Tacos with Lime Crema" })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Get everything ready" })).toBeVisible();
  await expect(page.getByLabel("½ cup lime crema")).toBeVisible();
  await page.getByRole("link", { name: "Leave cook mode" }).click();

  // The sauce can't link back to the tacos: that would go round in a circle.
  await ingredients.getByRole("link", { name: "Open it" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lime Crema" })).toBeVisible();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await ingredientsBox(page).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  await page.getByRole("button", { name: "Link a recipe" }).click();
  await page.getByLabel("Find a recipe to link to “½ cup sour cream”").fill("Tacos");
  await expect(page.getByText("No recipe by that name.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Done" }).first().click();

  // Deleting the sauce keeps the tacos' line and says where the sauce went.
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: /Black Bean Tacos/ }).click();
  await expect(ingredients).toContainText("½ cup lime crema");
  await expect(ingredients).toContainText("The linked recipe, Lime Crema, is in Trash.");
});
