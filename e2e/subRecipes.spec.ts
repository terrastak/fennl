import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DRAFT_SAVED, editorStatus, quickScale, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase F3: linked sub-recipes.

const ingredientsBox = (page: Page) => page.getByRole("textbox", { name: "Ingredients" });
// The editor on a laptop (U27) says which recipe the cursor's line links to, under the box, and
// marks a linked line in the box's margin.
const linkStrip = (page: Page) => page.locator("p", { hasText: /^This (line|step) links to/ });
const linkedLines = (page: Page, list: "ingredients" | "directions") =>
  page.locator(`section[data-list="${list}"] [data-margin] [data-linked]`);
// Directions is a box for each step there (U27): the linked steps' words.
const linkedSteps = (page: Page) =>
  page.locator('section[data-list="directions"] [data-linked] [data-step-words]');

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
  await page.getByRole("textbox", { name: "Directions" }).fill("Stir together.");
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.getByRole("link", { name: "← All recipes" }).click();

  // The main dish uses it.
  await page.getByRole("link", { name: /Black Bean Tacos/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  const text = await ingredientsBox(page).inputValue();
  await ingredientsBox(page).fill(`${text}\n½ cup lime crema`);
  // The cursor is on the new line: link it (the first Link a recipe is the ingredients').
  await page.getByRole("button", { name: "Link a recipe" }).first().click();
  // Suggested from the line's own words.
  await page
    .getByRole("list", { name: "Recipes to link" })
    .getByRole("button", { name: "Lime Crema" })
    .click();
  await expect(linkStrip(page)).toHaveText("This line links to Lime Crema.Unlink");
  await expect(linkStrip(page).getByRole("link", { name: "Lime Crema" })).toBeVisible();
  await expect(linkedLines(page, "ingredients")).toHaveText(["½ cup lime crema"]);
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
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
  await quickScale(page, "2×");
  await expect(sauce).toContainText("Shown as written: scaling this recipe doesn't change it.");
  await expect(sauce).toContainText("½ cup sour cream");
  await expect(sauce.locator("mark")).toHaveCount(0);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.getByRole("button", { name: "Back to as written" }).click();

  // Cook mode offers to cook the sauce first, and comes back (phase F5).
  await page.getByRole("link", { name: "Start cooking" }).click();
  const need = page.getByRole("region", { name: "You’ll need" });
  await page.getByRole("link", { name: "Cook Lime Crema first" }).click();
  await expect(need).toContainText("½ cup sour cream");
  await page
    .getByRole("link", { name: "Back to Black Bean Tacos with Lime Crema" })
    .first()
    .click();
  await expect(need).toContainText("½ cup lime crema");
  await page.getByRole("link", { name: "Leave cook mode" }).click();

  // The sauce can't link back to the tacos: that would go round in a circle.
  await ingredients.getByRole("link", { name: "Open it" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lime Crema" })).toBeVisible();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await ingredientsBox(page).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  await page.getByRole("button", { name: "Link a recipe" }).first().click();
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

// U27 (owner's choice 2026-11-21): a step can link to a recipe too ("Make the herb butter." →
// Herb Butter). The recipe page names it after the step and opens it; cook mode offers to cook it
// first; and the circle check counts step links.
test("Link a step to a recipe: named on the page, cooked first, never in a circle", async ({
  page,
  context,
  baseURL,
}, info) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  const directions = (p: Page) => p.getByRole("textbox", { name: "Directions" });
  // The one box, or on a laptop (U27) the first step's.
  const firstStep = (p: Page) => p.locator('section[data-list="directions"] textarea').first();

  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Herb Butter");
  await ingredientsBox(page).fill("4 Tbsp butter, softened\n1 Tbsp chopped parsley");
  await directions(page).fill("Mix together until smooth.");
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Herb Butter" })).toBeVisible();
  await page.getByRole("link", { name: "← All recipes" }).click();

  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Pan-Seared Salmon");
  await ingredientsBox(page).fill("4 salmon fillets\n1 tsp salt");
  await directions(page).fill("Make the herb butter.\nSear the salmon for 5 minutes.");
  // On the first step: Link a recipe beside Directions' Heading.
  await firstStep(page).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  await page.getByRole("button", { name: "Link a recipe" }).nth(1).click();
  await page
    .getByRole("list", { name: "Recipes to link" })
    .getByRole("button", { name: "Herb Butter" })
    .click();
  await expect(linkStrip(page)).toHaveText("This step links to Herb Butter.Unlink");
  await expect(firstStep(page)).toBeFocused();
  await expect(linkedSteps(page)).toHaveText(["Make the herb butter."]);
  // Typing in another step keeps the link (the strip is for the line the cursor is on).
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type(" Serve.");
  await expect(linkStrip(page)).toHaveCount(0);
  await expect(linkedSteps(page)).toHaveText(["Make the herb butter."]);
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
  await page.getByRole("button", { name: "Done" }).first().click();

  // The recipe page: the step's words, then the linked recipe's name, opening it.
  const steps = page.getByRole("region", { name: "Directions" });
  await expect(steps.getByRole("listitem").first()).toContainText(
    "Make the herb butter. Herb Butter",
  );
  await expect(steps.getByRole("link", { name: "Herb Butter" })).toHaveAttribute(
    "href",
    /\/recipes\//,
  );
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Printing brings the step's recipe along, as for an ingredient's link.
  await page.getByRole("link", { name: "Print", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Print: Pan-Seared Salmon and 1 linked recipe" }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "Pan-Seared Salmon" })).toContainText(
    "Make the herb butter. (recipe follows)",
  );
  await expect(page.getByRole("article", { name: "Herb Butter", exact: true })).toContainText(
    "Used in Pan-Seared Salmon",
  );
  await page.getByRole("link", { name: /Back to the recipe/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pan-Seared Salmon" })).toBeVisible();

  // Cook mode: "Cook Herb Butter first" on the step, and back.
  await page.getByRole("link", { name: "Start cooking" }).click();
  if (info.project.name === "phone") {
    await page.getByRole("button", { name: "Start · Step 1 of 2" }).click();
  }
  const first = page.getByRole("region", { name: "Step 1 of 2" });
  await first.getByRole("link", { name: "Cook Herb Butter first" }).click();
  await expect(page.getByRole("region", { name: "You’ll need" })).toContainText(
    "4 Tbsp butter, softened",
  );
  await page.getByRole("link", { name: "Back to Pan-Seared Salmon" }).first().click();
  await expect(page.getByRole("region", { name: "You’ll need" })).toContainText("4 salmon fillets");
  await page.getByRole("link", { name: "Leave cook mode" }).click();

  // The butter can't link back to the salmon through its own ingredient: a circle.
  await steps.getByRole("link", { name: "Herb Butter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Herb Butter" })).toBeVisible();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await ingredientsBox(page).click();
  await page.getByRole("button", { name: "Link a recipe" }).first().click();
  await page.getByLabel(/^Find a recipe to link to/).fill("Salmon");
  await expect(page.getByText("No recipe by that name.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
});
