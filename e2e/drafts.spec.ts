import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addRecipe, DRAFT_SAVED, editorStatus, recipeCard } from "./recipes";
import { useOwnAccount } from "./support";

// U27 part 3: drafts in the recipe list, on the Drafts page, in the left panel (a laptop) or the
// ⋯ menu (a phone), and on the recipe page.

async function noAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const draftsList = (page: Page) => page.getByRole("list", { name: "Drafts" });
const draftCard = (page: Page, text: string | RegExp) =>
  draftsList(page).getByRole("listitem").filter({ hasText: text });
/** The left panel's Drafts (a laptop's). */
const panelDrafts = (page: Page) =>
  page.getByRole("navigation", { name: "Recipe box" }).getByRole("link", { name: /^Drafts/ });

/** Opens Drafts as the person would: the left panel on a laptop, the ⋯ menu on a phone. */
async function openDrafts(page: Page, phone: boolean, count: number) {
  await page.goto("/");
  if (phone) {
    await page.getByRole("button", { name: "More actions" }).click();
    const item = page.getByRole("link", { name: /^Drafts/ });
    await expect(item).toHaveText(`Drafts${count}`);
    await item.click();
  } else {
    await expect(panelDrafts(page)).toContainText(String(count));
    await panelDrafts(page).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Drafts" })).toBeVisible();
}

test("A new recipe's draft: in the list with its tag, on Drafts, then discarded", async ({
  page,
  context,
  baseURL,
}, info) => {
  const phone = info.project.name === "phone";
  await useOwnAccount(context, baseURL!);
  await page.goto("/");

  // Nothing typed: no draft.
  await page.getByRole("button", { name: "Add recipe" }).click();
  await expect(editorStatus(page)).toHaveText("No changes yet");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
  if (!phone) await expect(panelDrafts(page)).toHaveCount(0);

  // A title: the recipe is in the list, tagged Draft, and counted in All recipes.
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Green Chile Stew");
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
  await page.goto("/");
  await expect(recipeCard(page, "Green Chile Stew")).toContainText("Draft");
  if (!phone) {
    await expect(
      page.getByRole("navigation", { name: "Recipe box" }).getByRole("link", {
        name: /^All recipes/,
      }),
    ).toContainText("1");
    await expect(panelDrafts(page)).toContainText("1");
  }
  // Opening it opens the editor on the draft.
  await recipeCard(page, "Green Chile Stew").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "New recipe" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Green Chile Stew");

  // No title, only ingredients: on Drafts, named by what's typed and when it was started.
  await page.goto("/");
  await page.getByRole("button", { name: "Add recipe" }).click();
  await page.getByRole("textbox", { name: "Ingredients" }).fill("2 cups flour\n1 tsp salt");
  await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
  await page.goto("/");
  // Not in the list without a title.
  await expect(recipeCard(page, "Untitled")).toHaveCount(0);

  await openDrafts(page, phone, 2);
  await expect(page.getByText("2 drafts")).toBeVisible();
  await expect(draftsList(page).getByRole("listitem")).toHaveCount(2);
  const untitled = draftCard(page, "Untitled · 2 cups flour, 1 tsp salt");
  await expect(untitled).toContainText("New recipe");
  await expect(untitled).toContainText("Changed today");
  await expect(untitled).toContainText(/Started today, \d/);
  await expect(draftCard(page, "Green Chile Stew")).toContainText("New recipe");
  await noAccessibilityProblems(page);

  // Discard asks first, in the card; Cancel (and Escape) give the focus back to Discard.
  const discard = untitled.getByRole("button", { name: /^Discard/ });
  await discard.click();
  await expect(untitled.getByRole("group", { name: "Discard this new recipe?" })).toContainText(
    "It won’t be added to your recipes.",
  );
  await noAccessibilityProblems(page);
  await untitled.getByRole("button", { name: "Cancel" }).click();
  await expect(discard).toBeFocused();
  await discard.click();
  await page.keyboard.press("Escape");
  await expect(discard).toBeFocused();
  await discard.click();
  await untitled.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    "Discarded “Untitled · 2 cups flour, 1 tsp salt”.",
  );
  await expect(page.getByText("1 draft", { exact: true })).toBeVisible();

  // Continue editing opens the editor on it.
  await draftCard(page, "Green Chile Stew")
    .getByRole("link", { name: "Continue editing Green Chile Stew" })
    .click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Green Chile Stew");
});

