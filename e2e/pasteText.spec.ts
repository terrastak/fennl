import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { premium, syncStatus } from "./recipes";
import { showFolded, useOwnAccount } from "./support";

// Phase E15: recipe text pasted into the Import page. Clearly laid out text is read without the
// AI (so Free can use it); anything else is read by the AI (the local test server's stand-in) on
// Premium. The pasted text is shown beside the draft, and a web address on its own is turned away.

const LAID_OUT = `Grandma's Banana Bread

Serves 8
Prep time: 15 minutes

Ingredients
3 ripe bananas
1/2 cup butter, melted
3/4 cup sugar
2 cups flour

Directions
Mash the bananas and stir in the butter and sugar.
Fold in the flour and bake at 350°F for 60 minutes.`;

const MESSY = `Hi! Here's the cookie thing I told you about. Mix a cup of butter with half a cup of
powdered sugar, work in two cups of flour, roll into balls and bake 15 minutes at 350. Aunt June`;

async function paste(page: Page, text: string) {
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByLabel("Recipe text").fill(text);
  await page.getByRole("button", { name: "Read this recipe" }).click();
}

test("Free: laid out text is read without AI, reviewed beside the pasted text, and saved", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await paste(page, LAID_OUT);
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Grandma's Banana Bread");
  await expect(page.getByRole("textbox", { name: "Ingredients" })).toHaveValue(/3 ripe bananas/);

  const source = page.getByRole("region", { name: "The pasted text" });
  await showFolded(
    source.getByRole("button", { name: "Show the pasted text" }),
    source.getByLabel("The text you pasted"),
  );
  await expect(source.getByLabel("The text you pasted")).toContainText("Serves 8");
  await expect(source).toContainText("only until you save the recipe or discard it");
  // "Read again" is for AI reads only.
  await expect(page.getByRole("region", { name: "Not quite right?" })).toHaveCount(0);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await page.getByRole("button", { name: "Save recipe" }).first().click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Grandma's Banana Bread" }),
  ).toBeVisible();
});

test("Free: text that needs AI is told it's part of Premium", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await paste(page, MESSY);
  await expect(page.getByRole("alert")).toContainText("would need reading with AI");
  await expect(page.getByRole("alert")).toContainText("Premium");
  await expect(page).toHaveURL(/\/import$/);
  // The text stays in the box, so nothing is lost.
  await expect(page.getByLabel("Recipe text")).toHaveValue(MESSY);
});

test("Premium: messy text is read with AI, then reviewed, with Read again for the text", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await paste(page, MESSY);
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Sugar Butter Balls");
  await expect(page.getByRole("region", { name: "Not quite right?" })).toContainText(
    "Fennl can read the text again",
  );
});

test("a web address on its own is turned away, not fetched", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await paste(page, "https://example.com/recipes/banana-bread");
  await expect(page.getByRole("alert")).toContainText("can't import from a link yet");
  await expect(page).toHaveURL(/\/import$/);
});
