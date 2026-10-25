import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { adjust, recipeCard, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase F5: cook mode.

test("Cook a recipe one step at a time, with timers, check-offs and Made it", async ({
  page,
  context,
  baseURL,
}) => {
  await page.clock.install();
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Buttermilk Pancakes")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("link", { name: /Buttermilk Pancakes/ }).click();
  // Doubled on the recipe page: cook mode uses the same amounts.
  await adjust(page, (panel) => panel.getByRole("button", { name: "2×" }).click());
  await page.getByRole("link", { name: "Start cooking" }).click();

  // First, everything to get ready.
  await expect(page.getByRole("heading", { level: 1, name: "Get everything ready" })).toBeFocused();
  await expect(page.getByText("Doubled", { exact: true })).toBeVisible();
  await page.getByLabel("4 large eggs").check();
  await expect(page.getByText(/Screen stays on|keep the screen on|Auto-Lock/)).toBeVisible();
  await expect(page.getByLabel("Keep the screen on")).toBeChecked();

  // Step 1, with the ingredients it uses beside it, doubled.
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step 1 of 5" })).toBeFocused();
  const forStep = page.getByRole("complementary", { name: "For this step" });
  await expect(forStep).toContainText("4 cups all-purpose flour");
  await expect(forStep).toContainText("1/4 cup sugar");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // The keyboard moves between steps.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { level: 1, name: "Step 2 of 5" })).toBeFocused();
  await page.getByLabel("Done with this step").check();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { level: 1, name: "Step 5 of 5" })).toBeVisible();

  // A time in the step starts a timer; two run at once.
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

  // Check-offs stay on this device for the day, until cleared.
  await page.reload();
  await expect(page.getByLabel("4 large eggs")).toBeChecked();
  await page.getByRole("button", { name: "Clear all checks" }).click();
  await expect(page.getByLabel("4 large eggs")).not.toBeChecked();

  // At the end: Made it today.
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: /^(Start|Next)$/ }).click();
  await page.getByRole("button", { name: "Made it today" }).click();
  await expect(page.getByText("Saved: made today.")).toBeVisible();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Buttermilk Pancakes" })).toBeVisible();
  await expect(page.getByText(/Last made today/)).toBeVisible();
});
