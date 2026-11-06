import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  barMenu,
  chooseInBar,
  countLine,
  filterBar,
  filtersButton,
  library,
  libraryRow,
  openBarMenu,
  openFilters,
  recipeCard,
  showCategory,
  syncStatus,
  toggleQuick,
} from "./recipes";
import { useOwnAccount } from "./support";

// U22: on a computer, Filters is a bar of small chips under the list's heading (owner's choices
// 2026-11-06): what is set as chips with a menu and an ✕, the groups not set after them (or
// folded into "+ Add filter"), never more than two lines ("+N more"), Clear all at the top
// right. A phone keeps its Filters sheet. The four sample recipes are:
//   Green Chile Stew (Mexican, Soups; 125 min; serves 6; from Nana; has cumin)
//   Buttermilk Pancakes (Breakfast; 30 min; serves 4; has nutrition)
//   Black Bean Tacos with Lime Crema (Mexican, Diet › Vegetarian; 30 min; serves 4)
//   Lemon Olive Oil Cake (Desserts › Cakes; 60 min; serves 10)

test.skip(({ isMobile }) => isMobile, "A phone keeps the Filters sheet (checked at the end)");

async function addSamples(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sample recipes to try/ }).click();
  await expect(recipeCard(page, "Lemon Olive Oil Cake")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
}

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const titles = (page: Page) =>
  page.getByRole("region", { name: /^\d+ recipes?$/ }).locator("[id^=card-title-]");

/** Everything in the bar's row of chips: set chips, groups not set, + Add filter, +N more. */
const chips = (page: Page) => filterBar(page).locator("[data-chips] > *");

/** A chip's button by its words for screen readers ("45 min or less", "With lime (added)"). */
const chip = (page: Page, name: string) =>
  filterBar(page).getByRole("button", { name, exact: true });

/** Waits for the browser to lay out and paint what just changed. */
const painted = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** How many lines of chips the bar shows. */
async function lines(page: Page) {
  await painted(page);
  return chips(page).evaluateAll(
    (all) => new Set(all.map((e) => Math.round(e.getBoundingClientRect().top))).size,
  );
}

/** Where the first recipe card starts on the page. */
async function cardsTop(page: Page) {
  await painted(page);
  return page
    .locator("#recipe-results [id^=card-title-]")
    .first()
    .evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
}

/** Whether the bar and the page both fit across the window, with nothing cut off to the side. */
const fitsAcross = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('header [role="group"][aria-label="Filters"]');
    const row = bar?.querySelector<HTMLElement>("[data-chips]");
    const page = document.documentElement;
    return (
      !!bar &&
      !!row &&
      bar.scrollWidth <= bar.clientWidth &&
      row.scrollWidth <= row.clientWidth &&
      page.scrollWidth <= page.clientWidth
    );
  });

/** The mockup's six filters (bar-1024.png and the others): a category the samples have. */
const SIX =
  "/?time=45&made=old&with=Demerara%20brown%20sugar&without=fresh%20cilantro&also=mexican&photo=1";

