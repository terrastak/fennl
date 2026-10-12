import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { keys } from "./keys";
import { premium, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase E4: importing a saved web page and reviewing the draft before it's saved: the page
// beside the draft, what to check, quick fixes, photos, categories, and duplicates. On a
// computer and a phone, and with the keyboard alone.

/**
 * The page copy's frame is left out: it runs no scripts, so axe can't be put inside it (trying
 * sometimes closes the test's browser page). Its title is checked below instead.
 */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .exclude("iframe")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** Imports one of the test set's saved pages from the Import page; lands on its review. */
async function importSavedPage(page: Page, file: string) {
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.locator('input[type="file"]').setInputFiles(`test_pages/${file}`);
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Review the import" })).toBeVisible();
}

const ingredients = (page: Page) => page.getByRole("textbox", { name: "Ingredients" });
const method = (page: Page) => page.getByRole("textbox", { name: "Method" });

test("review a web page's recipe, fix it, and save it", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  await useOwnAccount(context, baseURL!);
  await importSavedPage(page, "tasteofhome-big-soft-ginger-cookies.html");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Big Soft Ginger Cookies");

  // The page beside the draft; on a phone it folds away under a button.
  const source = page.getByRole("region", { name: "The original page" });
  const frame = source.locator("iframe");
  if (testInfo.project.name === "phone") {
    await expect(frame).toBeHidden();
    await source.getByRole("button", { name: "Show the original page" }).click();
  }
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(frame).toHaveAttribute("title", "Recipe card from tasteofhome.com");
  await expect(
    page.frameLocator('iframe[title^="Recipe card"]').getByText("3/4 cup butter, softened"),
  ).toBeVisible();
  await expect(source.getByRole("link", { name: /Open tasteofhome\.com/ })).toHaveAttribute(
    "href",
    /tasteofhome\.com/,
  );
  await expectAccessible(page);

  // Tidy fractions and temperatures, and undo it.
  await expect(ingredients(page)).toHaveValue(/^3\/4 cup butter, softened/);
  await page.getByRole("button", { name: "Tidy fractions and temperatures" }).click();
  await expect(ingredients(page)).toHaveValue(/^¾ cup butter, softened/);
  await expect(ingredients(page)).toHaveValue(/2¼ cups all-purpose flour/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(ingredients(page)).toHaveValue(/^3\/4 cup butter, softened/);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(ingredients(page)).toHaveValue(/^¾ cup butter, softened/);

  // Free: the page's photo isn't imported, and the person is told.
  await expect(page.getByText(/Photos come with Premium/)).toBeVisible();

  // A category, then save: the recipe page.
  await page.getByRole("combobox", { name: "Add a category" }).fill("Cookies");
  await page.getByRole("option", { name: "New category: Cookies" }).click();
  await expect(page.getByRole("list", { name: "Categories to file it under" })).toContainText(
    "Cookies",
  );
  await page.getByRole("button", { name: "Save recipe" }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Big Soft Ginger Cookies" }),
  ).toBeVisible();
  await expect(page.getByText("¾ cup butter, softened")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cookies" })).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  // Nothing waits on the Import page any more.
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Waiting for review" })).toHaveCount(0);

  // The same page again: it's a duplicate. Updating shows exactly what would change.
  await importSavedPage(page, "tasteofhome-big-soft-ginger-cookies.html");
  const duplicates = page.getByRole("region", {
    name: "This looks like a recipe you already have",
  });
  await expect(duplicates).toContainText(/Big Soft Ginger Cookies.*\(imported from this page\)/);
  await duplicates.getByLabel("Update “Big Soft Ginger Cookies” with what’s here").check();
  await expect(duplicates.getByRole("heading", { name: "What would change" })).toBeVisible();
  await expect(duplicates).toContainText("Ingredients:");
  await expectAccessible(page);

  // Or not import it at all.
  await duplicates.getByLabel("Don’t import it").check();
  await page.getByRole("button", { name: "Don’t import" }).first().click();
  await expect(page).toHaveURL("/import");
  await expect(page.getByRole("heading", { name: "Waiting for review" })).toHaveCount(0);
});

test("lines can move between the lists and the draft be discarded", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await importSavedPage(page, "bonappetit-coconut-cream-pie.html");
  // What the importer wasn't sure of is pointed out.
  const check = page.getByRole("region", { name: "Worth checking" });
  await expect(check).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Ingredients, as Fennl reads them" }).getByText("Worth a look"),
  ).not.toHaveCount(0);
  // Diet labels from the page come as categories.
  await expect(page.getByRole("list", { name: "Categories to file it under" })).toContainText(
    "Diet › Vegetarian",
  );

  // The last ingredient ("A 9" deep pie dish…") is equipment: move it to the method.
  const box = ingredients(page);
  await box.click();
  await page.keyboard.press(keys.textEnd);
  await page.getByRole("button", { name: "Move to method" }).click();
  await expect(box).not.toHaveValue(/deep pie dish/);
  await expect(method(page)).toHaveValue(/A 9" deep pie dish; a candy thermometer$/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(box).toHaveValue(/deep pie dish/);

  // Discarding removes the draft.
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL("/import");
  await expect(page.getByRole("heading", { name: "Waiting for review" })).toHaveCount(0);
});

test("the review can be done with the keyboard alone", async ({ page, context, baseURL }) => {
  test.skip(test.info().project.name === "phone", "Keyboard use is checked on the computer layout");
  await useOwnAccount(context, baseURL!);
  await importSavedPage(page, "tasteofhome-big-soft-ginger-cookies.html");

  // From the title box, Tab reaches the next fields in order. The line buttons work on the
  // line the cursor is on, so they're reached with Shift+Tab from the box.
  await page.getByLabel("Title", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("About this recipe")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(ingredients(page)).toBeFocused();
  await page.keyboard.press(keys.textStart);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Move to method" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ingredients(page)).not.toHaveValue(/^3\/4 cup butter/);
  await expect(method(page)).toHaveValue(/3\/4 cup butter, softened$/);
  await expect(ingredients(page)).toBeFocused();

  // Save with the keyboard.
  await page.getByRole("button", { name: "Save recipe" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Big Soft Ginger Cookies" }),
  ).toBeVisible();
});

test("Premium: choose the page's photos to keep, and the cover", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  // The page's photos are on other sites; here they come from the test images instead.
  const photos = ["Image_bread.png", "Image_chocchip.png", "Image_carbonara.png"];
  await page.route(/\/api\/import\/jobs\/[0-9a-f-]+\/inputs\/(\d+)$/, async (route) => {
    const input = Number(/inputs\/(\d+)$/.exec(route.request().url())?.[1]);
    await route.fulfill({ path: `test_images/${photos[(input - 1) % photos.length]}` });
  });
  await importSavedPage(page, "bakefromscratch-flourless-chocolate-cake.html");
  const section = page.getByRole("region", { name: "Photos" });
  await expect(section.getByRole("img")).toHaveCount(3);
  await expectAccessible(page);

  // Keep the first and third, the third as the cover.
  await section.getByLabel("Keep photo 2").uncheck();
  await section.getByRole("radio", { name: "Cover" }).nth(2).check();
  await page.getByRole("button", { name: "Save recipe" }).first().click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Flourless Chocolate Cake with Roasted Strawberries",
    }),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Open the photo of .* full screen$/ }).click();
  await expect(page.getByRole("dialog").getByText("1 of 2")).toBeVisible();
});
