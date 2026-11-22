import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { keys } from "./keys";
import {
  addRecipe,
  DRAFT_SAVED,
  directionsText,
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
const methodBox = (page: Page) => page.getByRole("textbox", { name: "Directions" });
// On a laptop (U27) a box for each step; the words of each, in order.
const stepWords = (page: Page) => page.locator('section[data-list="directions"] [data-step-words]');

test("A whole recipe written with the keyboard alone", async ({ page, context, baseURL }, info) => {
  // On a laptop (U27) the editor is paired rows: time and servings come before the lines, then
  // categories, notes, where it's from and nutrition; Move to Trash is in the bar.
  const laptop = info.project.name === "desktop";
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  const key = page.keyboard;

  await page.getByRole("button", { name: "Add recipe" }).focus();
  await key.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "New recipe" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  // Nothing typed yet: nothing kept (U27 part 3).
  await expect(editorStatus(page)).toHaveText("No changes yet");
  await key.type("Green Chile Stew");
  await expect(editorStatus(page)).toHaveText("Draft saved");

  await key.press("Tab");
  await expect(page.getByLabel("About this recipe")).toBeFocused();
  await key.type("June's, from the church cookbook.");

  const timesAndServings = async () => {
    await expect(page.getByLabel("Prep time")).toBeFocused();
    await key.type("20");
    await key.press("Tab");
    await key.type("2 hours");
    await key.press("Tab");
    await key.type("2 hr 20 min");
    await key.press("Tab");
    await expect(page.getByLabel("Prep time")).toHaveValue("20 min");
    await expect(page.getByLabel("Cook time")).toHaveValue("2 hr");
    // One box for how many it serves or makes (U27).
    await expect(page.getByLabel("Serves or makes")).toBeFocused();
    await key.type("6");
    await key.press("Tab");
    await expect(page.getByLabel("Difficulty")).toBeFocused();
    await key.press("e"); // Easy
  };
  const whereFrom = async () => {
    await expect(page.getByLabel("Source")).toBeFocused();
    await key.press("p"); // Person
    await key.press("Tab");
    await expect(page.getByLabel("Whose recipe")).toBeFocused();
    await key.type("June Holloway");
  };
  const notes = async () => {
    await expect(page.getByLabel("Notes")).toBeFocused();
    await key.type("Better the next day.");
  };

  if (laptop) {
    await key.press("Tab");
    await timesAndServings();
    // Past the photos (what they offer depends on the plan), to Ingredients.
    for (let i = 0; i < 6; i++) {
      await key.press("Tab");
      if (await ingredientsBox(page).evaluate((el) => el === document.activeElement)) break;
    }
  } else {
    await key.press("Tab");
  }

  // Ingredients: one per line. A heading is recognised; a line moves with Alt+↑ and goes
  // with an ordinary delete.
  await expect(ingredientsBox(page)).toBeFocused();
  await key.type("For the stew:\n2 lb pork shoulder\n1 onion\n4 cloves garlic\n1 cup beer");
  await key.press("Alt+ArrowUp");
  await key.press("Alt+ArrowUp");
  await expect(ingredientsBox(page)).toHaveValue(
    "For the stew:\n2 lb pork shoulder\n1 cup beer\n1 onion\n4 cloves garlic",
  );
  // The cursor stayed on the moved line: take it out again.
  await key.press(keys.lineEnd);
  await key.press(keys.selectToLineStart);
  await key.press("Backspace");
  await key.press("Backspace");
  await expect(ingredientsBox(page)).toHaveValue(
    "For the stew:\n2 lb pork shoulder\n1 onion\n4 cloves garlic",
  );
  const ingredientsPreview = page.getByRole("group", { name: "Ingredients, as Fennl reads them" });
  const ingredientsRead = [
    "Heading: For the stew:",
    "2 lb pork shoulder",
    "1 onion",
    "4 cloves garlic",
  ];
  if (!laptop) await expect(ingredientsPreview.getByRole("listitem")).toHaveText(ingredientsRead);

  // Directions: steps, then the heading button for a line Fennl didn't read as a heading.
  await key.press("Tab");
  await expect(methodBox(page)).toBeFocused();
  await key.type(
    "1. Brown the pork.\n2. Add onion and garlic; simmer 2 hours.\nServing\nTop with cilantro.",
  );
  await key.press("ArrowUp");
  // Back past Link a recipe (U27: steps link to recipes too) to Heading.
  await key.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Link a recipe" }).nth(1)).toBeFocused();
  await key.press("Shift+Tab");
  const heading = page.getByRole("button", { name: "Heading" }).nth(1);
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAttribute("aria-pressed", "false");
  await key.press("Space");
  // On a laptop (U27) each step is its own box, and a heading's box says so.
  await expect(
    laptop ? page.getByRole("textbox", { name: "Heading, Serving" }) : methodBox(page),
  ).toBeFocused();
  await expect(heading).toHaveAttribute("aria-pressed", "true");
  const methodPreview = page.getByRole("group", { name: "Directions, as Fennl reads them" });
  if (laptop) {
    // How Fennl reads it is a button at the end of the hint (U27): the read-out under each box.
    await key.press("Tab");
    const reads = page.getByRole("button", { name: "How Fennl reads it" });
    await expect(reads).toBeFocused();
    await expect(reads).toHaveAttribute("aria-pressed", "false");
    await expect(methodPreview).toHaveCount(0);
    await key.press("Space");
    await expect(reads).toHaveAttribute("aria-pressed", "true");
    await expect(ingredientsPreview.getByRole("listitem")).toHaveText(ingredientsRead);
  }
  await expect(methodPreview.getByRole("listitem")).toHaveText([
    "1.Brown the pork.",
    "2.Add onion and garlic; simmer 2 hours.",
    "Heading: Serving",
    "3.Top with cilantro.",
  ]);

  // A category, made by typing its name (phase C7); on a laptop in the flyout from "+ Add a
  // category" (U27), which Escape closes, back on its button.
  await key.press("Tab");
  if (laptop) {
    const addCategory = page.getByRole("button", { name: "Add a category" });
    await expect(addCategory).toBeFocused();
    await key.press("Enter");
    await expect(page.getByRole("combobox", { name: "Find or add a category" })).toBeFocused();
  } else {
    await expect(page.getByRole("combobox", { name: "Add a category" })).toBeFocused();
  }
  await key.type("Mexican");
  await key.press("Enter");
  await expect(page.getByRole("list", { name: "This recipe's categories" })).toContainText(
    "Mexican",
  );
  if (laptop) {
    await key.press("Escape");
    await expect(page.getByRole("button", { name: "Add a category" })).toBeFocused();
  }
  // Into the draft: no "Added to" bar of its own (the editor's Undo takes it back).
  await key.press("Tab");
  if (laptop) {
    await notes();
    await key.press("Tab");
    await whereFrom();
  } else {
    await timesAndServings();
    await key.press("Tab");
    await whereFrom();
    await key.press("Tab");
    await notes();
  }
  await expect(editorStatus(page)).toHaveText("Draft saved");
  await noAccessibilityProblems(page);

  // Nutrition (phase F4) is closed until opened: one stop on the way.
  await key.press("Tab");
  await expect(page.locator("summary").filter({ hasText: "Nutrition per serving" })).toBeFocused();
  const done = page.getByRole("button", { name: "Done" });
  await expect(done).toHaveCount(1);
  // The only Done is in the bar at the top, which stays in view; back up to it (U23, owner's
  // choice 2026-11-07). A new recipe has no Move to Trash (U27 part 3: it's only a draft).
  await expect(page.getByRole("button", { name: "Move to Trash" })).toHaveCount(0);
  for (let i = 0; i < 60; i++) {
    if (await done.evaluate((el) => el === document.activeElement)) break;
    await key.press("Shift+Tab");
  }
  await expect(done).toBeFocused();
  await key.press("Enter");

  // The recipe page shows all of it.
  await expect(page.getByRole("heading", { level: 1, name: "Green Chile Stew" })).toBeVisible();
  await expect(page.getByText("June's, from the church cookbook.")).toBeVisible();
  await expect(page.getByText("June Holloway", { exact: true })).toBeVisible();
  // The recipe's own note says where it came from (U7).
  await expect(page.getByText("From June Holloway")).toBeVisible();
  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await expect(ingredients.getByRole("heading", { name: "For the stew:" })).toBeVisible();
  await expect(ingredients.getByRole("listitem")).toHaveText([
    "2 lb pork shoulder",
    "1 onion",
    "4 cloves garlic",
  ]);
  const method = page.getByRole("region", { name: "Directions" });
  await expect(method.getByRole("heading", { name: "Serving" })).toBeVisible();
  await expect(method.locator("ol").last()).toHaveAttribute("start", "3");
  await expect(page.getByText("2 hr 20 min")).toBeVisible();
  // "Serves 6", said once, with the ingredients (owner's choice 2026-10-25).
  await expect(page.getByRole("region", { name: "Ingredients" })).toContainText("Serves 6");
  await expect(page.getByText("Easy")).toBeVisible();
  await expect(page.getByText("Better the next day.")).toBeVisible();
});

test("Undo and redo go back and forward through the draft", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Pozole");
  await page.getByRole("link", { name: /Pozole/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  await expect(undo).toBeDisabled();
  await expect(editorStatus(page)).toHaveText("No changes yet");

  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Pozole rojo");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");
  await page.getByLabel("Notes").fill("Hominy from the can is fine.");
  await expect(editorStatus(page)).toHaveText("Draft saved · 2 changes");

  await undo.click();
  await expect(page.getByLabel("Notes")).toHaveValue("");
  await expect(title).toHaveValue("Pozole rojo");
  await undo.click();
  await expect(title).toHaveValue("Pozole");
  await expect(undo).toBeDisabled();
  await expect(editorStatus(page)).toHaveText("No changes yet");
  await redo.click();
  await expect(title).toHaveValue("Pozole rojo");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");

  // What undo left is the draft, kept when the page reloads; the recipe box hasn't changed.
  await page.reload();
  await expect(title).toHaveValue("Pozole rojo");
  await expect(page.getByLabel("Notes")).toHaveValue("");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");
  await page.goto("/");
  await expect(recipeCard(page, "Pozole rojo")).toHaveCount(0);
  await expect(recipeCard(page, "Pozole")).toBeVisible();
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
  // Kept in the draft as typed (U27 part 3); Done holds the check.
  await expect(editorStatus(page)).toHaveText("Draft saved · 2 changes");

  // Done points at the problem instead of leaving.
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(address).toBeFocused();

  await address.fill("example.com/birria");
  await address.blur();
  await expect(address).toHaveValue("https://example.com/birria");
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
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
  await expect(editorStatus(phone)).toHaveText("Draft saved · 1 change");
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

  // Your stars and heart are on the line under the title (owner's choice 2026-10-25).
  const yours = page.getByRole("group", { name: "Your rating" });
  await expect(yours.getByRole("radio", { name: "No rating" })).toBeChecked();
  await yours.getByRole("radio", { name: "4 stars" }).focus();
  await page.keyboard.press("Space");
  await expect(yours.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(yours.getByRole("radio", { name: "5 stars" })).toBeChecked();
  await page.getByLabel("A favorite of mine").check({ force: true });
  // With no note yet, just a way to add one.
  await page.getByRole("button", { name: "Add a note" }).click();
  await expect(page.getByLabel("Your note")).toBeFocused();
  await page.getByLabel("Your note").fill("Mom's, with extra raisins.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Mom's, with extra raisins.", { exact: true })).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await noAccessibilityProblems(page);

  await page.reload();
  await expect(yours.getByRole("radio", { name: "5 stars" })).toBeChecked();
  await expect(page.getByLabel("A favorite of mine")).toBeChecked();
  await expect(page.getByText("Mom's, with extra raisins.", { exact: true })).toBeVisible();
  // And taken back.
  await yours.getByRole("radio", { name: "No rating" }).focus();
  await page.keyboard.press("Space");
  await expect(yours.getByRole("radio", { name: "No rating" })).toBeChecked();
});

test("Free: editing pauses offline, and the draft is kept when the connection is back", async ({
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
  // In red, and Done waits for the connection (U27 part 3).
  await expect(editorStatus(page)).toHaveText("Can’t save the draft: no connection");
  await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();

  await context.setOffline(false);
  await expect(page.getByLabel("Notes")).toBeEnabled({ timeout: 15_000 });
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change", { timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel("Notes")).toHaveValue("Toast the rice first.");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Toast the rice first.")).toBeVisible();
});

