import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  chooseInBar,
  countLine,
  filterBar,
  libraryRow,
  premium,
  recipeCard,
  signInElsewhere,
  syncStatus,
  toggleQuick,
} from "./recipes";
import { useOwnAccount } from "./support";

// Phase C13b: saved searches on the recipe list (listed in the left panel since U17; named in
// the list's heading, renamed and saved in place, since U20). The four sample recipes are:
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
/** The list's heading: a saved search's name since U20. */
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** The box that names a saved search in the heading's place (U20). */
const nameBox = (page: Page) => page.getByLabel("Name of this search");
/** "Edited" after a changed saved search's name (U21). */
const editedTag = (page: Page) => page.getByText("Edited", { exact: true });
/** The label above the heading when the list is exactly a saved search. */
const quickLabel = (page: Page) => page.getByText("Quick search", { exact: true });
/** A saved search in the left panel (U17). */
const savedRow = (page: Page, name: string) => libraryRow(page, name);
/** The total time chosen in the filter bar (U22): "30 min", "1 hr", or "Any". */
async function setTime(page: Page, label: string) {
  await chooseInBar(page, "time", label === "Any" ? "Any" : `${label} or less`);
}

/** A chip in the filter bar, by its words ("1 hr or less", "My favorites (added)"). */
const chip = (page: Page, name: string) =>
  filterBar(page).getByRole("button", { name, exact: true });

/**
 * How far under the header's last line something starts: that line is the filter bar's when it
 * shows (U22, a row of its own once a filter is set), else the count line's.
 */
const underHeader = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const bar = document.querySelector('header [role="group"][aria-label="Filters"]');
    const line = bar ?? document.querySelector("header [aria-live=polite]")?.closest("div");
    return el.getBoundingClientRect().top - (line ? line.getBoundingClientRect().bottom : NaN);
  });

/** Saves what the list shows under a name, named in the heading's box. */
async function saveAs(page: Page, name: string) {
  await page.getByRole("button", { name: "Save as quick search" }).click();
  await expect(nameBox(page)).toBeFocused();
  await expect(nameBox(page)).toHaveAttribute("placeholder", "Name this search");
  await nameBox(page).fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(heading(page)).toHaveText(name);
  await expect(heading(page)).toBeFocused();
}

/**
 * Where the recipes start, to check that nothing below the heading moves: under the header's
 * last line, as the filter bar adds its own row when a filter is set (U22).
 */
const resultsTop = (page: Page) => underHeader(page, "#recipe-results");

