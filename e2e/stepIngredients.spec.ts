import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editorStatus, quickScale } from "./recipes";
import { useOwnAccount } from "./support";

// U16 (owner's choices 2026-11-04): each step's number opens the ingredients it uses, in a plain
// list under the step. All closed when the recipe opens.

async function noAccessibilityProblems(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const INGREDIENTS = [
  "1 cup all-purpose flour",
  "⅓ cup cocoa powder",
  "½ teaspoon salt",
  "3 large eggs",
  "1 cup sugar, divided",
  "½ cup butter, melted, divided",
  "2 teaspoons vanilla",
  "1 cup grated cheddar",
  "½ cup grated Parmesan",
];

const METHOD = [
  "Whisk the flour, cocoa and salt together in a bowl.",
  "Beat the eggs with ¾ cup of the sugar until pale and thick, about 3 minutes.",
  "Stir in ⅓ cup of the melted butter and the vanilla, then fold in the flour mixture.",
  "Brush the pan with a little of the butter, spread in the batter and sprinkle with the remaining sugar and the cheese. Bake 25 minutes.",
  "Brush the top with the rest of the butter.",
  "Leave to cool.",
];

test("Each step's number opens the ingredients it uses", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Cocoa Squares");
  await page.getByRole("textbox", { name: "Ingredients" }).fill(INGREDIENTS.join("\n"));
  await page.getByRole("textbox", { name: "Method" }).fill(METHOD.join("\n"));
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();

  const method = page.getByRole("region", { name: "Method" });
  const number = (n: number) => method.getByRole("button", { name: `Ingredients for step ${n}` });
  const list = (n: number) => page.locator(`#step-${n}`).getByRole("list");
  await expect(method).toContainText("Tap a step’s number to see the ingredients it uses.");

  // All closed when the recipe opens; a step with nothing found has no button.
  for (const n of [1, 2, 3, 4, 5]) {
    await expect(number(n)).toHaveAttribute("aria-expanded", "false");
  }
  await expect(number(6)).toHaveCount(0);
  await expect(page.locator("#step-6")).toContainText("6");
  await expect(list(1)).toHaveCount(0);

  // Opened and closed by the number.
  await number(1).click();
  await expect(number(1)).toHaveAttribute("aria-expanded", "true");
  await expect(list(1).getByRole("listitem")).toHaveText([
    "1 cup all-purpose flour",
    "⅓ cup cocoa powder",
    "½ teaspoon salt",
  ]);
  await number(1).click();
  await expect(number(1)).toHaveAttribute("aria-expanded", "false");
  await expect(list(1)).toHaveCount(0);

  // And from the keyboard: the step's own amount of a divided line.
  await number(2).focus();
  await page.keyboard.press("Enter");
  await expect(list(2).getByRole("listitem")).toHaveText(["3 large eggs", "¾ cup sugar"]);
  await page.keyboard.press(" ");
  await expect(number(2)).toHaveAttribute("aria-expanded", "false");

  // Show all, then Hide all.
  await method.getByRole("button", { name: "Show all ingredients" }).click();
  for (const n of [1, 2, 3, 4, 5]) {
    await expect(number(n)).toHaveAttribute("aria-expanded", "true");
  }
  await expect(list(4)).toContainText("The remaining ¼ cup sugar");
  await expect(list(4)).toContainText("A little of the butter");
  const cheese = list(4).getByRole("listitem").filter({ hasText: "Cheese" });
  await expect(cheese).toContainText("Not sure which: cheddar or Parmesan");
  await expect(list(5)).toContainText("Some of the ½ cup butter");
  await expect(list(5)).toContainText("Not sure how much: the recipe doesn’t say");
  await expect(list(3)).toContainText("The flour mixture from step 1");
  // A share keeps how it's prepared, never "divided".
  await expect(list(3).getByRole("listitem").first()).toHaveText("⅓ cup butter, melted");
  await noAccessibilityProblems(page);

  // "from step 1" goes back to step 1 and marks it, as a timer's View step does.
  await list(3).getByRole("button", { name: "from step 1" }).click();
  await expect(page.locator("#step-1")).toHaveAttribute("data-flash", "");
  await expect(page.locator("#step-1")).toBeFocused();
  await expect(page.locator("#step-1")).toBeInViewport();
  // Only for now: a tap in a step's words doesn't move focus to the whole step.
  await page.locator("#step-2").getByText("Beat the eggs").click();
  await expect(page.locator("#step-1")).not.toHaveAttribute("tabindex");
  await expect(page.locator("#step-2")).not.toBeFocused();

  await method.getByRole("button", { name: "Hide all ingredients" }).click();
  for (const n of [1, 2, 3, 4, 5]) {
    await expect(number(n)).toHaveAttribute("aria-expanded", "false");
  }

  // Doubled: the list's amounts change with the page's, highlighted like them.
  await quickScale(page, "2×");
  await number(1).click();
  await expect(list(1).locator("mark")).toHaveText(["2 cups", "⅔ cup", "1 teaspoon"]);
  await number(4).click();
  await expect(list(4)).toContainText("The remaining ½ cup sugar");
  await expect(list(4).locator("mark")).toHaveText(["½ cup"]);
  await noAccessibilityProblems(page);

  // Not remembered: opened again, all closed.
  await page.reload();
  await expect(number(1)).toHaveAttribute("aria-expanded", "false");
  await expect(number(4)).toHaveAttribute("aria-expanded", "false");
});

test("A linked recipe shown in place has its own steps' ingredients", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  const ingredientsBox = page.getByRole("textbox", { name: "Ingredients" });

  // The sauce, as its own recipe, with a mixture made in its step 1.
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Lime Crema");
  await ingredientsBox.fill("½ cup sour cream\n2 tablespoons lime juice\n¼ teaspoon salt");
  await page
    .getByRole("textbox", { name: "Method" })
    .fill(
      "Whisk the sour cream and lime juice.\nStir the salt into the sour cream mixture.\nChill.",
    );
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.getByRole("link", { name: "All recipes" }).click();

  // The tacos use it, and have a step 1 of their own.
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Fish Tacos");
  await page.getByRole("textbox", { name: "Method" }).fill("Warm the tortillas.\nAdd the crema.");
  await ingredientsBox.fill("8 corn tortillas\n½ cup lime crema");
  await page.getByRole("button", { name: "Link a recipe" }).click();
  await page
    .getByRole("list", { name: "Recipes to link" })
    .getByRole("button", { name: "Lime Crema" })
    .click();
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();

  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await ingredients.getByRole("button", { name: "Show Lime Crema" }).click();
  const sauce = ingredients.getByRole("region", { name: "Lime Crema" });
  const sauceStep = (n: number) => sauce.locator(`li[id$="-step-${n}"]`);

  await expect(sauce.getByRole("button", { name: "Ingredients for step 3" })).toHaveCount(0);
  await sauce.getByRole("button", { name: "Ingredients for step 2" }).click();
  const list = sauceStep(2).getByRole("list");
  await expect(list.getByRole("listitem")).toHaveText([
    "¼ teaspoon salt",
    "The sour cream mixture from step 1",
  ]);
  await noAccessibilityProblems(page);

  // "from step 1" is the linked recipe's step 1, not the page's own.
  await list.getByRole("button", { name: "from step 1" }).click();
  await expect(sauceStep(1)).toHaveAttribute("data-flash", "");
  await expect(sauceStep(1)).toBeFocused();
  await expect(page.locator("#step-1")).not.toHaveAttribute("data-flash");
});