test("Premium: the draft waits on the device with no connection, then goes to the account", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await addRecipe(page, "Sopa de lima");
  await page.getByRole("link", { name: /Sopa de lima/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  await context.setOffline(true);
  await page.getByLabel("Notes").fill("Charred tortillas on top.");
  await expect(editorStatus(page)).toHaveText("Draft kept on this device · waiting to connect");
  await expect(page.getByLabel("Notes")).toBeEnabled();
  await context.setOffline(false);
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change", { timeout: 15_000 });
  const drafts = (await (await page.request.get("/api/drafts")).json()) as {
    drafts: { data: { fields: { notes?: string } } }[];
  };
  expect(drafts.drafts.map((d) => d.data.fields.notes)).toEqual(["Charred tortillas on top."]);
});

// At the bottom of the editor on a phone (U23); in the bar on a laptop (U27).
test("Move to Trash from the editor", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");

  // Not for a new recipe: until Done it's only a draft (U27 part 3).
  await page.getByRole("button", { name: "Add recipe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New recipe" })).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Arroz rojo");
  await expect(editorStatus(page)).toHaveText("Draft saved");
  await expect(page.getByRole("button", { name: "Move to Trash" })).toHaveCount(0);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  // No words under it (U27, owner's choice 2026-11-21).
  await expect(page.getByRole("button", { name: "Move to Trash" })).toBeVisible();
  await expect(page.getByText("It stays in Trash for 30 days")).toHaveCount(0);

  // The saved recipe goes to Trash, its draft with it, and the list says so with Undo.
  await page.getByLabel("Notes").fill("Toast the rice first.");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("status").filter({ hasText: "to Trash." })).toHaveText(
    "Moved “Arroz rojo” to Trash.",
  );
  await expect(recipeCard(page, "Arroz rojo")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(recipeCard(page, "Arroz rojo")).toBeVisible();
  await recipeCard(page, "Arroz rojo").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Arroz rojo" })).toBeVisible();
  await expect(page.getByText("Toast the rice first.")).toHaveCount(0);
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(editorStatus(page)).toHaveText("No changes yet");
  await expect(page.getByLabel("Notes")).toHaveValue("");
});

