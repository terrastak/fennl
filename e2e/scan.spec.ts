import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { premium, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase E9: a recipe imported from photos of its pages. The pages are chosen (or photographed
// with the live camera, page after page), put in order, turned and cropped, then prepared on the
// device, uploaded and read by the AI (the local test server's stand-in) into a draft, reviewed
// beside the photos, and kept with the saved recipe.

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .exclude("iframe")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const pages = (page: Page) => page.getByRole("list", { name: /read in this order/ });

test("Premium: choose photos, arrange them, read them, and keep them with the recipe", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(150_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  const section = page.getByRole("region", { name: "From photos" });
  await section
    .locator('input[type="file"][multiple]')
    .setInputFiles(["test_images/handwriten1.jpg", "test_images/IMG_0019.jpeg"]);
  await expect(pages(page).getByRole("listitem")).toHaveCount(2);
  await expect(section.getByRole("heading", { name: "2 pages, read in this order" })).toBeVisible();
  await expect(pages(page).getByRole("img", { name: "Page 2" })).toBeVisible();

  // The back of the card first; then turned, and cropped from the keyboard.
  await section.getByRole("button", { name: "Move page 2 up" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Page 2 is now page 1." }),
  ).toBeAttached();
  await section.getByRole("button", { name: "Turn page 1" }).click();
  await section.getByRole("button", { name: "Crop page 1" }).click();
  const crop = page.getByRole("dialog", { name: "Crop page 1" });
  await expect(crop.getByRole("img", { name: "Page 1" })).toBeVisible();
  await expectAccessible(page);
  const corner = crop.getByRole("button", { name: "Bottom right corner" });
  await corner.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
  await crop.getByRole("button", { name: "Done" }).click();
  await expect(crop).toBeHidden();
  await expectAccessible(page);

  // Removing a page, then choosing it again: it goes to the end.
  await section.getByRole("button", { name: "Remove page 2" }).click();
  await expect(pages(page).getByRole("listitem")).toHaveCount(1);
  await section
    .locator('input[type="file"][multiple]')
    .setInputFiles(["test_images/handwriten1.jpg"]);
  await expect(pages(page).getByRole("listitem")).toHaveCount(2);

  await section.getByRole("button", { name: "Read the recipe" }).click();
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Review the import" })).toBeVisible();

  // The photos beside the draft (folded away under a button on a phone).
  const source = page.getByRole("region", { name: "The photos" });
  const show = source.getByRole("button", { name: "Show the photos" });
  if (await show.isVisible()) await show.click();
  await expect(source.getByRole("img", { name: "Photo 1" })).toBeVisible();
  await expect(source.getByRole("img", { name: "Photo 2" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Not quite right?" })).toContainText(
    "Fennl can read the photos again",
  );
  await expectAccessible(page);

  await page.getByRole("button", { name: "Save recipe" }).first().click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const originals = page.getByRole("region", { name: "The originals" });
  await expect(originals.getByRole("button", { name: /Open original \d full screen/ })).toHaveCount(
    2,
  );
  await originals.getByRole("button", { name: "Open original 1 full screen" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Free: reading recipes from photos is part of Premium", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/import");
  const section = page.getByRole("region", { name: "From photos" });
  await expect(section).toContainText("Reading recipes from photos is part of Premium.");
  await expect(section.locator('input[type="file"]')).toHaveCount(0);
});
