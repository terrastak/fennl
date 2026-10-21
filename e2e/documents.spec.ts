import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { premium, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase E18: a recipe saved as a document. The file is read on the device; its text goes the
// way pasted text does (Fennl's own rules when clearly laid out, free; the AI otherwise, here the
// local test server's stand-in), and on Premium a Word file's photos are offered to keep.

const LAID_OUT = `Grandma's Banana Bread

Serves 8

Ingredients
3 ripe bananas
1/2 cup butter, melted
2 cups flour

Directions
Mash the bananas and stir in the butter.
Fold in the flour and bake at 350°F for 60 minutes.`;

test("Premium: a Word file is read, shown beside the draft, and its photo offered to keep", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const section = page.getByRole("region", { name: "From a file" });
  await expect(section).toContainText("Photos in a Word file are offered to keep");
  await section
    .locator('input[type="file"]')
    .setInputFiles("test-docs/Cranberry Oatmeal Chocolate Christmas Cookies.docx");
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  const source = page.getByRole("region", { name: "The document" });
  const show = source.getByRole("button", { name: "Show the document" });
  if (await show.isVisible()) await show.click();
  await expect(
    source.getByLabel("The text of Cranberry Oatmeal Chocolate Christmas Cookies.docx"),
  ).toContainText("1 stick + 6T butter, softened");
  // The Quaker Oats lid in the document, offered as a photo to keep.
  const photos = page.getByRole("region", { name: "Photos" });
  await expect(photos.getByRole("img")).toHaveCount(1);
  await expect(photos.getByLabel("Keep photo 1")).toBeChecked();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("Free: a clearly laid out text file is read for free; files Fennl can't read are explained", async ({
  page,
  context,
  baseURL,
}) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const section = page.getByRole("region", { name: "From a file" });
  await section.locator('input[type="file"]').setInputFiles([
    { name: "Banana bread.md", mimeType: "text/markdown", buffer: Buffer.from(LAID_OUT) },
    { name: "Old recipe.doc", mimeType: "application/msword", buffer: Buffer.from("x") },
  ]);
  await expect(section.getByRole("alert")).toContainText(
    "Old recipe.doc is an older Word file (.doc)",
  );
  const waiting = page.getByRole("region", { name: "Waiting for review" });
  await waiting.getByRole("link", { name: "Grandma's Banana Bread" }).click();
  await expect(page.getByRole("region", { name: "The document" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Grandma's Banana Bread");
});