// U27 (owner's choices 2026-11-21, the mockup "C3"): on a laptop the editor's bar has Move to
// Trash, Undo, Redo and Done as the one ink button; how Fennl reads each line shows in the boxes'
// margins (step numbers, the H of a heading, the link mark, an edge on the line being typed),
// with one hint under them and "How Fennl reads it" at its end.
test("On a laptop, the bar and how Fennl reads each line in the box's margin", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== "desktop", "The laptop layout");
  await useOwnAccount(context, baseURL!);
  await page.goto("/");

  await page.getByRole("button", { name: "Add recipe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New recipe" })).toBeVisible();
  const bar = page.locator("article > div").first();
  // A new recipe: no Move to Trash. Discard changes is greyed with nothing typed (U27 part 3).
  await expect(bar.getByRole("button")).toHaveText(["Undo", "Redo", "Discard changes", "Done"]);
  await expect(bar.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await expect(editorStatus(page)).toHaveText("No changes yet");
  // An empty box shows a faded example with its marks, which screen readers don't hear.
  const margin = (list: "ingredients" | "directions") =>
    page.locator(`section[data-list="${list}"] [data-margin]`);
  await expect(margin("directions").locator("[data-example]")).toHaveText([
    "1Heat the oven to 350°F.",
    "2Mix the flour and salt in a large bowl.",
    "HGlaze",
    "3Whisk the sugar with a little milk and spoon it over.",
  ]);

  await page.getByLabel("Title", { exact: true }).fill("Pozole");
  await expect(editorStatus(page)).toHaveText("Draft saved");
  await expect(bar.getByRole("button", { name: "Discard changes" })).toBeEnabled();

  // The one hint, in the owner's words.
  await expect(page.locator("#edit-lines-hint")).toHaveText(
    /^One step per line; Enter starts a new one\. (Alt\+↑ \/ Alt\+↓|⌥↑ \/ ⌥↓) reorders the line you’re on\.$/,
  );
  await expect(methodBox(page)).toHaveAttribute("aria-describedby", "edit-lines-hint");

  // A box for each step (U27), numbered in the margin, skipping a heading; the step being typed
  // has the edge. Blank lines don't make steps.
  await methodBox(page).fill(
    "Soak the hominy.\nFOR THE BROTH\nSimmer the pork.\n\nAdd the chiles.",
  );
  const marks = margin("directions").locator("> div > span:first-child");
  await expect(stepWords(page)).toHaveText([
    "Soak the hominy.",
    "FOR THE BROTH",
    "Simmer the pork.",
    "Add the chiles.",
  ]);
  await expect(marks).toHaveText(["1", "H", "2", "3"]);
  await expect(margin("directions").locator("[data-heading]")).toHaveCount(1);
  await expect(margin("directions").locator("[data-current] [data-step-words]")).toHaveText(
    "Add the chiles.",
  );
  await page.keyboard.press("ArrowUp");
  await expect(margin("directions").locator("[data-current] [data-step-words]")).toHaveText(
    "Simmer the pork.",
  );
  // The Heading button acts on the step the cursor is in; the numbers follow.
  await page.getByRole("button", { name: "Heading" }).nth(1).click();
  await expect(marks).toHaveText(["1", "H", "H", "2"]);
  await expect(page.getByRole("textbox", { name: "Heading, Simmer the pork." })).toBeFocused();
  // Leaving the box: no edge.
  await page.getByLabel("Notes").click();
  await expect(margin("directions").locator("[data-current]")).toHaveCount(0);
  expect(await directionsText(page)).toBe(
    "Soak the hominy.\nFOR THE BROTH\nSimmer the pork.\nAdd the chiles.",
  );

  // Each step grows with its words: nothing scrolls inside it.
  await page.getByRole("textbox", { name: "Step 2 of 2" }).fill("Simmer. ".repeat(40).trim());
  const fits = await page
    .getByRole("textbox", { name: "Step 2 of 2" })
    .evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.clientHeight > 40);
  expect(fits).toBe(true);
  await page.getByLabel("Notes").click();
  await page.getByRole("textbox", { name: "Step 1 of 2" }).click();
  await page.keyboard.press(keys.selectAll);
  await page.keyboard.press("Delete");
  await methodBox(page).fill(Array.from({ length: 14 }, (_, i) => `Step ${i + 1}.`).join("\n"));
  await expect(stepWords(page)).toHaveCount(14);

  // How Fennl reads it: off until pressed, then the read-out under each box.
  const reads = page.getByRole("button", { name: "How Fennl reads it" });
  await expect(reads).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("group", { name: "Directions, as Fennl reads them" })).toHaveCount(0);
  await reads.click();
  await expect(reads).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: "Directions, as Fennl reads them" }).getByRole("listitem"),
  ).toHaveCount(14);
  await expect(page.getByRole("group", { name: "Ingredients, as Fennl reads them" })).toBeVisible();
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
  await noAccessibilityProblems(page);
});

