import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { premium, recipeCard, signInElsewhere, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase C13b: saved searches on the recipe list. The four sample recipes are:
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
const saved = (page: Page) => page.getByRole("region", { name: "Saved searches" });
const chooser = (page: Page) => saved(page).getByRole("combobox", { name: /^Saved searches/ });
const timeBox = (page: Page) =>
  page.getByRole("region", { name: "More filters" }).getByRole("combobox", { name: /^Time/ });

/** Opens the filters panel, unless a saved search already opened it. */
async function openFilters(page: Page) {
  const toggle = page.getByRole("button", { name: /^Filters/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.getByRole("region", { name: "More filters" })).toBeVisible();
}

/** Saves what the list shows under a name. */
async function saveAs(page: Page, name: string) {
  await saved(page).getByRole("button", { name: "Save this search" }).click();
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
  await expect(saved(page).getByRole("button", { name: "Save this search" })).toHaveCount(0);

  await openFilters(page);
  await timeBox(page).selectOption("30");
  await expect(titles(page)).toHaveCount(2);
  await saveAs(page, "Quick dinners");
  await expect(chooser(page)).toHaveValue(/.+/);

  // Back to everything; the saved search brings its filters back.
  await page.getByRole("button", { name: "Show all recipes" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(chooser(page)).toHaveValue("");
  await chooser(page).selectOption({ label: "Quick dinners" });
  await expect(titles(page)).toHaveCount(2);
  await expect(page).toHaveURL(/time=30/);
  await expect(page.getByRole("button", { name: "30 minutes or less" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // It is a rule, not a list: it follows the recipes. A reload still has it.
  await page.reload();
  await expect(chooser(page).getByRole("option", { name: "Quick dinners" })).toBeAttached();

  // Change the filters; the saved search can be updated to match.
  await chooser(page).selectOption({ label: "Quick dinners" });
  await openFilters(page);
  await timeBox(page).selectOption("60");
  await expect(titles(page)).toHaveCount(3);
  await saved(page).getByRole("button", { name: "Update “Quick dinners”" }).click();
  await expect(saved(page).getByText("Updated “Quick dinners”.")).toBeVisible();
  await page.getByRole("button", { name: "Show all recipes" }).click();
  await chooser(page).selectOption({ label: "Quick dinners" });
  await expect(titles(page)).toHaveCount(3);

  // Rename.
  await saved(page).getByRole("button", { name: "Rename" }).click();
  await saved(page).getByLabel("New name").fill("Under an hour");
  await saved(page).getByRole("button", { name: "Rename", exact: true }).last().click();
  await expect(saved(page).getByText("Renamed to “Under an hour”.")).toBeVisible();
  await expect(chooser(page).getByRole("option", { name: "Under an hour" })).toBeAttached();
  await expect(chooser(page).getByRole("option", { name: "Quick dinners" })).toHaveCount(0);

  // Remove, after being asked.
  await saved(page).getByRole("button", { name: "Remove" }).click();
  await expect(saved(page).getByText("Your recipes aren’t touched.")).toBeVisible();
  await saved(page).getByRole("button", { name: "Keep it" }).click();
  await expect(chooser(page).getByRole("option", { name: "Under an hour" })).toBeAttached();
  await saved(page).getByRole("button", { name: "Remove" }).click();
  await saved(page).getByRole("button", { name: "Remove", exact: true }).last().click();
  await expect(saved(page).getByText("Removed “Under an hour”.")).toBeVisible();
  await expect(chooser(page)).toHaveCount(0);
  // The recipes are all still there.
  await page.getByRole("button", { name: "Show all recipes" }).click();
  await expect(titles(page)).toHaveCount(4);
});

test("A name can't be used twice, and says why", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await openFilters(page);
  await timeBox(page).selectOption("30");
  await saveAs(page, "Quick");

  await timeBox(page).selectOption("60");
  await saved(page).getByRole("button", { name: "Save this search" }).click();
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
  await openFilters(page);
  await timeBox(page).selectOption("30");
  await saveAs(page, "Quick dinners");

  // Another device has it after signing in.
  const phone = await signInElsewhere(browser, baseURL!, email);
  await expect(chooser(phone).getByRole("option", { name: "Quick dinners" })).toBeAttached();
  await chooser(phone).selectOption({ label: "Quick dinners" });
  await phone.getByRole("button", { name: /^Filters/ }).waitFor();
  await expect(phone).toHaveURL(/time=30/);
  await phone.context().close();

  // With no connection the list is still there, but changing it says it needs one.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(syncStatus(page)).toHaveText("Offline");
  await expect(chooser(page).getByRole("option", { name: "Quick dinners" })).toBeAttached();
  await chooser(page).selectOption({ label: "Quick dinners" });
  await expect(titles(page)).toHaveCount(2);
  await saved(page).getByRole("button", { name: "Rename" }).click();
  await saved(page).getByLabel("New name").fill("Nope");
  await saved(page).getByRole("button", { name: "Rename", exact: true }).last().click();
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
  await openFilters(page);
  await timeBox(page).selectOption("30");
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
  await expect(saved(theirPage).getByRole("option", { name: "Mine only" })).toHaveCount(0);
  const theirs = await theirPage.request.get("/api/saved-searches");
  expect(await theirs.json()).toEqual({ searches: [] });
  await other.close();
});
