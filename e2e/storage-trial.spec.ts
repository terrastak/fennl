import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Phase C2: the browser storage trial page. The real measurements come from the owner's own
// phone and computer; this checks the page works end to end in Chromium, with a small count.
test.use({ storageState: { cookies: [], origins: [] } });

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("saves, searches and keeps test recipes, one tab at a time", async ({ page, context }) => {
  await page.goto("/storage-trial?count=300");
  await expect(page.getByRole("heading", { level: 1, name: "Recipe storage test" })).toBeVisible();
  const run = page.getByRole("button", { name: "Run the test: 300 recipes" });
  await expect(run).toBeEnabled({ timeout: 20_000 });
  await expectAccessible(page);

  await run.click();
  const report = page.getByRole("region", { name: "Results" });
  await expect(report).toContainText("Wrote 300 recipes", { timeout: 60_000 });
  await expect(report).toContainText("Search chicken:");
  // Accents don't matter: "jalapeno" finds "jalapeño".
  await expect(report).toContainText(/Search jalapeno: .*\((?!0 )[\d,]+ matches\)/);
  await expect(report).toContainText("Open one recipe:");
  await expectAccessible(page);

  // They survive reloading the page.
  await page.reload();
  await expect(page.getByText("Found 300 test recipes saved from an earlier run")).toBeVisible({
    timeout: 20_000,
  });

  // A second tab can't open it while the first has it; it can once the first is closed.
  const second = await context.newPage();
  await second.goto("/storage-trial?count=300");
  await expect(second.getByRole("alert")).toContainText("Another tab has the test open", {
    timeout: 20_000,
  });
  await page.close();
  await second.getByRole("button", { name: "Try again" }).click();
  await expect(second.getByText("Found 300 test recipes")).toBeVisible({ timeout: 20_000 });

  await second.getByRole("button", { name: "Delete the test recipes" }).click();
  await expect(second.getByRole("button", { name: "Run the test: 300 recipes" })).toBeEnabled({
    timeout: 20_000,
  });
  await expect(second.getByText("saved from an earlier run")).toHaveCount(0);
});