// U27 (owner's choices 2026-11-21, the mockup "C3"): on a laptop Directions is a box for each step,
// but typing feels like one box. The steps are saved as the recipe's lines, as before.
test("On a laptop, Directions is a box for each step that types like one box", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== "desktop", "The laptop layout");
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Pozole");
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
  const key = page.keyboard;
  const group = (count: number) =>
    page.getByRole("group", { name: `Directions, ${count} ${count === 1 ? "step" : "steps"}` });
  const step = (name: string) => page.getByRole("textbox", { name, exact: true });
  const focusedWords = () =>
    page.locator('section[data-list="directions"] [data-current] [data-step-words]');
  /** The words that a copy would put on the clipboard. */
  const copy = () =>
    page.evaluate(() => {
      const data = new DataTransfer();
      document.activeElement?.dispatchEvent(
        new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }),
      );
      return data.getData("text/plain");
    });
  const paste = (text: string) =>
    page.evaluate((words) => {
      const data = new DataTransfer();
      data.setData("text/plain", words);
      document.activeElement?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);

  // Enter at the end of a step starts a new one, with the cursor in it.
  await methodBox(page).click();
  await key.type("Soak the hominy.");
  await key.press("Enter");
  await expect(step("New step")).toBeFocused();
  await key.type("Simmer the pork. Add the chiles.");
  await expect(group(2)).toBeVisible();
  await expect(step("Step 2 of 2")).toBeFocused();

  // Enter in the middle of a step splits it there; Backspace at a step's start joins it back.
  await key.press(keys.lineStart);
  for (let i = 0; i < "Simmer the pork. ".length; i++) await key.press("ArrowRight");
  await key.press("Enter");
  await expect(stepWords(page)).toHaveText([
    "Soak the hominy.",
    "Simmer the pork.",
    "Add the chiles.",
  ]);
  await expect(step("Step 3 of 3")).toBeFocused();
  await key.press("Backspace");
  await expect(stepWords(page)).toHaveText([
    "Soak the hominy.",
    "Simmer the pork. Add the chiles.",
  ]);
  await expect(step("Step 2 of 2")).toBeFocused();
  await key.press("Enter");
  await expect(group(3)).toBeVisible();

  // Undo and Redo step back and forward through the split and the join.
  await key.press("ControlOrMeta+z");
  await expect(group(2)).toBeVisible();
  await expect(focusedWords()).toHaveText("Simmer the pork. Add the chiles.");
  await key.press("ControlOrMeta+z");
  await expect(group(3)).toBeVisible();
  await key.press("ControlOrMeta+Shift+z");
  await expect(group(2)).toBeVisible();

  // Delete at the end of a step joins the next one to it.
  await step("Step 1 of 2").click();
  await key.press(keys.lineEnd);
  await key.press("Delete");
  await expect(stepWords(page)).toHaveText(["Soak the hominy.Simmer the pork. Add the chiles."]);
  await key.press("ControlOrMeta+z");
  await expect(group(2)).toBeVisible();

  // ↑ and ↓ go between steps as between lines; an empty step left behind goes.
  await step("Step 1 of 2").click();
  await key.press("ArrowDown");
  await expect(step("Step 2 of 2")).toBeFocused();
  await key.press(keys.lineEnd);
  await key.press("Enter");
  await expect(step("New step")).toBeFocused();
  await key.press("ArrowUp");
  await expect(step("Step 2 of 2")).toBeFocused();
  await expect(stepWords(page)).toHaveCount(2);
  await key.press("ArrowUp");
  await expect(step("Step 1 of 2")).toBeFocused();
  // Left with the mouse, too.
  await step("Step 2 of 2").click();
  await key.press(keys.lineEnd);
  await key.press("Enter");
  await expect(step("New step")).toBeFocused();
  await step("Step 1 of 2").click();
  await expect(stepWords(page)).toHaveCount(2);
  await expect(step("Step 1 of 2")).toBeFocused();

  // Alt+↓ moves the step, and the numbers follow.
  await key.press("Alt+ArrowDown");
  await expect(stepWords(page)).toHaveText([
    "Simmer the pork. Add the chiles.",
    "Soak the hominy.",
  ]);
  await expect(step("Step 2 of 2")).toBeFocused();
  await expect(page.getByText("Moved down", { exact: true })).toBeAttached();
  // Undo puts it back, and the cursor goes with it.
  await key.press("ControlOrMeta+z");
  await expect(stepWords(page)).toHaveText([
    "Soak the hominy.",
    "Simmer the pork. Add the chiles.",
  ]);
  await expect(focusedWords()).toHaveText("Soak the hominy.");
  await key.press("Alt+ArrowDown");
  await expect(focusedWords()).toHaveText("Soak the hominy.");
  await key.press("Alt+ArrowUp");
  await expect(stepWords(page)).toHaveText([
    "Soak the hominy.",
    "Simmer the pork. Add the chiles.",
  ]);

  // Pasting several lines makes one step per line, blank lines and numbers dropped.
  await step("Step 2 of 2").click();
  await key.press(keys.lineEnd);
  await key.press("Enter");
  await paste("FOR THE BROTH\n\n2. Rest 10 minutes.\n3. Serve hot.\n");
  await expect(stepWords(page)).toHaveText([
    "Soak the hominy.",
    "Simmer the pork. Add the chiles.",
    "FOR THE BROTH",
    "Rest 10 minutes.",
    "Serve hot.",
  ]);
  await expect(step("Step 4 of 4")).toBeFocused();
  // One line with its line ending goes into the step, the cursor after it.
  await key.press(keys.lineStart);
  await paste("Then \n");
  await key.type("very ");
  await expect(stepWords(page).last()).toHaveText("Then very Serve hot.");
  await expect(stepWords(page)).toHaveCount(5);
  await key.press("ControlOrMeta+z");
  await key.press("ControlOrMeta+z");
  await expect(stepWords(page).last()).toHaveText("Serve hot.");

  // Heading acts on the step the cursor is in, and again turns it back.
  await step("Step 2 of 4").click();
  const heading = page.getByRole("button", { name: "Heading" }).nth(1);
  await heading.click();
  await expect(step("Heading, Simmer the pork. Add the chiles.")).toBeFocused();
  await expect(group(3)).toBeVisible();
  await heading.click();
  await expect(step("Step 2 of 4")).toBeFocused();

  // Words selected across steps: Shift and the arrows, copied one line per step; typing over
  // them joins what's left into one step.
  await step("Step 3 of 4").click();
  await key.press(keys.lineStart);
  await key.press("Shift+ArrowUp");
  expect(await copy()).toBe("FOR THE BROTH\n");
  await key.press("Shift+ArrowUp");
  expect(await copy()).toBe("Simmer the pork. Add the chiles.\nFOR THE BROTH\n");
  await key.press("Shift+ArrowDown");
  expect(await copy()).toBe("FOR THE BROTH\n");
  await key.type("XY");
  await expect(stepWords(page)).toHaveText([
    "Soak the hominy.",
    "Simmer the pork. Add the chiles.",
    "XYRest 10 minutes.",
    "Serve hot.",
  ]);
  // One Undo takes back the words typed over the selection.
  await key.press("ControlOrMeta+z");
  await expect(stepWords(page)).toHaveCount(5);
  await expect(stepWords(page).nth(2)).toHaveText("FOR THE BROTH");

  // Everything, as in one box, and dragging the mouse across steps.
  await step("Step 1 of 4").click();
  await key.press(keys.selectAll);
  expect(await copy()).toBe(
    "Soak the hominy.\nSimmer the pork. Add the chiles.\nFOR THE BROTH\nRest 10 minutes.\nServe hot.",
  );
  await key.press("ArrowLeft");
  const from = await step("Step 1 of 4").boundingBox();
  const to = await step("Step 2 of 4").boundingBox();
  await page.mouse.move(from!.x + 40, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + 60, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.up();
  const dragged = await copy();
  expect(dragged).toMatch(/^\S{0,4}\s?\S* ?hominy\.\nSimmer /);
  await key.press("Backspace");
  await expect(group(3)).toBeVisible();
  await key.press("ControlOrMeta+z");
  await expect(group(4)).toBeVisible();
  // Dragged on below the last step: to the end of all of them, as in one box.
  const first = await step("Step 1 of 4").boundingBox();
  const last = await step("Step 4 of 4").boundingBox();
  await page.mouse.move(first!.x + 40, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(last!.x + 40, last!.y + last!.height + 120, { steps: 8 });
  await page.mouse.up();
  expect(await copy()).toMatch(/\nServe hot\.$/);
  await key.press("ArrowLeft");

  // Enter that confirms a word being composed (Japanese, Chinese, Korean input) is the input
  // method's: no new step.
  await step("Step 4 of 4").click();
  await key.press(keys.lineEnd);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 });
  for (const type of ["rawKeyDown", "keyUp"] as const) {
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
  }
  await cdp.send("Input.insertText", { text: "か" });
  await expect(stepWords(page)).toHaveCount(5);
  await expect(stepWords(page).last()).toHaveText("Serve hot.か");
  await key.press("Backspace");
  await expect(stepWords(page).last()).toHaveText("Serve hot.");

  // Saved as the recipe's lines.
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
  await noAccessibilityProblems(page);
  await page.getByRole("button", { name: "Done" }).click();
  const method = page.getByRole("region", { name: "Directions" });
  await expect(method.getByRole("heading", { name: "FOR THE BROTH" })).toBeVisible();
  await expect(method.getByRole("listitem")).toHaveText([
    /Soak the hominy\.$/,
    /Simmer the pork\. Add the chiles\.$/,
    /Rest \W*10 minutes\.$/,
    /Serve hot\.$/,
  ]);
});

