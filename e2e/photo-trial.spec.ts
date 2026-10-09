import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Phase D2: the photo test page. The real measurements come from the owner's own phone and
// computer; this checks the page works end to end in Chromium with the owner's test photos.
test.use({ storageState: { cookies: [], origins: [] } });

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("prepares an iPhone photo upright, smaller and without its location", async ({ page }) => {
  await page.goto("/photo-trial");
  await expect(page.getByRole("heading", { level: 1, name: "Photo test" })).toBeVisible();
  await expect(page.getByText("Browser makes WebP")).toBeVisible();
  await expectAccessible(page);

  // A cookbook page photographed on an iPhone: 24.5 MP, stored sideways, with a location.
  await page.getByText("A cookbook page or recipe card").click();
  await page
    .locator('input[type="file"][multiple]')
    .setInputFiles(["test_images/IMG_0020.jpeg", "test_images/handwritten2.gif"]);
  const photos = page.getByRole("list", { name: "Prepared photos" });
  await expect(photos.getByRole("listitem")).toHaveCount(2, { timeout: 60_000 });

  const report = page.getByRole("region", { name: "Results" });
  await expect(report).toContainText(
    "Original: image/jpeg, 5.5 MB, 5712×4284 stored, turn 6, location yes",
  );
  // Turned upright and shrunk to the page limit (3000 px on the longest side).
  await expect(report).toContainText("Opened: 4284×5712");
  await expect(report).toContainText("turned upright");
  await expect(report).toContainText("Resized: 2250×3000");
  // Chromium's canvas makes WebP; the WebAssembly encoder works too.
  await expect(report).toContainText(/Browser WebP: [\d.]+ (KB|MB) in/);
  await expect(report).toContainText(/WebAssembly WebP: [\d.]+ (KB|MB) in/);
  await expect(report).toContainText("Upload: the prepared version");
  // The GIF card is kept as it is.
  await expect(report).toContainText("Upload: the original, as it is");
  await expect(page.getByRole("img", { name: "Prepared version of IMG_0020.jpeg" })).toBeVisible();
  await expectAccessible(page);
});
