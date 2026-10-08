import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import {
  addRecipe,
  editorStatus,
  premium,
  recipeCard,
  signInElsewhere,
  syncStatus,
} from "./recipes";
import { useOwnAccount } from "./support";

// Phase C6: the recipe editor, and your own rating, favorite and note.

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const ingredientsBox = (page: Page) => page.getByRole("textbox", { name: "Ingredients" });
const methodBox = (page: Page) => page.getByRole("textbox", { name: "Method" });

test("A whole recipe written with the keyboard alone", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  const key = page.keyboard;

  await page.getByRole("button", { name: "Add recipe" }).focus();
  await key.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "New recipe" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await expect(editorStatus(page)).toHaveText("Give it a title to save it");
  await key.type("Green Chile Stew");
  await expect(editorStatus(page)).toHaveText("All changes saved");

  await key.press("Tab");
  await expect(page.getByLabel("About this recipe")).toBeFocused();
  await key.type("June's, from the church cookbook.");

  // Ingredients: one per line. A heading is recognised; a line moves with Alt+↑ and goes
  // with an ordinary delete.
  await key.press("Tab");
  await expect(ingredientsBox(page)).toBeFocused();
  await key.type("For the stew:\n2 lb pork shoulder\n1 onion\n4 cloves garlic\n1 cup beer");
  await key.press("Alt+ArrowUp");
  await key.press("Alt+ArrowUp");
  await expect(ingredientsBox(page)).toHaveValue(
    "For the stew:\n2 lb pork shoulder\n1 cup beer\n1 onion\n4 cloves garlic",
  );
  // The cursor stayed on the moved line: take it out again.
  await key.press("End");
  await key.press("Shift+Home");
  await key.press("Backspace");
  await key.press("Backspace");
  await expect(ingredientsBox(page)).toHaveValue(
    "For the stew:\n2 lb pork shoulder\n1 onion\n4 cloves garlic",
  );
  const ingredientsPreview = page.getByRole("group", { name: "Ingredients, as Fennl reads them" });
  await expect(ingredientsPreview.getByRole("listitem")).toHaveText([
    "Heading: For the stew:",
    "2 lb pork shoulder",
    "1 onion",
    "4 cloves garlic",
  ]);

  // Method: steps, then the heading button for a line Fennl didn't read as a heading.
  await key.press("Tab");
  await expect(methodBox(page)).toBeFocused();
  await key.type(
    "1. Brown the pork.\n2. Add onion and garlic; simmer 2 hours.\nServing\nTop with cilantro.",
  );
  await key.press("ArrowUp");
  await key.press("Shift+Tab");
  const heading = page.getByRole("button", { name: "Heading" }).nth(1);
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAttribute("aria-pressed", "false");
  await key.press("Space");
  await expect(methodBox(page)).toBeFocused();
  await expect(heading).toHaveAttribute("aria-pressed", "true");
  const methodPreview = page.getByRole("group", { name: "Method, as Fennl reads them" });
  await expect(methodPreview.getByRole("listitem")).toHaveText([
    "1.Brown the pork.",
    "2.Add onion and garlic; simmer 2 hours.",
    "Heading: Serving",
    "3.Top with cilantro.",
  ]);

  // A category, made by typing its name (phase C7).
  await key.press("Tab");
  await expect(page.getByRole("combobox", { name: "Add a category" })).toBeFocused();
  await key.type("Mexican");
  await key.press("Enter");
  await expect(page.getByRole("list", { name: "This recipe's categories" })).toContainText(
    "Mexican",
  );
  await key.press("Tab");
  await expect(page.getByRole("button", { name: "Undo", exact: true }).last()).toBeFocused();
  await key.press("Tab");
  await expect(page.getByLabel("Prep time")).toBeFocused();
  await key.type("20");
  await key.press("Tab");
  await key.type("2 hours");
  await key.press("Tab");
  await key.type("2 hr 20 min");
  await key.press("Tab");
  await expect(page.getByLabel("Prep time")).toHaveValue("20 min");
  await expect(page.getByLabel("Cook time")).toHaveValue("2 hr");
  await expect(page.getByLabel("Serves")).toBeFocused();
  await key.type("6");
  await key.press("Tab");
  await key.press("Tab");
  await expect(page.getByLabel("Difficulty")).toBeFocused();
  await key.press("e"); // Easy
  await key.press("Tab");
  await expect(page.getByLabel("Source")).toBeFocused();
  await key.press("p"); // Person
  await key.press("Tab");
  await expect(page.getByLabel("Whose recipe")).toBeFocused();
  await key.type("June Holloway");
  await key.press("Tab");
  await expect(page.getByLabel("Notes")).toBeFocused();
  await key.type("Better the next day.");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await noAccessibilityProblems(page);

  await key.press("Tab");
  await expect(page.getByRole("button", { name: "Done" }).last()).toBeFocused();
  await key.press("Enter");

  // The recipe page shows all of it.
  await expect(page.getByRole("heading", { level: 1, name: "Green Chile Stew" })).toBeVisible();
  await expect(page.getByText("June's, from the church cookbook.")).toBeVisible();
  await expect(page.getByText("June Holloway")).toBeVisible();
  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await expect(ingredients.getByRole("heading", { name: "For the stew:" })).toBeVisible();
  await expect(ingredients.getByRole("listitem")).toHaveText([
    "2 lb pork shoulder",
    "1 onion",
    "4 cloves garlic",
  ]);
  const method = page.getByRole("region", { name: "Method" });
  await expect(method.getByRole("heading", { name: "Serving" })).toBeVisible();
  await expect(method.locator("ol").last()).toHaveAttribute("start", "3");
  await expect(page.getByText("2 hr 20 min")).toBeVisible();
  await expect(page.getByText("Serves 6")).toBeVisible();
  await expect(page.getByText("Easy")).toBeVisible();
  await expect(page.getByText("Better the next day.")).toBeVisible();
});

