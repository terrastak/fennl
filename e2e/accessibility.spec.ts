import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = ["/", "/import", "/settings", "/account", "/not-a-page"];
// Account screens, checked signed out.
const ACCOUNT_PAGES = [
  "/sign-in",
  "/sign-up",
  "/check-email",
  "/forgot-password",
  "/reset-password?token=example",
  "/email-confirmed?error=invalid_token",
];
const LOOKS = [
  { name: "Harbor light", scheme: "harbor", mode: "light" },
  { name: "Harbor dark", scheme: "harbor", mode: "dark" },
  { name: "Heirloom light", scheme: "heirloom", mode: "light" },
  { name: "Heirloom dark", scheme: "heirloom", mode: "dark" },
] as const;

for (const look of LOOKS) {
  test.describe(look.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((appearance) => {
        localStorage.setItem("fennl:appearance", JSON.stringify(appearance));
      }, look);
    });

    for (const path of PAGES) {
      test(`${path} has no automatically detectable accessibility problems`, async ({ page }) => {
        await expectNoViolations(page, path);
      });
    }

    test.describe("signed out", () => {
      test.use({ storageState: { cookies: [], origins: [] } });
      for (const path of ACCOUNT_PAGES) {
        test(`${path} has no automatically detectable accessibility problems`, async ({ page }) => {
          await expectNoViolations(page, path);
        });
      }
    });
  });
}

async function expectNoViolations(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}