// U27 part 3 (owner's choices 2026-11-21 and 22, the mockup "C3"): every change is kept as a
// draft; the recipe box changes only at Done, and Discard changes throws the draft away after
// asking.
test("Drafts: Done applies them, Discard changes asks first and throws them away", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Caldo de res");
  await page.getByRole("link", { name: /Caldo de res/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  const discardChanges = page.getByRole("button", { name: "Discard changes" });
  await expect(editorStatus(page)).toHaveText("No changes yet");
  await expect(discardChanges).toBeDisabled();

  await page.getByLabel("Notes").fill("Corn on the cob in each bowl.");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");
  await expect(discardChanges).toBeEnabled();

  // Left without Done: the recipe page shows the saved recipe; the editor brings the draft back.
  await page.goto("/");
  await page.getByRole("link", { name: /Caldo de res/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Caldo de res" })).toBeVisible();
  await expect(page.getByText("Corn on the cob in each bowl.")).toHaveCount(0);
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await expect(page.getByLabel("Notes")).toHaveValue("Corn on the cob in each bowl.");

  // The question, under the button; Escape and Cancel close it, back on the button.
  await discardChanges.click();
  const question = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await expect(question).toContainText("The recipe goes back to how it was saved.");
  await expect(question.getByRole("button", { name: "Discard" })).toBeFocused();
  await noAccessibilityProblems(page);
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(discardChanges).toBeFocused();
  await discardChanges.click();
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toHaveCount(0);
  await expect(discardChanges).toBeFocused();
  await expect(page.getByLabel("Notes")).toHaveValue("Corn on the cob in each bowl.");

  // Discard: back to the saved recipe, still in the editor.
  await discardChanges.click();
  await question.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByLabel("Notes")).toHaveValue("");
  await expect(editorStatus(page)).toHaveText("No changes yet");
  await expect(discardChanges).toBeDisabled();

  // Done applies what's changed.
  await page.getByLabel("Notes").fill("Lime on the side.");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Lime on the side.")).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await expect
    .poll(async () => ((await (await page.request.get("/api/drafts")).json()) as { ids: [] }).ids)
    .toEqual([]);
});

test("Drafts: a new recipe with nothing in it isn't kept; discarded, it leaves no category", async ({
  page,
  context,
  baseURL,
}, info) => {
  const laptop = info.project.name === "desktop";
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  const drafts = async () =>
    ((await (await page.request.get("/api/drafts")).json()) as { ids: unknown[] }).ids;

  // Opened and left with nothing typed: no draft.
  await page.getByRole("button", { name: "Add recipe" }).click();
  await expect(editorStatus(page)).toHaveText("No changes yet");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
  expect(await drafts()).toEqual([]);

  // A category before a title (the draft holds it); made only at Done.
  await page.getByRole("button", { name: "Add recipe" }).click();
  if (laptop) {
    await page.getByRole("button", { name: "Add a category" }).click();
    await page.getByRole("combobox", { name: "Find or add a category" }).fill("Brand New Shelf");
  } else {
    await page.getByRole("combobox", { name: "Add a category" }).fill("Brand New Shelf");
  }
  await page.keyboard.press("Enter");
  if (laptop) await page.keyboard.press("Escape");
  await expect(page.getByRole("list", { name: "This recipe's categories" })).toContainText(
    "Brand New Shelf",
  );
  await expect(editorStatus(page)).toHaveText("Draft saved");
  await expect.poll(drafts).toHaveLength(1);

  // Done needs a title.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Title", { exact: true })).toHaveAttribute("aria-invalid", "true");

  const discardChanges = page.getByRole("button", { name: "Discard changes" });
  await discardChanges.click();
  const question = page.getByRole("alertdialog", { name: "Discard this new recipe?" });
  await expect(question).toContainText("It won’t be added to your recipes.");
  await question.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
  await expect.poll(drafts).toEqual([]);
  await page.goto("/categories");
  await expect(page.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();
  await expect(page.getByText("Brand New Shelf")).toHaveCount(0);
});