test("Undo and redo go back and forward one save at a time", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Pozole");
  await page.getByRole("link", { name: /Pozole/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  await expect(undo).toBeDisabled();

  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Pozole rojo");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByLabel("Notes").fill("Hominy from the can is fine.");
  await expect(editorStatus(page)).toHaveText("All changes saved");

  await undo.click();
  await expect(page.getByLabel("Notes")).toHaveValue("");
  await expect(title).toHaveValue("Pozole rojo");
  await undo.click();
  await expect(title).toHaveValue("Pozole");
  await expect(undo).toBeDisabled();
  await redo.click();
  await expect(title).toHaveValue("Pozole rojo");
  await expect(editorStatus(page)).toHaveText("All changes saved");

  // What undo left is what's saved.
  await page.reload();
  await expect(title).toHaveValue("Pozole rojo");
  await expect(page.getByLabel("Notes")).toHaveValue("");
});

test("A problem holds back only its own field", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Birria");
  await page.getByRole("link", { name: /Birria/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();

  await page.getByLabel("Source").selectOption({ label: "Website" });
  const address = page.getByLabel("Web address");
  await address.fill("http://");
  await page.getByLabel("Notes").fill("Use guajillo and ancho.");
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("This doesn't look like a web address.")).toBeVisible();
  await expect(editorStatus(page)).toHaveText("Fix the marked fields to save them");

  // Done points at the problem instead of leaving.
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(address).toBeFocused();

  await address.fill("example.com/birria");
  await address.blur();
  await expect(address).toHaveValue("https://example.com/birria");
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("link", { name: "example.com" })).toBeVisible();
  await expect(page.getByText("Use guajillo and ancho.")).toBeVisible();
});

test("Premium: a typo fixed on the phone shows on the laptop", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Tamales de rajsa");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  const phone = await signInElsewhere(browser, baseURL!, email, devices["iPhone 13"]);
  await phone.getByRole("link", { name: /Tamales de rajsa/ }).click();
  await phone.getByRole("link", { name: "Edit recipe" }).click();
  await phone.getByLabel("Title", { exact: true }).fill("Tamales de rajas");
  await expect(editorStatus(phone)).toHaveText("All changes saved");
  await noAccessibilityProblems(phone);
  await phone.getByRole("button", { name: "Done" }).first().click();
  await expect(phone.getByRole("heading", { level: 1, name: "Tamales de rajas" })).toBeVisible();
  await expect(syncStatus(phone)).toHaveText("Saved to cloud");
  await phone.context().close();

  await page.reload();
  await expect(recipeCard(page, "Tamales de rajas")).toBeVisible();
});

test("Your rating, favorite and note are kept, and only you set them", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Capirotada");
  await page.getByRole("link", { name: /Capirotada/ }).click();

  const yours = page.getByRole("region", { name: "Yours" });
  await expect(yours.getByRole("radio", { name: "No rating" })).toBeChecked();
  await yours.getByRole("radio", { name: "4 stars" }).focus();
  await page.keyboard.press("Space");
  await expect(yours.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(yours.getByRole("radio", { name: "5 stars" })).toBeChecked();
  await yours.getByLabel("A favorite of mine").check();
  await yours.getByLabel("Your note").fill("Mom's, with extra raisins.");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await noAccessibilityProblems(page);

  await page.reload();
  await expect(yours.getByRole("radio", { name: "5 stars" })).toBeChecked();
  await expect(yours.getByLabel("A favorite of mine")).toBeChecked();
  await expect(yours.getByLabel("Your note")).toHaveValue("Mom's, with extra raisins.");
  // And taken back.
  await yours.getByRole("radio", { name: "No rating" }).focus();
  await page.keyboard.press("Space");
  await expect(yours.getByRole("radio", { name: "No rating" })).toBeChecked();
});

test("Free: editing pauses offline, and what was typed saves when the connection is back", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Arroz rojo");
  await page.getByRole("link", { name: /Arroz rojo/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  await page.getByLabel("Notes").fill("Toast the rice first.");
  await context.setOffline(true);
  await expect(page.getByText("Editing is paused until this device is back online.")).toBeVisible();
  await expect(page.getByLabel("Notes")).toBeDisabled();

  await context.setOffline(false);
  await expect(page.getByLabel("Notes")).toBeEnabled({ timeout: 15_000 });
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await expect(syncStatus(page)).toHaveText("Saved to cloud", { timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel("Notes")).toHaveValue("Toast the rice first.");
});
