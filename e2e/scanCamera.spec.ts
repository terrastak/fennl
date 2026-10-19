import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { premium, syncStatus } from "./recipes";
import { useOwnAccount } from "./support";

// Phase E9: the live camera, scanner style, with Chromium's stand-in camera. Page after page,
// then Done; a picture that looks blurry is offered a retake. (In its own file: the stand-in
// camera needs its own browser.)

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const pages = (page: Page) => page.getByRole("list", { name: /read in this order/ });

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
test.use({
  permissions: ["camera"],
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    // Chromium's stand-in camera, and no permission prompt.
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("photographs page after page, then Done", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "The live camera is offered on touch devices.");
  test.setTimeout(90_000);
  await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/import");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await page.getByRole("button", { name: "Scan pages" }).click();

  const camera = page.getByRole("dialog", { name: "Photograph the pages" });
  const shutter = camera.getByRole("button", { name: "Take photo" });
  await expect(shutter).toBeEnabled({ timeout: 20_000 });
  await expectAccessible(page);
  for (const count of ["1 page", "2 pages"]) {
    await shutter.click();
    await expect(shutter).toBeEnabled();
    // The stand-in camera's picture may look blurry (it's mostly one color); keep it either way.
    const blurry = camera.getByRole("alert");
    if (await blurry.isVisible()) {
      await expect(blurry).toContainText("This one looks blurry. Retake?");
      await blurry.getByRole("button", { name: "Keep it" }).click();
    }
    await expect(camera.getByText(count, { exact: true })).toBeVisible();
  }
  await camera.getByRole("button", { name: "Done" }).click();
  await expect(camera).toBeHidden();
  await expect(pages(page).getByRole("listitem")).toHaveCount(2);
});