test("Filters shows the bar, a choice makes a chip, its ✕ and Clear all take filters away", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  const bar = filterBar(page);
  const button = filtersButton(page);

  // Nothing set: Filters shows the groups, each with its menu, and hides them again.
  await expect(bar).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveAttribute("aria-controls", (await bar.getAttribute("id"))!);
  await expect(chips(page)).toHaveText([
    "Time",
    "Rating",
    "Last made",
    "Serves",
    "Ingredients",
    "Categories",
    "More",
  ]);
  // The count line still says what the list is when nothing is set.
  await expect(countLine(page)).toContainText("4 recipes");
  await button.click();
  await expect(bar).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-expanded", "false");

  // Escape closes a group's menu and goes back to its chip.
  await button.click();
  const time = chip(page, "Time");
  await time.click();
  await expect(time).toHaveAttribute("aria-expanded", "true");
  await expect(barMenu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(barMenu(page)).toHaveCount(0);
  await expect(time).toBeFocused();

  // 45 minutes or less: a chip saying so, the list narrowed, the line under the heading just
  // the count, and Filters counting it.
  await chooseInBar(page, "time", "45 min or less");
  await expect(chip(page, "45 min or less")).toBeVisible();
  await expect(chips(page).first()).toHaveText("45 min or less");
  await expect(titles(page)).toHaveText([
    "Black Bean Tacos with Lime Crema",
    "Buttermilk Pancakes",
  ]);
  await expect(countLine(page)).toHaveText("2 recipes");
  await expect(filtersButton(page, 1)).toBeVisible();
  await expect(page).toHaveURL(/time=45/);
  // Its ✕ takes it away; the bar stays where it was pressed open, showing the groups.
  await bar.getByRole("button", { name: "Remove 45 min or less" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page).not.toHaveURL(/time=/);
  await expect(chip(page, "Time")).toBeVisible();

  // Ingredients: each word its own chip, the whole words in its title and its name.
  let menu = await openBarMenu(page, "ingredients");
  const withBox = menu.getByRole("textbox", { name: "With these ingredients" });
  await withBox.fill("Demerara brown sugar");
  await withBox.press("Enter");
  await expect(withBox).toHaveValue("");
  await expect(menu.getByText("Demerara brown sugar", { exact: true })).toBeVisible();
  await expect(countLine(page)).toHaveText("0 recipes");
  // The chips wait while the menu is open.
  await expect(bar.getByRole("button", { name: /^With / })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const demerara = chip(page, "With Demerara brown sugar");
  await expect(demerara).toBeVisible();
  await expect(demerara).toHaveAttribute("title", "With Demerara brown sugar");
  await expect(demerara).toHaveText(/With\s*Demerara brown sugar/);
  menu = await openBarMenu(page, "ingredients");
  await menu.getByRole("textbox", { name: "With these ingredients" }).fill("lime");
  await menu.getByRole("textbox", { name: "With these ingredients" }).press("Enter");
  await page.keyboard.press("Escape");
  await expect(bar.getByRole("button", { name: /^With / })).toHaveText([
    /With\s*Demerara brown sugar/,
    /With\s*lime/,
  ]);
  await bar.getByRole("button", { name: "Remove With Demerara brown sugar" }).click();
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
  await expect(bar.getByRole("button", { name: /^With / })).toHaveText([/With\s*lime/]);

  // Clear all takes every filter but the category (and the search words).
  await showCategory(page, "Mexican");
  await chooseInBar(page, "time", "30 min or less");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema"]);
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("tacos");
  await bar.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mexican");
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveValue("tacos");
  await expect(bar.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(page).not.toHaveURL(/time=|with=/);
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("");
  await expect(titles(page)).toHaveText(["Black Bean Tacos with Lime Crema", "Green Chile Stew"]);
});

test("Never more than two lines, nothing cut off at the side, and the cards move only for a new line", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  const bar = filterBar(page);
  const folds = bar
    .getByRole("button", { name: "Add filter" })
    .or(bar.getByRole("button", { name: /^\d+ more filters?$/ }));

  // A small computer window with the mockup's six filters: two lines at most, folded.
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(SIX);
  await expect(chip(page, "45 min or less")).toBeVisible();
  expect(await lines(page)).toBeLessThanOrEqual(2);
  await expect(folds.first()).toBeVisible();
  expect(await fitsAcross(page)).toBe(true);
  // The chip that folds the rest opens its menu; Escape goes back to it.
  const fold = folds.first();
  await fold.click();
  await expect(barMenu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(barMenu(page)).toHaveCount(0);
  await expect(fold).toBeFocused();

  // A big window: no folding into "+N more". The list keeps today's width (the laptop look,
  // U23, may widen it), so the six take two lines there too; three take one.
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect(chip(page, "45 min or less")).toBeVisible();
  await expect(bar.getByRole("button", { name: /^\d+ more filters?$/ })).toHaveCount(0);
  expect(await lines(page)).toBeLessThanOrEqual(2);
  expect(await fitsAcross(page)).toBe(true);
  for (const name of [
    "45 min or less",
    "Not made in the last 90 days",
    "With Demerara brown sugar",
    "Without fresh cilantro",
    "Also in Mexican",
    "Has a photo",
  ]) {
    await expect(chip(page, name)).toBeVisible();
  }
  await page.goto("/?time=45&with=Demerara%20brown%20sugar&photo=1");
  await expect(chip(page, "With Demerara brown sugar")).toBeVisible();
  expect(await lines(page)).toBe(1);
  expect(await fitsAcross(page)).toBe(true);

  // The cards move down by one row only when the bar gains a line; ingredients nobody has
  // keep every recipe in the list, so there are always cards to measure.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?without=quince");
  await expect(chip(page, "Without quince")).toBeVisible();
  await expect(titles(page)).toHaveCount(4);
  let before = { lines: await lines(page), top: await cardsTop(page) };
  expect(before.lines).toBe(1);
  let grew = 0;
  for (const word of [
    "smoked paprika paste",
    "pomegranate molasses",
    "preserved lemon rind",
    "black garlic cloves",
    "candied angelica",
    "sumac berries",
  ]) {
    const menu = await openBarMenu(page, "ingredients");
    const box = menu.getByRole("textbox", { name: "Without these ingredients" });
    await box.fill(word);
    await box.press("Enter");
    // While the menu is open nothing moves.
    expect(await cardsTop(page)).toBe(before.top);
    await page.keyboard.press("Escape");
    await expect(
      chip(page, `Without ${word}`)
        .or(bar.getByRole("button", { name: /more/ }))
        .first(),
    ).toBeVisible();
    const now = { lines: await lines(page), top: await cardsTop(page) };
    expect(now.lines).toBeLessThanOrEqual(2);
    if (now.lines === before.lines) expect(Math.abs(now.top - before.top)).toBeLessThanOrEqual(1);
    else {
      expect(now.lines).toBe(before.lines + 1);
      // One row of chips: 26px tall with an 8px gap.
      expect(now.top - before.top).toBeGreaterThan(28);
      expect(now.top - before.top).toBeLessThan(40);
      grew++;
    }
    before = now;
  }
  expect(grew).toBe(1);
  expect(await fitsAcross(page)).toBe(true);
});

test("Add to quick searches from a menu, the changed saved search's chip, and accessibility", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  const bar = filterBar(page);

  // The Time menu adds its choice to the left panel's quick searches.
  await chooseInBar(page, "time", "45 min or less");
  let menu = await openBarMenu(page, "time");
  await expect(menu.getByRole("menuitemradio", { name: "45 min or less" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const add = menu.getByRole("button", { name: /quick searches: 45 minutes or less$/ });
  await expect(add).toHaveText(/Add to quick searches$/);
  await add.click();
  await expect(add).toHaveAttribute("aria-pressed", "true");
  await expect(libraryRow(page, "45 minutes or less")).toBeVisible();
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Clear all" }).click();
  await expect(titles(page)).toHaveCount(4);

  // A saved search changed from the bar: the filter added since shows "+" and a dashed edge,
  // and says "(added)" to screen readers.
  await toggleQuick(page);
  await page.getByRole("button", { name: "Save as quick search" }).click();
  await page.getByLabel("Name of this search").fill("Quick dinners");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quick dinners");
  await expect(chip(page, "30 min or less")).toBeVisible();
  menu = await openBarMenu(page, "ingredients");
  await menu.getByRole("textbox", { name: "With these ingredients" }).fill("lime");
  await menu.getByRole("textbox", { name: "With these ingredients" }).press("Enter");
  await page.keyboard.press("Escape");
  const added = chip(page, "With lime (added)");
  await expect(added).toBeVisible();
  await expect(added).toHaveText(/^\+\s*With\s*lime/);
  expect(await added.evaluate((e) => getComputedStyle(e.closest("[data-chip]")!).borderStyle)).toBe(
    "dashed",
  );
  // The saved search's own filter isn't marked.
  await expect(chip(page, "30 min or less")).toBeVisible();
  await expect(page.getByText("Edited", { exact: true })).toBeVisible();
  await expect(countLine(page)).toHaveText("1 recipe");

  // No accessibility problems with a menu open, nor with the bar alone.
  menu = await openBarMenu(page, "ingredients");
  await expect(menu.getByText("lime", { exact: true })).toBeVisible();
  await noAccessibilityProblems(page);
  await page.keyboard.press("Escape");
  await openBarMenu(page, "time");
  await noAccessibilityProblems(page);
  await page.keyboard.press("Escape");
  await noAccessibilityProblems(page);
});

test("The focus is never lost, a click right after a change lands, and the bar goes once filters go elsewhere", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  const bar = filterBar(page);
  await chooseInBar(page, "time", "45 min or less");
  await chooseInBar(page, "serves", "6 or more");

  // Tab out of a menu carries on through the bar: past its last item to what follows its chip.
  await chip(page, "45 min or less").click();
  await expect(barMenu(page)).toBeVisible();
  for (let i = 0; i < 4 && (await barMenu(page).count()) > 0; i++) await page.keyboard.press("Tab");
  await expect(barMenu(page)).toHaveCount(0);
  const removeTime = bar.getByRole("button", { name: "Remove 45 min or less" });
  await expect(removeTime).toBeFocused();
  // Shift+Tab from its first item goes back to its chip.
  await chip(page, "Serves 6 or more").click();
  await expect(barMenu(page)).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(barMenu(page)).toHaveCount(0);
  await expect(chip(page, "Serves 6 or more")).toBeFocused();

  // A chip's ✕ by keyboard: the focus goes on to the next chip.
  await removeTime.focus();
  await page.keyboard.press("Enter");
  await expect(chip(page, "45 min or less")).toHaveCount(0);
  await expect(chip(page, "Serves 6 or more")).toBeFocused();

  // A word added while the menu is open makes a chip when it closes, which moves the others;
  // the click that closes it still opens the chip it was meant for.
  const menu = await openBarMenu(page, "ingredients");
  await menu.getByRole("textbox", { name: "With these ingredients" }).fill("cumin");
  await menu.getByRole("textbox", { name: "With these ingredients" }).press("Enter");
  await chip(page, "Rating").click();
  await expect(chip(page, "Rating")).toHaveAttribute("aria-expanded", "true");
  await expect(barMenu(page).getByRole("menuitemradio", { name: "Any" })).toBeVisible();
  await expect(chip(page, "With cumin")).toBeVisible();
  await page.keyboard.press("Escape");

  // Emptied from the bar, it stays; filters set and taken away elsewhere take it away.
  await bar.getByRole("button", { name: "Clear all" }).click();
  await expect(chip(page, "Time")).toBeVisible();
  await toggleQuick(page);
  await expect(chip(page, "30 min or less")).toBeVisible();
  await toggleQuick(page);
  await expect(bar).toHaveCount(0);
});

test("A phone-sized window keeps the Filters sheet, with no bar", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await addSamples(page);
  await page.setViewportSize({ width: 412, height: 860 });
  await expect(library(page)).toBeHidden();
  const sheet = await openFilters(page);
  await expect(sheet.getByRole("group", { name: "Total time, up to" })).toBeVisible();
  await expect(filterBar(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Back to a computer's width, the bar is what Filters shows.
  await page.setViewportSize({ width: 1280, height: 860 });
  await filtersButton(page).click();
  await expect(filterBar(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
});
