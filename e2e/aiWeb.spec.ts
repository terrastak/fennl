import { expect, test, type Page } from "@playwright/test";
import { premium, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase E8: a web page without recipe data, read by the AI (the local test server's stand-in AI)
// on Premium, and reviewed like any import, beside a copy of the page. Free is told plainly that
// reading a page this way is part of Premium.

const BLOG = `<!DOCTYPE html><html><head><title>Sugar Butter Balls | June Bakes</title>
<meta property="og:site_name" content="June Bakes"></head><body>
<nav><a href="/">Home</a></nav>
<main><article><h1>Sugar Butter Balls</h1>
<p>My grandmother made these every December.</p>
<h2>Ingredients</h2><ul><li>1 cup butter</li><li>1/2 cup powdered sugar</li><li>2 cups flour</li></ul>
<h2>Method</h2><ol><li>Cream the butter and sugar, then work in the flour.</li>
<li>Roll into balls and bake at 350°F for 15 minutes.</li></ol>
</article></main></body></html>`;

async function importBlog(page: Page) {
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.locator('input[type="file"]').setInputFiles({
    name: "sugar-butter-balls.html",
    mimeType: "text/html",
    buffer: Buffer.from(BLOG),
  });
}

test("Premium: a page without recipe data is read with AI, then reviewed", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await importBlog(page);
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Review the import" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Sugar Butter Balls");
  await expect(page.getByRole("textbox", { name: "Ingredients" })).toHaveValue(/1 cup butter/);

  // The copy of the page, without its menu, beside the draft; and Read again, for the page.
  const source = page.getByRole("region", { name: "The original page" });
  const showSource = source.getByRole("button", { name: "Show the original page" });
  if (await showSource.isVisible()) await showSource.click();
  await expect(
    page.frameLocator('iframe[title^="Recipe card"]').getByText("1/2 cup powdered sugar"),
  ).toBeVisible();
  await expect(page.frameLocator('iframe[title^="Recipe card"]').getByText("Home")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Not quite right?" })).toContainText(
    "Fennl can read the page again",
  );
});

test("Free: reading a page with AI is part of Premium", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await importBlog(page);
  await expect(page.getByRole("alert")).toHaveText(
    "That page doesn't publish its recipe details, so Fennl would have to read it with AI. Reading with AI is part of Premium.",
  );
  await expect(page).toHaveURL(/\/import$/);
});
