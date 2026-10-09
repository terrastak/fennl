import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addRecipe,
  editorStatus,
  premium,
  recipeCard,
  signInElsewhere,
  syncStatus,
} from "./recipes";
import { useOwnAccount } from "./support";

// Phase D2: photos on recipes. Added in the editor (prepared on the device, uploaded, then
// synced), shown on the recipe page and in the list, and on the household's other devices.

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const photos = (page: Page) => page.getByRole("list", { name: "Photos, the first is the cover" });

test("Premium: add photos, choose the cover, and see them everywhere", async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = await useOwnAccount(context, baseURL!);
  await premium(context, baseURL!);
  await page.goto("/");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await addRecipe(page, "Shakshuka");
  await page.getByRole("link", { name: /Shakshuka/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();

  const section = page.getByRole("region", { name: "Photos" });
  await expect(section).toBeVisible();
  // Phones get the camera button too; computers get one button and dropping files.
  if (testInfo.project.name === "phone") {
    await expect(section.getByText("Take photo")).toBeVisible();
    await expect(section.getByText("Choose photos")).toBeVisible();
  } else {
    await expect(section.getByText("Take photo")).toHaveCount(0);
    await expect(section.getByText("Add photos")).toBeVisible();
    await expect(section.getByText("Or drop photos here.")).toBeVisible();
  }
  await expectAccessible(page);

  await section
    .locator('input[type="file"][multiple]')
    .setInputFiles(["test_images/Image_shakshuka.png", "test_images/Image_stew.png"]);
  await expect(photos(page).getByRole("listitem")).toHaveCount(2, { timeout: 60_000 });
  await expect(section.getByText("2 of 10")).toBeVisible();
  await expect(photos(page).getByRole("listitem").first().getByText("Cover")).toBeVisible();

  // The second becomes the cover; removing it can be undone.
  await section.getByRole("button", { name: "Make cover" }).click();
  await expect(photos(page).getByRole("img", { name: "Photo 1, the cover" })).toBeVisible();
  await section.getByRole("button", { name: "Remove photo 2" }).click();
  await expect(photos(page).getByRole("listitem")).toHaveCount(1);
  await section.getByRole("button", { name: "Undo" }).click();
  await expect(photos(page).getByRole("listitem")).toHaveCount(2);
  await expect(editorStatus(page)).toHaveText("All changes saved");
  await expectAccessible(page);

  // The recipe page: the cover, and the full-screen viewer.
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Shakshuka" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Shakshuka", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open the photo of Shakshuka full screen" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByText("1 of 2")).toBeVisible();
  await viewer.getByRole("button", { name: "Next →" }).click();
  await expect(viewer.getByText("2 of 2")).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Shakshuka, photo 2 of 2" })).toBeVisible();
  await expectAccessible(page);
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(syncStatus(page)).toHaveText("Saved to cloud");

  // The list shows the cover.
  await page.getByRole("link", { name: "All recipes" }).click();
  await expect(recipeCard(page, "Shakshuka").locator("img")).toBeVisible();

  // Another device of the same account gets the photos too.
  const phone = await signInElsewhere(browser, baseURL!, email);
  await expect(recipeCard(phone, "Shakshuka").locator("img")).toBeVisible({ timeout: 30_000 });
  await phone.getByRole("link", { name: /Shakshuka/ }).click();
  await expect(phone.getByRole("img", { name: "Shakshuka", exact: true })).toBeVisible();
  await phone.context().close();
});

test("Free: photos are a Premium feature", async ({ page, context, baseURL }) => {
  await useOwnAccount(context, baseURL!);
  await page.goto("/");
  await expect(syncStatus(page)).toHaveText("Saved to cloud");
  await addRecipe(page, "Toast");
  await page.getByRole("link", { name: /Toast/ }).click();
  await page.getByRole("link", { name: "Edit recipe" }).click();
  const section = page.getByRole("region", { name: "Photos" });
  await expect(section.getByText("Photos are a Premium feature.")).toBeVisible();
  await expect(section.locator('input[type="file"]')).toHaveCount(0);
  await expectAccessible(page);
});
