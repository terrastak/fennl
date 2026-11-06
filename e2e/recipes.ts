import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { PASSWORD, makeCode, useFreshAddress } from "./support";

// Helpers for browser tests that work with recipes (phases C4 to C6).

/** Premium from a code, as beta testers have it. */
export async function premium(context: BrowserContext, baseURL: string) {
  const code = await makeCode(context.request, {
    tier: "individual",
    days: 30,
    allowsSignUp: false,
  });
  const used = await context.request.post("/api/codes/redeem", {
    headers: { origin: baseURL },
    data: { code },
  });
  expect(used.ok()).toBe(true);
}

/** The sync status in the app's frame (the sidebar's or the top bar's, whichever shows). */
export const syncStatus = (page: Page) =>
  page.locator("[data-sync-status]").filter({ visible: true });

/** A recipe's card in the list. */
export const recipeCard = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ hasText: title });

/** The editor's saving status ("All changes saved"). */
export const editorStatus = (page: Page) => page.locator("[data-editor-status]");

/** Adds a recipe with just a title, from the recipe list, and comes back to the list. */
export async function addRecipe(page: Page, title: string) {
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await page.getByRole("link", { name: "← All recipes" }).click();
  await expect(recipeCard(page, title)).toBeVisible();
}

/** The same account signed in on another device (its own browser storage). */
export async function signInElsewhere(
  browser: Browser,
  baseURL: string,
  email: string,
  device: Record<string, unknown> = {},
): Promise<Page> {
  const context = await browser.newContext({
    ...device,
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  await useFreshAddress(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
  return page;
}

/**
 * On a recipe's page: opens "Adjust" (amount, another pan, units; phase F1, owner's choice
 * 2026-10-24), does `act` there, then closes it with "Done".
 */
/** One of the quick amounts at the top of the ingredients: "½×", "As written", "2×" or "3×". */
export async function quickScale(page: Page, name: string) {
  await page
    .getByRole("region", { name: "Ingredients" })
    .getByRole("group", { name: "Amount" })
    .getByRole("button", { name, exact: true })
    .click();
}

export async function adjust(page: Page, act: (panel: Locator) => Promise<unknown>) {
  await page.getByRole("button", { name: "Adjust" }).click();
  const panel = page.getByRole("dialog", { name: "Adjust this recipe" });
  await expect(panel).toBeVisible();
  await act(panel);
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toBeHidden();
}

/** Chooses something from the recipe list's ⋯ menu (U13, U21): Select recipes…, Print these, Surprise me, Find duplicates (and Trash on a phone). */
export async function fromListMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "More actions" }).click();
  const menu = page.getByRole("list", { name: "More actions" });
  await menu
    .getByRole("button", { name: item, exact: true })
    .or(menu.getByRole("link", { name: item, exact: true }))
    .click();
}

/**
 * The button that opens the Filters panel: "Filters" in the list's bar on a computer (called
 * "More filters" from U17 to U21), and beside the search box on a phone; `on` is how many filters
 * it says are on.
 */
export const filtersButton = (page: Page, on = 0) =>
  page.getByRole("button", {
    name: new RegExp(`^Filters${on ? ` ${on} on` : ""}$`),
  });

/** Opens the recipe list's Filters panel (U13). */
export async function openFilters(page: Page) {
  await page.getByRole("button", { name: /^Filters/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await expect(panel).toBeVisible();
  return panel;
}

/** Takes off every filter in the Filters panel and closes it. */
export async function clearFilters(page: Page) {
  const panel = await openFilters(page);
  await panel.getByRole("button", { name: "Clear filters" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}

/** The recipe box in the left panel (U17), shown on a computer. */
export const library = (page: Page) => page.getByRole("navigation", { name: "Recipe box" });

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A row of the left panel by its name, whatever its count ("Mexican, 2 recipes"). */
export const libraryRow = (page: Page, name: string) =>
  library(page)
    .getByRole("link", { name: new RegExp(`^${escaped(name)}(\\s*,|$)`) })
    .or(library(page).getByRole("button", { name: new RegExp(`^${escaped(name)}(\\s*,|$)`) }));

/** The sheet with every category, from "All categories" on a phone (U17). */
export const categorySheet = (page: Page) => page.getByRole("dialog", { name: "Categories" });

/**
 * Shows one category's recipes: from the left panel on a computer, from the sheet "All
 * categories" opens on a phone (`path` is its full name, "Diet › Vegetarian", to open the
 * categories it's inside).
 */
export async function showCategory(page: Page, name: string, path = name) {
  if (await library(page).isVisible()) await libraryRow(page, name).click();
  else {
    await page.getByRole("button", { name: "All categories", exact: true }).click();
    const sheet = categorySheet(page);
    for (const outer of path.split(" › ").slice(0, -1)) {
      const show = sheet.getByRole("button", { name: `Show what's in ${outer}` });
      if (await show.isVisible()) await show.click();
    }
    await sheet.getByRole("link", { name: new RegExp(`^${escaped(name)}(\\s*,|$)`) }).click();
    await expect(sheet).toBeHidden();
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(path.split(" › ").at(-1)!);
}

/** Turns "30 minutes or less" on or off: the left panel's switch, or the Filters panel's time. */
export async function toggleQuick(page: Page) {
  if (await library(page).isVisible()) {
    await libraryRow(page, "30 minutes or less").click();
    return;
  }
  const panel = await openFilters(page);
  const group = panel.getByRole("group", { name: "Total time, up to" });
  const on = await group
    .getByRole("button", { name: "30 min", exact: true })
    .getAttribute("aria-pressed");
  await group.getByRole("button", { name: on === "true" ? "Any" : "30 min", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}

/** The left panel's categories, top to bottom, by name (U17). */
export const panelCategories = (page: Page) =>
  library(page).locator("[data-cat-key] [class*=name]");

/**
 * Drags a category in the left panel with the mouse, stopping over another's top edge, middle
 * or bottom edge (the mouse stays pressed: `page.mouse.up()` drops it).
 */
export async function dragCategory(
  page: Page,
  from: string,
  to: string,
  where: "top" | "middle" | "bottom",
  /** How far right (or left, below 0) the mouse ends up from where it picked the row up. */
  across = 0,
): Promise<void> {
  // Saving can change the status line's length above the panel, moving the list.
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const start = await libraryRow(page, from).boundingBox();
  if (!start) throw new Error(`${from} isn't showing`);
  const x = start.x + start.width / 2;
  await page.mouse.move(x, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, start.y + start.height / 2 + 8, { steps: 3 });
  // The lifted row shows once the drag has started.
  await expect(page.locator("[data-drag-lifted]")).toBeVisible();
  // Measured once the drag has started and the list has settled (the hint pushes it down).
  let target = await libraryRow(page, to).boundingBox();
  for (let tries = 0; tries < 20; tries++) {
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const now = await libraryRow(page, to).boundingBox();
    if (now && target && now.y === target.y) break;
    target = now;
  }
  if (!target) throw new Error(`${to} isn't showing`);
  const y =
    where === "top"
      ? target.y + 2
      : where === "bottom"
        ? target.y + target.height - 2
        : target.y + target.height / 2;
  await page.mouse.move(x + across, y, { steps: 6 });
}
