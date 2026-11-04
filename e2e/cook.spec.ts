import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editorStatus, recipeCard, syncStatus, quickScale } from "./recipes";
import { useOwnAccount } from "./support";

// Phase F5, made simpler in U8 (owner's choices 2026-10-27): cook mode.

async function noAccessibilityProblems(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** The pancakes, doubled on the recipe page, opened in cook mode. */
async function startCooking(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Buttermilk Pancakes")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  // Doubled on the recipe page: cook mode uses the same amounts.
  await quickScale(page, "2×");
  await page.getByRole("link", { name: "Start cooking" }).click();
}

test("On a computer: the ingredients beside two steps, two steps at a time", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== "desktop", "The wide layout");
  // Just before midnight, so the timers below run past it: where you are mustn't be lost then.
  const late = new Date();
  late.setHours(23, 58, 30, 0);
  await page.clock.install({ time: late });
  await useOwnAccount(context, baseURL!);
  await startCooking(page);

  await expect(page.getByRole("heading", { level: 1, name: "Steps 1–2 of 5" })).toBeFocused();
  await expect(page.getByText("Doubled", { exact: true })).toBeVisible();
  const need = page.getByRole("region", { name: "You’ll need" });
  await expect(need).toContainText("4 large eggs");
  const step1 = page.getByRole("region", { name: "Step 1 of 5" });
  await expect(step1).toContainText("Uses");
  await expect(step1).toContainText("4 cups all-purpose flour");
  await expect(page.getByRole("region", { name: "Step 2 of 5" })).toBeVisible();
  // Nothing to tick off, and the screen is kept on without a switch.
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "‹ Back" })).toBeDisabled();
  await noAccessibilityProblems(page);

  // Two steps at a time; the ingredients stay.
  await page.getByRole("button", { name: "Next · Steps 3–4 ›" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Steps 3–4 of 5" })).toBeFocused();
  await expect(need).toContainText("4 large eggs");
  await expect(page.getByRole("button", { name: "‹ Back · Steps 1–2" })).toBeEnabled();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { level: 1, name: "Step 5 of 5" })).toBeFocused();

  // A time in the step starts a timer; two run at once, at the top.
  await page.getByRole("button", { name: "Start a 2 minutes timer" }).click();
  await page.getByRole("button", { name: "Start a 1 minute timer" }).click();
  const timers = page.getByRole("region", { name: "Timers" });
  await expect(timers.getByRole("listitem")).toHaveCount(2);
  await expect(timers.getByRole("listitem").first()).toContainText("2:00");
  await page.clock.fastForward("01:05");
  await expect(timers.getByRole("listitem").nth(1)).toContainText("Done!");
  await expect(timers.getByRole("listitem").first()).toContainText(/0:5\d/);
  await timers.getByRole("button", { name: "Dismiss" }).click();
  await expect(timers.getByRole("listitem")).toHaveCount(1);

  // Where you are is kept on this device (even past midnight).
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Step 5 of 5" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { level: 1, name: "Steps 3–4 of 5" })).toBeVisible();
  // A timer's View step goes back to the step that started it.
  await page.getByRole("button", { name: "Timer", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Timers" })
    .getByRole("button", { name: /^View step/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Step 5 of 5" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The last button: done, and made today, in one tap.
  await page.getByRole("button", { name: "Done · I made it today" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Buttermilk Pancakes" })).toBeVisible();
  await expect(page.getByText(/Last made today/)).toBeVisible();
});

test("On a phone: what you'll need, then one step per screen", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== "phone", "The phone layout");
  await useOwnAccount(context, baseURL!);
  await startCooking(page);

  await expect(page.getByRole("heading", { level: 1, name: "You’ll need" })).toBeFocused();
  await expect(page.getByText("4 large eggs")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
  await noAccessibilityProblems(page);

  await page.getByRole("button", { name: "Start · Step 1 of 5" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step 1 of 5" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Step 1 of 5" })).toContainText(
    "4 cups all-purpose flour",
  );
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step 2 of 5" })).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step 1 of 5" })).toBeFocused();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step 5 of 5" })).toBeFocused();
  await noAccessibilityProblems(page);

  // Closing without marking it made leaves "last made" as it was.
  await expect(page.getByRole("button", { name: "Done · I made it today" })).toBeVisible();
  await page.getByRole("button", { name: "Close without marking it made" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Buttermilk Pancakes" })).toBeVisible();
  await expect(page.getByText(/Last made today/)).toHaveCount(0);
  // Finished: the next time starts from the beginning.
  await page.getByRole("link", { name: "Start cooking" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "You’ll need" })).toBeFocused();
});

test("Each step's ingredients: the rest worked out, the mixture's step, and doubts in words (U16)", async ({
  page,
  context,
  baseURL,
}, info) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Sugared Cheese Shortbread");
  await page
    .getByRole("textbox", { name: "Ingredients" })
    .fill(
      "1 cup sugar, divided\n2 cups flour\n1 tsp salt\n1/2 cup butter\n1 cup shredded cheddar cheese\n1/2 cup grated Parmesan cheese",
    );
  await page
    .getByRole("textbox", { name: "Method" })
    .fill(
      "Whisk the flour and salt.\nBeat the butter with 3/4 cup of the sugar. Add the flour mixture.\nSprinkle with the remaining sugar and the cheese.",
    );
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sugared Cheese Shortbread" }),
  ).toBeVisible();
  await quickScale(page, "2×");
  await page.getByRole("link", { name: "Start cooking" }).click();

  const step = (n: number) => page.getByRole("region", { name: `Step ${n} of 3` });
  if (info.project.name === "phone") {
    await page.getByRole("button", { name: "Start · Step 1 of 3" }).click();
    await page.getByRole("button", { name: "Next step" }).click();
  }
  // The step's own amount, doubled as the step shows it, and the mixture it made before.
  await expect(step(2)).toContainText(
    "Uses 1 cup butter · 1 1/2 cups sugar · the flour mixture from step 1",
  );
  if (info.project.name === "phone") await page.getByRole("button", { name: "Next step" }).click();
  else await page.getByRole("button", { name: /^Next/ }).click();
  // What's left of the sugar, worked out and doubled; which cheese, said in words.
  await expect(step(3)).toContainText("the remaining ½ cup sugar");
  await expect(step(3)).toContainText("cheese (not sure which: cheddar or Parmesan)");
  await noAccessibilityProblems(page);
});