test("Save a search, use it again, update it, rename it and save it as new", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await expect(heading(page)).toHaveText("All recipes");
  await expect(page.getByText("4 recipes · pick a category on the left")).toBeVisible();
  const top = await resultsTop(page);

  // Nothing to save until the list is narrowed.
  await expect(page.getByRole("button", { name: "Save as quick search" })).toHaveCount(0);

  await toggleQuick(page);
  await expect(titles(page)).toHaveCount(2);
  // With the filter bar, the line under the heading is just the count (U22).
  await expect(countLine(page)).toHaveText("2 recipes");
  await expect(chip(page, "30 min or less")).toBeVisible();
  await saveAs(page, "Quick dinners");
  await expect(savedRow(page, "Quick dinners")).toHaveAttribute("aria-current", "page");
  await expect(quickLabel(page)).toBeVisible();
  await expect(countLine(page)).toHaveText("2 recipes");
  // As saved: no buttons to save it, no Edited tag, a pencil and a ✕ beside the name.
  await expect(page.getByRole("button", { name: /^Update|Save as/ })).toHaveCount(0);
  await expect(editedTag(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rename this search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close this search" })).toBeVisible();
  // Nothing moved: the greeting's line is the label's now.
  expect(await resultsTop(page)).toBe(top);

  // Back to everything; the saved search brings its filters back.
  await toggleQuick(page);
  await expect(titles(page)).toHaveCount(4);
  await expect(heading(page)).toHaveText("All recipes");
  await expect(savedRow(page, "Quick dinners")).not.toHaveAttribute("aria-current", "page");
  await savedRow(page, "Quick dinners").click();
  await expect(titles(page)).toHaveCount(2);
  await expect(page).toHaveURL(/time=30/);
  await expect(heading(page)).toHaveText("Quick dinners");
  await expect(libraryRow(page, "30 minutes or less")).toHaveAttribute("aria-pressed", "true");
  expect(await resultsTop(page)).toBe(top);

  // It is a rule, not a list: it follows the recipes. A reload still has it.
  await page.reload();
  await expect(savedRow(page, "Quick dinners")).toBeVisible();
  await expect(heading(page)).toHaveText("Quick dinners");

  // Change the filters: the name stays the heading, marked Edited, the change is marked on its
  // chip (U22), and no buttons are added to the bar (U21).
  await setTime(page, "1 hr");
  await expect(titles(page)).toHaveCount(3);
  await expect(heading(page)).toHaveText("Quick dinners");
  await expect(quickLabel(page)).toHaveCount(0);
  await expect(editedTag(page)).toBeVisible();
  await expect(countLine(page)).toHaveText("3 recipes");
  await expect(chip(page, "1 hr or less (added)")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Update “|^Save as new/ })).toHaveCount(0);
  expect(await resultsTop(page)).toBe(top);
  // A reload keeps the name: it was the search chosen in this tab.
  await page.reload();
  await expect(heading(page)).toHaveText("Quick dinners");
  // Clicking the name opens the box: Update, Save new quick search and Cancel; Enter updates.
  await heading(page).getByRole("button", { name: "Quick dinners" }).click();
  await expect(nameBox(page)).toBeFocused();
  await expect(nameBox(page)).toHaveValue("Quick dinners");
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save new quick search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  expect(await resultsTop(page)).toBe(top);
  await page.keyboard.press("Enter");
  await expect(quickLabel(page)).toBeVisible();
  await expect(editedTag(page)).toHaveCount(0);
  await expect(heading(page)).toBeFocused();
  await expect(countLine(page)).toHaveText("3 recipes");
  await expect(chip(page, "1 hr or less")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Update/ })).toHaveCount(0);
  await setTime(page, "Any");
  await expect(heading(page)).toHaveText("All recipes");
  await savedRow(page, "Quick dinners").click();
  await expect(titles(page)).toHaveCount(3);

  // Rename in place: the heading becomes a box with the name, and nothing below moves.
  await page.getByRole("button", { name: "Rename this search" }).click();
  await expect(nameBox(page)).toBeFocused();
  await expect(nameBox(page)).toHaveValue("Quick dinners");
  expect(await resultsTop(page)).toBe(top);
  // Escape leaves it as it was, the focus back on the pencil.
  await nameBox(page).fill("Nope");
  await page.keyboard.press("Escape");
  await expect(heading(page)).toHaveText("Quick dinners");
  await expect(page.getByRole("button", { name: "Rename this search" })).toBeFocused();
  await page.getByRole("button", { name: "Rename this search" }).click();
  await nameBox(page).fill("Under an hour");
  await page.keyboard.press("Enter");
  await expect(heading(page)).toHaveText("Under an hour");
  await expect(heading(page)).toBeFocused();
  await expect(savedRow(page, "Under an hour")).toBeVisible();
  await expect(savedRow(page, "Quick dinners")).toHaveCount(0);

  // Save new quick search keeps the saved search as it was and saves the change as another; the
  // name already used takes the next number.
  await setTime(page, "30 min");
  await expect(titles(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Update or save as new" }).click();
  await expect(nameBox(page)).toHaveValue("Under an hour");
  // Escape cancels from the box's buttons too, not only from the box.
  await page.getByRole("button", { name: "Save new quick search" }).focus();
  await page.keyboard.press("Escape");
  await expect(nameBox(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Update or save as new" }).click();
  await expect(nameBox(page)).toHaveValue("Under an hour");
  await page.getByRole("button", { name: "Save new quick search" }).click();
  await expect(heading(page)).toHaveText("Under an hour 2");
  await expect(page.getByText("Saved as “Under an hour 2”.")).toBeAttached();
  await expect(quickLabel(page)).toBeVisible();
  await expect(savedRow(page, "Under an hour 2")).toHaveAttribute("aria-current", "page");
  await savedRow(page, "Under an hour").click();
  await expect(titles(page)).toHaveCount(3);

  // The ✕ closes the search: All recipes, fresh.
  await page.getByRole("button", { name: "Close this search" }).click();
  await expect(heading(page)).toHaveText("All recipes");
  await expect(titles(page)).toHaveCount(4);
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveValue("");
  expect(await resultsTop(page)).toBe(top);

  // Deleted from its line in the left panel; the recipes are all still there.
  await savedRow(page, "Under an hour").hover();
  await page
    .getByRole("button", { name: "Delete the saved search Under an hour", exact: true })
    .click();
  await expect(savedRow(page, "Under an hour")).toHaveCount(0);
  await expect(titles(page)).toHaveCount(4);
});

/** Marks a recipe as a favorite from its page and comes back to the list. */
async function favorite(page: Page, title: string) {
  await recipeCard(page, title).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await page.getByLabel("A favorite of mine").check({ force: true });
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.goto("/");
}

/**
 * Where the heading (or the box naming it), the count line and the first recipe start, to check
 * that nothing moves between lists (U20).
 */
async function positions(page: Page) {
  return page.evaluate(() => {
    const topOf = (el: Element | null) => (el ? el.getBoundingClientRect().top : NaN);
    const header = document.querySelector("header h1, header input")!;
    // The recipes, under the header's last line: the filter bar's when it shows (U22, a row of
    // its own once a filter is set), else the count line's.
    const filterBar = document.querySelector('header [role="group"][aria-label="Filters"]');
    const line = filterBar ?? document.querySelector("header [aria-live=polite]")?.closest("div");
    return {
      heading: topOf(header),
      bar: topOf(document.querySelector("header [aria-live=polite]")),
      card:
        topOf(document.querySelector("#recipe-results [id^=card-title-]")) -
        (line ? line.getBoundingClientRect().bottom : NaN),
    };
  });
}

/** Within a pixel of where they were on All recipes. */
async function expectSteady(page: Page, before: Awaited<ReturnType<typeof positions>>) {
  const now = await positions(page);
  for (const key of ["heading", "bar", "card"] as const) {
    expect(Math.abs(now[key] - before[key]), `${key} moved`).toBeLessThanOrEqual(1);
  }
}

test("The heading names the saved search, nothing moves, and a change is marked (U20)", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await favorite(page, "Black Bean Tacos with Lime Crema");
  await expect(heading(page)).toHaveText("All recipes");
  await expect(countLine(page)).toHaveText(
    "4 recipes · pick a category on the left, or just start typing to search",
  );
  // No number beside the heading any more.
  await expect(page.locator("header h1 + *").filter({ hasText: /^\d+$/ })).toHaveCount(0);
  const before = await positions(page);

  // Save words and a tick line together as one search.
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("lime");
  await toggleQuick(page);
  await expect(titles(page)).toHaveCount(1);
  await saveAs(page, "Weeknight lime");
  await toggleQuick(page);
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("");
  await expect(heading(page)).toHaveText("All recipes");
  await expect(titles(page)).toHaveCount(4);
  await expectSteady(page, before);

  // Clicking it: its name is the heading under QUICK SEARCH, the count line is just the count
  // (the filter bar's chips say what narrows it, U22), and nothing moved.
  await savedRow(page, "Weeknight lime").click();
  await expect(heading(page)).toHaveText("Weeknight lime");
  await expect(quickLabel(page)).toBeVisible();
  await expect(countLine(page)).toHaveText("1 recipe");
  await expect(chip(page, "30 min or less")).toBeVisible();
  await expect(countLine(page).locator("strong")).toHaveText("1 recipe");
  await expectSteady(page, before);

  // A category ends it (its words and filters stay on, as U17's categories do); still nothing
  // moves.
  await libraryRow(page, "Mexican").click();
  await expect(heading(page)).toHaveText("Mexican");
  await expect(quickLabel(page)).toHaveCount(0);
  await expect(countLine(page)).toHaveText("1 recipe");
  await expect(page.getByRole("button", { name: /^Update/ })).toHaveCount(0);
  await expectSteady(page, before);

  // Ticking Favorites changes it: the name stays, the label goes, its chip is marked "+" (in
  // words too, U22), and the name is marked Edited (U21).
  await savedRow(page, "Weeknight lime").click();
  await expect(heading(page)).toHaveText("Weeknight lime");
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("");
  await libraryRow(page, "Favorites").click();
  await expect(titles(page)).toHaveCount(1);
  await expect(heading(page)).toHaveText("Weeknight lime");
  await expect(quickLabel(page)).toHaveCount(0);
  await expect(countLine(page)).toHaveText("1 recipe");
  await expect(chip(page, "My favorites (added)")).toBeVisible();
  await expect(chip(page, "30 min or less")).toBeVisible();
  await expect(editedTag(page)).toBeVisible();
  await expectSteady(page, before);
  // The highlight is readable (contrast) and the page has no accessibility problems.
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Update saves it: after a reload the search gives the new list, and the label is back.
  await page.getByRole("button", { name: "Update or save as new" }).click();
  await expectSteady(page, before);
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(quickLabel(page)).toBeVisible();
  await page.reload();
  await expect(heading(page)).toHaveText("Weeknight lime");
  await page.getByRole("button", { name: "Close this search" }).click();
  await expect(titles(page)).toHaveCount(4);
  await savedRow(page, "Weeknight lime").click();
  await expect(titles(page)).toHaveCount(1);
  await expect(page).toHaveURL(/rating=favorite/);
  await expect(page).not.toHaveURL(/q=lime/);
  await expect(quickLabel(page)).toBeVisible();
  await expect(countLine(page)).toHaveText("1 recipe");
  await expect(chip(page, "My favorites")).toBeVisible();

  // The pencil: nothing below moves while the name is being edited.
  await page.getByRole("button", { name: "Rename this search" }).click();
  await expect(nameBox(page)).toBeFocused();
  await expectSteady(page, before);
  await page.keyboard.press("Escape");
  await expect(heading(page)).toHaveText("Weeknight lime");
});

test("A category picked anywhere ends the saved search; a name box never renames another (U20)", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await toggleQuick(page);
  await saveAs(page, "Quick dinners");
  await page.getByRole("button", { name: "Close this search" }).click();
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("lemon");
  await expect(titles(page)).not.toHaveCount(4);
  await saveAs(page, "Lemon");
  await page.getByRole("button", { name: "Close this search" }).click();
  await expect(titles(page)).toHaveCount(4);

  // A recipe's own category link: the category's list, not the saved search changed.
  await savedRow(page, "Quick dinners").click();
  await expect(heading(page)).toHaveText("Quick dinners");
  await recipeCard(page, "Black Bean Tacos with Lime Crema").getByRole("link").click();
  await page.locator("main").getByRole("link", { name: "Mexican", exact: true }).click();
  await expect(heading(page)).toHaveText("Mexican");
  await expect(page.getByRole("button", { name: "Show all categories" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Update/ })).toHaveCount(0);
  await page.reload();
  await expect(heading(page)).toHaveText("Mexican");
  // Back to the saved search's own list names it again.
  await page.goBack();
  await page.goBack();
  await expect(heading(page)).toHaveText("Quick dinners");
  await expect(quickLabel(page)).toBeVisible();

  // Back from a saved search to a category list from before it: the category's list.
  await libraryRow(page, "Mexican").click();
  await expect(heading(page)).toHaveText("Mexican");
  await savedRow(page, "Lemon").click();
  await expect(heading(page)).toHaveText("Lemon");
  await page.goBack();
  await expect(heading(page)).toHaveText("Mexican");
  await expect(page.getByRole("button", { name: /^Update/ })).toHaveCount(0);

  // A rename box closes when another search is picked, so Save can't rename that one.
  await savedRow(page, "Quick dinners").click();
  await page.getByRole("button", { name: "Rename this search" }).click();
  await nameBox(page).fill("Weeknights");
  await savedRow(page, "Lemon").click();
  await expect(nameBox(page)).toHaveCount(0);
  await expect(heading(page)).toHaveText("Lemon");
  // And when a category is picked, so Save can't make a new search either.
  await page.getByRole("button", { name: "Rename this search" }).click();
  await nameBox(page).fill("Weeknights");
  await libraryRow(page, "Mexican").click();
  await expect(nameBox(page)).toHaveCount(0);
  await expect(heading(page)).toHaveText("Mexican");
  await expect(savedRow(page, "Quick dinners")).toBeVisible();
  await expect(savedRow(page, "Lemon")).toBeVisible();
  await expect(savedRow(page, "Weeknights")).toHaveCount(0);
});

