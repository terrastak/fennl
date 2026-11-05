import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  libraryRow,
  openFilters,
  premium,
  recipeCard,
  signInElsewhere,
  syncStatus,
  toggleQuick,
} from "./recipes";
import { useOwnAccount } from "./support";

// Phase C13b: saved searches on the recipe list (listed in the left panel since U17). The four sample recipes are:
//   Green Chile Stew (125 min), Buttermilk Pancakes (30), Black Bean Tacos with Lime Crema (30),
//   Lemon Olive Oil Cake (60).

async function addSamples(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
}

const titles = (page: Page) =>
  page.getByRole("region", { name: /^\d+ recipes?$/ }).locator("[id^=card-title-]");
/** The form for a name, and what happened, under the list's header. */
const saved = (page: Page) => page.getByRole("region", { name: "Saved searches" });
/** A saved search in the left panel (U17). */
const savedRow = (page: Page, name: string) => libraryRow(page, name);
/** The total time chosen in the Filters panel ("30 min", "1 hr", or "Any"). */
async function setTime(page: Page, label: string) {
  const panel = await openFilters(page);
  await panel
    .getByRole("group", { name: "Total time, up to" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}

/** Saves what the list shows under a name. */
async function saveAs(page: Page, name: string) {
  await page.getByRole("button", { name: "Save as quick search" }).click();
  await saved(page).getByLabel("Name this search").fill(name);
  await saved(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(saved(page).getByText(`Saved “${name}”.`)).toBeVisible();
}

test("Save a search, use it again, update it, rename it and remove it", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);

  // Nothing to save until the list is narrowed.
  await expect(page.getByRole("button", { name: "Save as quick search" })).toHaveCount(0);

  await toggleQuick(page);
  await expect(titles(page)).toHaveCount(2);
  await saveAs(page, "Quick dinners");
  await expect(savedRow(page, "Quick dinners")).toHaveAttribute("aria-current", "page");

  // Back to everything; the saved search brings its filters back.
  await toggleQuick(page);
  await expect(titles(page)).toHaveCount(4);
  await expect(savedRow(page, "Quick dinners")).not.toHaveAttribute("aria-current", "page");
  await savedRow(page, "Quick dinners").click();
  await expect(titles(page)).toHaveCount(2);
  await expect(page).toHaveURL(/time=30/);
  await expect(libraryRow(page, "30 minutes or less")).toHaveAttribute("aria-pressed", "true");

  // It is a rule, not a list: it follows the recipes. A reload still has it.
  await page.reload();
  await expect(savedRow(page, "Quick dinners")).toBeVisible();

  // Change the filters; the saved search can be updated to match.
  await savedRow(page, "Quick dinners").click();
  await setTime(page, "1 hr");
  await expect(titles(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Update “Quick dinners”" }).click();
  await expect(saved(page).getByText("Updated “Quick dinners”.")).toBeVisible();
  await setTime(page, "Any");
  await savedRow(page, "Quick dinners").click();
  await expect(titles(page)).toHaveCount(3);

  // Rename.
  await page.getByRole("button", { name: "Rename “Quick dinners”" }).click();
  await saved(page).getByLabel("New name").fill("Under an hour");
  await saved(page).getByRole("button", { name: "Rename", exact: true }).click();
  await expect(saved(page).getByText("Renamed to “Under an hour”.")).toBeVisible();
  await expect(savedRow(page, "Under an hour")).toBeVisible();
  await expect(savedRow(page, "Quick dinners")).toHaveCount(0);

  // Remove, after being asked.
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(saved(page).getByText("Your recipes aren’t touched.")).toBeVisible();
  await saved(page).getByRole("button", { name: "Keep it" }).click();
  await expect(savedRow(page, "Under an hour")).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await saved(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(saved(page).getByText("Removed “Under an hour”.")).toBeVisible();
  await expect(savedRow(page, "Under an hour")).toHaveCount(0);
  // The recipes are all still there.
  await setTime(page, "Any");
  await expect(titles(page)).toHaveCount(4);
});

test("A name can't be used twice, and says why", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await toggleQuick(page);
  await saveAs(page, "Quick");

  await setTime(page, "1 hr");
  await page.getByRole("button", { name: "Save as quick search" }).click();
  await saved(page).getByLabel("Name this search").fill("  quick ");
  await saved(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(saved(page).getByRole("alert")).toHaveText(
    "You already have a saved search with that name.",
  );
  // The form stays open to try another name.
  await saved(page).getByLabel("Name this search").fill("Under an hour");
  await saved(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(saved(page).getByText("Saved “Under an hour”.")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("Premium: saved searches are on another device, and show with no connection", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await addSamples(page);
  await toggleQuick(page);
  await saveAs(page, "Quick dinners");

  // Another device has it after signing in.
  const phone = await signInElsewhere(browser, baseURL!, email);
  await savedRow(phone, "Quick dinners").click();
  await expect(libraryRow(phone, "30 minutes or less")).toHaveAttribute("aria-pressed", "true");
  await expect(phone).toHaveURL(/time=30/);
  await phone.context().close();

  // With no connection the list is still there, but changing it says it needs one.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(syncStatus(page)).toHaveText("Offline");
  await savedRow(page, "Quick dinners").click();
  await expect(titles(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Rename “Quick dinners”" }).click();
  await saved(page).getByLabel("New name").fill("Nope");
  await saved(page).getByRole("button", { name: "Rename", exact: true }).click();
  await expect(saved(page).getByRole("alert")).toContainText("only be changed with a connection");
  await context.setOffline(false);
});

test("Another person's saved searches are never shown", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await toggleQuick(page);
  await saveAs(page, "Mine only");

  // Someone else with their own account sees nothing of it.
  const other = await browser.newContext({
    baseURL: baseURL!,
    storageState: { cookies: [], origins: [] },
  });
  const theirPage = await other.newPage();
  await useOwnAccount(other, baseURL!);
  await theirPage.goto("/");
  await theirPage.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(theirPage, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(savedRow(theirPage, "Mine only")).toHaveCount(0);
  const theirs = await theirPage.request.get("/api/saved-searches");
  expect(await theirs.json()).toEqual({ searches: [] });
  await other.close();
});