test("A saved recipe's changes: the strip on its page, Drafts, Discard and Trash", async ({
  page,
  context,
  baseURL,
}, info) => {
  const phone = info.project.name === "phone";
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Buttermilk Pancakes");

  const changeIngredients = async () => {
    await recipeCard(page, "Buttermilk Pancakes").getByRole("link").click();
    await page.getByRole("link", { name: "Edit recipe" }).click();
    await page.getByRole("textbox", { name: "Ingredients" }).fill("2 cups flour");
    await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");
    await page.goto("/");
  };
  await changeIngredients();

  // The list shows the recipe as saved, with no tag.
  await expect(recipeCard(page, "Buttermilk Pancakes")).not.toContainText("Draft");

  // Its page: the saved recipe, with the strip.
  await recipeCard(page, "Buttermilk Pancakes").getByRole("link").click();
  await expect(page.getByText("You have changes that aren’t saved yet.")).toBeVisible();
  await expect(page.getByText("2 cups flour")).toHaveCount(0);
  await noAccessibilityProblems(page);
  await page.getByRole("link", { name: "Continue editing" }).click();
  await expect(page.getByRole("textbox", { name: "Ingredients" })).toHaveValue("2 cups flour");

  // Drafts: "Changes not saved", and what changed.
  await openDrafts(page, phone, 1);
  const card = draftCard(page, "Buttermilk Pancakes");
  await expect(card).toContainText("Changes not saved");
  await expect(card).toContainText("Changed today: Ingredients");

  // Discard from the recipe page: asked first, then back to the saved recipe.
  await card.getByRole("link", { name: /^Continue editing/ }).click();
  await page.goto("/");
  await recipeCard(page, "Buttermilk Pancakes").getByRole("link").click();
  const discard = page.getByRole("button", { name: "Discard your changes" });
  await discard.click();
  await expect(page.getByRole("group", { name: "Discard your changes?" })).toContainText(
    "The recipe goes back to how it was saved.",
  );
  await page.keyboard.press("Escape");
  await expect(discard).toBeFocused();
  await discard.click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByText("You have changes that aren’t saved yet.")).toHaveCount(0);
  if (!phone) await expect(panelDrafts(page)).toHaveCount(0);

  // A recipe moved to Trash takes its draft with it.
  await page.goto("/");
  await changeIngredients();
  await recipeCard(page, "Buttermilk Pancakes").getByRole("link").click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(recipeCard(page, "Buttermilk Pancakes")).toHaveCount(0);
  await page.goto("/drafts");
  await expect(page.getByText("No drafts.")).toBeVisible();
});

test("With no recipes yet, drafts are still reachable, each named apart", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  for (const notes of ["Hot oven", "Cold butter"]) {
    await page.getByRole("button", { name: "Add recipe" }).click();
    await page.getByRole("textbox", { name: "Notes" }).fill(notes);
    await expect(editorStatus(page)).toHaveText(DRAFT_SAVED);
    await page.goto("/");
  }
  // The empty recipe box leads to them (a phone has no left panel, and no ⋯ with no recipes).
  await expect(
    page.getByRole("heading", { name: "Your recipe box is empty, for now" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Drafts 2" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Drafts" })).toBeVisible();
  // Each untitled draft's buttons say which draft they belong to.
  await expect(
    page.getByRole("button", { name: /^Discard Untitled · Hot oven, started today, \d/ }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /^Continue editing Untitled · Cold butter, started today/ }),
  ).toHaveCount(1);
});

test("Discarding from the recipe page's strip puts the focus on the title and says so", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Corn Fritters");
  await recipeCard(page, "Corn Fritters").getByRole("link").click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await page.getByRole("textbox", { name: "Notes" }).fill("Fry in batches.");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");
  await page.goto("/");
  await recipeCard(page, "Corn Fritters").getByRole("link").click();
  await page.getByRole("button", { name: "Discard your changes" }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).press("Enter");
  await expect(page.getByText("You have changes that aren’t saved yet.")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Corn Fritters" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Changes discarded." })).toHaveCount(1);
});