test("A long name on two lines: renaming it moves nothing below (U20)", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await toggleQuick(page);
  const long = "Weeknight dinners for the whole family in under thirty mins";
  await saveAs(page, long);
  // Two lines of the heading, so the box (one line) has a taller row to keep.
  const lineHeight = await heading(page).evaluate((el) =>
    parseFloat(getComputedStyle(el).lineHeight),
  );
  expect(await heading(page).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(
    lineHeight * 1.5,
  );
  const before = await positions(page);
  const barBefore = before.bar;
  await page.getByRole("button", { name: "Rename this search" }).click();
  await expect(nameBox(page)).toBeFocused();
  const during = await positions(page);
  expect(Math.abs(during.bar - barBefore), "bar moved").toBeLessThanOrEqual(1);
  expect(Math.abs(during.card - before.card), "card moved").toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(heading(page)).toHaveText(long);
  const after = await positions(page);
  expect(Math.abs(after.bar - barBefore), "bar moved back").toBeLessThanOrEqual(1);
});

test("A name can't be empty or used twice, and says why", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await toggleQuick(page);
  await saveAs(page, "Quick");
  await page.getByRole("button", { name: "Close this search" }).click();
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("lemon");
  await saveAs(page, "Lemon");

  // Changed, its box offers Update (which renames too) and Save new quick search (U21).
  await setTime(page, "1 hr");
  await page.getByRole("button", { name: "Update or save as new" }).click();
  await expect(nameBox(page)).toHaveValue("Lemon");
  await nameBox(page).fill("");
  await page.getByRole("button", { name: "Save new quick search" }).click();
  await expect(page.getByText("Give it a name of up to 60 letters.")).toHaveAttribute(
    "role",
    "alert",
  );
  await nameBox(page).fill("  quick ");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  const problem = page.getByText("You already have a saved search with that name.");
  await expect(problem).toHaveAttribute("role", "alert");
  // The box stays open to try another name, and says what's wrong.
  await expect(nameBox(page)).toHaveAttribute("aria-invalid", "true");
  // Save new quick search with a name already used takes the next number.
  await nameBox(page).fill("Quick");
  await page.getByRole("button", { name: "Save new quick search" }).click();
  await expect(heading(page)).toHaveText("Quick 2");
  await expect(page.getByText("Saved as “Quick 2”.")).toBeAttached();
  await expect(problem).toHaveCount(0);
  await expect(savedRow(page, "Lemon")).toBeVisible();
  // A name already ending in a number counts on from it: "Quick 3", never "Quick 2 2".
  await setTime(page, "30 min");
  await page.getByRole("button", { name: "Update or save as new" }).click();
  await expect(nameBox(page)).toHaveValue("Quick 2");
  await page.getByRole("button", { name: "Save new quick search" }).click();
  await expect(heading(page)).toHaveText("Quick 3");
  await expect(page.getByText("Saved as “Quick 3”.")).toBeAttached();

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
  await page.getByRole("button", { name: "Rename this search" }).click();
  await nameBox(page).fill("Nope");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/only be changed with a connection/)).toHaveAttribute(
    "role",
    "alert",
  );
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