test("The editor's Discard question closes from its button, or by pressing elsewhere", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name === "phone", "The laptop bar's floating question");
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Miso Soup");
  await recipeCard(page, "Miso Soup").getByRole("link").click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await page.getByRole("textbox", { name: "Notes" }).fill("Don't boil the miso.");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");
  // The words of the status, evenly spaced, the dot between them lighter.
  await expect(editorStatus(page).locator("span[aria-hidden='true']").last()).toHaveText("·");

  const discard = page.getByRole("button", { name: "Discard changes" });
  const question = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await discard.click();
  await expect(question).toBeVisible();
  // Looks pressed while its question is open.
  await page.mouse.move(0, 0);
  expect(await discard.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    "rgba(0, 0, 0, 0)",
  );
  // Escape from the button itself.
  await discard.focus();
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(discard).toBeFocused();
  // Pressing elsewhere on the page.
  await discard.click();
  await expect(question).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Edit recipe" }).click();
  await expect(question).toHaveCount(0);
  // Moving on with Tab.
  await discard.click();
  await page.keyboard.press("Tab"); // Cancel
  await page.keyboard.press("Tab"); // out of the question
  await expect(question).toHaveCount(0);
});

test("Done when another device kept a newer draft: the editor shows that one, nothing lost", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Fish Tacos");
  await recipeCard(page, "Fish Tacos").getByRole("link").click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  const recipeId = /\/recipes\/([^/]+)\/edit/.exec(page.url())![1]!;
  await page.getByRole("textbox", { name: "Ingredients" }).fill("1 lb cod");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");

  // The same person on their phone: a newer draft, changing the notes too.
  const mine = (await (await page.request.get("/api/drafts")).json()) as {
    drafts: { data: Record<string, unknown> & { fields: object; base: object } }[];
  };
  const data = mine.drafts[0]!.data;
  const now = Date.now();
  const put = await page.request.put(`/api/drafts/${recipeId}`, {
    data: {
      draft: {
        ...data,
        fields: { ...data.fields, notes: "Warm the tortillas." },
        base: { ...data.base, notes: "" },
      },
      startedAt: now - 60_000,
      editedAt: now + 1000,
      sentAt: now,
    },
  });
  expect(put.ok()).toBe(true);

  // Done here: the editor shows the newer draft instead, and nothing is applied or removed.
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("Warm the tortillas.");
  await expect(page.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeVisible();
  const still = (await (await page.request.get("/api/drafts")).json()) as { ids: unknown[] };
  expect(still.ids).toHaveLength(1);
  // Done again applies both.
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Fish Tacos" })).toBeVisible();
  await expect(page.getByText("Warm the tortillas.")).toBeVisible();
  await expect(page.getByText("1 lb cod")).toBeVisible();
});

test("Done's change refused by the server: the draft comes back, still in the account", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await addRecipe(page, "Apple Crisp");
  await recipeCard(page, "Apple Crisp").getByRole("link").click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  await page.getByRole("textbox", { name: "Notes" }).fill("Serve warm.");
  await expect(editorStatus(page)).toHaveText("Draft saved · 1 change");

  // The server turns the change away for good (here: made unreadable on its way).
  await page.route("**/api/sync/push", async (route) => {
    const body = route.request().postDataJSON() as { changes: Record<string, unknown>[] };
    body.changes = body.changes.map((c) =>
      c.kind === "recipe" ? { ...c, fields: { ...(c.fields as object), title: 12345 } } : c,
    );
    await route.continue({ postData: JSON.stringify(body) });
  });
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Apple Crisp" })).toBeVisible();
  await expect(page.getByText("You have changes that aren’t saved yet.")).toBeVisible();
  await page.unroute("**/api/sync/push");
  const drafts = (await (await page.request.get("/api/drafts")).json()) as {
    drafts: { data: { fields: { notes?: string } } }[];
  };
  expect(drafts.drafts.map((d) => d.data.fields.notes)).toEqual(["Serve warm."]);
});
